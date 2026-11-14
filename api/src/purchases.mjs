// Store purchase history (receipts with item details) for students and admins. Supabase only.
//
// Where purchases live
//   - bank / beforebank rows written by a store terminal: transaction_source 'POS' (Android / Windows terminals)
//     or 'PWA POS' (pos_checkout RPC), transaction_type 'decrease'. One row per item line;
//     payment = line total, quantity = units, subcategory = product name.
//   - PusanmartPayments: Pusan Mart total-only payments (no item lines, no e-money balance).
// Receipts
//   - PWA rows share bank."order" (a uuid per checkout).
//   - Terminal rows have no order: the lines of one sale share uid + transaction_date + category.
// Store / campus come from bank.category ("Capital Cafe", "Tarlac Store", "ENCANTO MART", ...);
// bank.campus is only used for unknown categories (and holds the legacy typo 'Talrac').
import { normalizeUid } from "./db.mjs";
import { httpError } from "./repository.mjs";
import { q, rest } from "./supabaseRepository.mjs";

const PAGE = 1000;
const MAX_ROWS = 20000;
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const SOURCES = ["POS", "PWA POS"];
const COLS = "id,uid,studentid,name,campus,beforeamount,category,subcategory,payment,totalmoney,quantity,remark,transaction_source,order,transaction_date";
export const PURCHASE_CAMPUSES = ["Capital", "Encanto", "Tarlac", "Pusan Mart"];

const enc = encodeURIComponent;
const upper = (v) => String(v ?? "").trim().toUpperCase();

// ---------- store / campus of a bank.category ----------

const CAMPUS_BY_WORD = { CAPITAL: "Capital", ENCANTO: "Encanto", TARLAC: "Tarlac", TALRAC: "Tarlac", "PUSAN MART": "Pusan Mart" };

export function campusName(value) {
  const u = upper(value);
  if (CAMPUS_BY_WORD[u]) return CAMPUS_BY_WORD[u];
  for (const [word, name] of Object.entries(CAMPUS_BY_WORD)) if (u.startsWith(word)) return name;
  return null;
}

function storeOf(category) {
  const c = upper(category);
  if (/CAFE|CAFÉ|AMERICANO/.test(c)) return "cafe";
  if (/MART|STORE/.test(c)) return "mart";
  return null;
}

function storeLabel(store) {
  return store === "cafe" ? "Cafe" : store === "mart" ? "Mart" : "Store";
}

// ---------- reading ----------

function isoDay(value, name) {
  const s = String(value || "");
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN;
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) throw httpError(400, `${name} must be a real date (YYYY-MM-DD).`);
  return s;
}

function range(column, from, to) {
  const out = [];
  if (from) out.push(`${column}=gte.${enc(`${isoDay(from, "from")}T00:00:00+08:00`)}`);
  if (to) out.push(`${column}=lte.${enc(`${isoDay(to, "to")}T23:59:59.999+08:00`)}`);
  return out;
}

function since(column, iso) {
  return iso ? [`${column}=gte.${enc(iso)}`] : [];
}

async function paged(table, select, filters, order, max = MAX_ROWS) {
  const rows = [];
  const where = filters.length ? `&${filters.join("&")}` : "";
  for (let offset = 0; offset < max; offset += PAGE) {
    const limit = Math.min(PAGE, max - offset);
    const page = await rest(`${table}?select=${select}${where}&order=${order}&offset=${offset}&limit=${limit}`);
    rows.push(...page);
    if (page.length < limit) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function phDateTime(value) {
  if (!value) return null;
  return new Date(new Date(value).getTime() + PH_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

const num = (v) => (v === null || v === undefined ? null : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;

// bank rows (+ table name) -> receipts, newest first.
// Terminal lines of one sale: same table, card, category and before/after balance (the terminal writes the
// receipt's balances on every line), written within 2 minutes (lines can be 1 s apart).
const SAME_SALE_MS = 2 * 60 * 1000;

function toReceipts(rows) {
  const groups = new Map();
  const terminal = [];
  for (const r of rows) {
    if (!r.order) { terminal.push(r); continue; }
    const key = `o:${r.table}:${r.order}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const saleKey = (r) => [r.table, String(r.uid || "").toLowerCase(), r.category, num(r.beforeamount), num(r.totalmoney)].join("|");
  terminal.sort((a, b) => saleKey(a).localeCompare(saleKey(b)) || Date.parse(a.transaction_date) - Date.parse(b.transaction_date) || a.id - b.id);
  let current = null;
  for (const r of terminal) {
    const t = Date.parse(r.transaction_date);
    if (!current || current.key !== saleKey(r) || t - current.last > SAME_SALE_MS) {
      current = { key: saleKey(r), last: t, lines: [] };
      groups.set(`t:${r.table}:${r.id}`, current.lines);
    }
    current.last = t;
    current.lines.push(r);
  }
  const receipts = [];
  for (const [key, lines] of groups) {
    lines.sort((a, b) => Number(a.id) - Number(b.id));
    const first = lines[0];
    const last = lines[lines.length - 1];
    const store = storeOf(first.category);
    const items = lines.map((l) => {
      const qty = Number(l.quantity) || 1;
      const amount = num(l.payment) ?? 0;
      return { name: String(l.subcategory ?? "").trim() || "(item)", quantity: qty, unitPrice: round2(amount / qty), amount };
    });
    const discount = first.transaction_source === "PWA POS" && first.remark && first.remark !== "No Discount" ? first.remark : null;
    receipts.push({
      id: key,
      date: phDateTime(first.transaction_date),
      at: first.transaction_date,
      campus: campusName(first.category) || campusName(first.campus) || first.campus,
      store,
      storeName: first.category || storeLabel(store),
      uid: first.uid,
      studentId: first.studentid,
      name: first.name,
      items,
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
      total: round2(items.reduce((s, i) => s + i.amount, 0)),
      discount,
      balanceBefore: num(first.beforeamount),
      balanceAfter: num(last.totalmoney),
      source: first.transaction_source,
      orderId: first.order || null,
      table: first.table,
    });
  }
  return receipts;
}

function pusanReceipt(r, person) {
  return {
    id: `p:${r.id}`,
    date: phDateTime(r.register_days),
    at: r.register_days,
    campus: "Pusan Mart",
    store: "mart",
    storeName: "Pusan Mart",
    uid: r.nfcid,
    studentId: person?.studentid ?? null,
    name: r.name,
    items: [],
    itemCount: null,
    total: num(r.allpayments) ?? 0,
    discount: null,
    balanceBefore: null,
    balanceAfter: null,
    source: "PusanMart",
    orderId: null,
    table: "PUSANMART",
  };
}

function newestFirst(a, b) {
  const x = Date.parse(a.at || 0) || 0;
  const y = Date.parse(b.at || 0) || 0;
  return y - x || String(b.id).localeCompare(String(a.id));
}

// filters: PostgREST filters applied to bank AND beforebank; pusanFilters to PusanmartPayments (null = skip).
async function load({ filters, pusanFilters }) {
  const base = [`transaction_source=in.(${SOURCES.map(q).join(",")})`, "transaction_type=eq.decrease", ...filters];
  const order = "transaction_date.desc,id.desc";
  const [a, b, p] = await Promise.all([
    paged("bank", COLS, base, order),
    paged("beforebank", COLS, base, order),
    pusanFilters ? paged("PusanmartPayments", "id,nfcid,name,allpayments,register_days", ["center=eq.PusanMart", ...pusanFilters], "register_days.desc,id.desc") : { rows: [], truncated: false },
  ]);
  const rows = [...a.rows.map((r) => ({ ...r, table: "BANK" })), ...b.rows.map((r) => ({ ...r, table: "BEFOREBANK" }))];
  const people = await studentIds(p.rows.map((r) => r.nfcid));
  const receipts = [...toReceipts(rows), ...p.rows.map((r) => pusanReceipt(r, people.get(String(r.nfcid || "").toLowerCase())))];
  receipts.sort(newestFirst);
  return { receipts, truncated: a.truncated || b.truncated || p.truncated };
}

async function studentIds(uids) {
  const list = [...new Set(uids.filter(Boolean).map(String))];
  const out = new Map();
  for (let i = 0; i < list.length; i += 150) {
    const part = list.slice(i, i + 150);
    const rows = await rest(`person?select=uid,studentid&uid=in.(${part.map(q).join(",")})&order=id.asc`);
    for (const r of rows) if (!out.has(String(r.uid).toLowerCase())) out.set(String(r.uid).toLowerCase(), r);
  }
  return out;
}

function summarize(receipts) {
  const byStore = new Map();
  const byItem = new Map();
  let total = 0;
  for (const r of receipts) {
    total += r.total;
    const sk = `${r.campus} · ${r.storeName}`;
    const s = byStore.get(sk) || { campus: r.campus, store: r.storeName, receipts: 0, total: 0 };
    s.receipts += 1; s.total += r.total;
    byStore.set(sk, s);
    for (const it of r.items) {
      const ik = `${r.storeName}|${it.name}`;
      const x = byItem.get(ik) || { store: r.storeName, name: it.name, quantity: 0, total: 0 };
      x.quantity += it.quantity; x.total += it.amount;
      byItem.set(ik, x);
    }
  }
  const fix = (o) => ({ ...o, total: round2(o.total) });
  return {
    receipts: receipts.length,
    total: round2(total),
    byStore: [...byStore.values()].map(fix).sort((a, b) => b.total - a.total),
    topItems: [...byItem.values()].map(fix).sort((a, b) => b.total - a.total).slice(0, 20),
  };
}

const publicReceipt = ({ at, table, uid, ...r }) => r;

// ---------- student: own purchases by NFC card ----------

// The card is the proof of identity. Rows from before this person's registration are left out,
// because bank keeps the uid of a card that was released (Default) and handed to a new student.
export async function studentPurchases({ uid, from, to }) {
  const card = normalizeUid(uid);
  if (!/^[0-9a-z]{6,32}$/.test(card)) throw httpError(400, "Tap your card or enter its UID.");
  const [person] = await rest(
    `person?select=id,uid,studentid,name,campus,totalmoney,register_date,s_date,e_date&uid=eq.${enc(card)}&order=id.asc&limit=1`,
  );
  if (!person) throw httpError(404, "This card is not registered.");
  const start = person.register_date || (person.s_date ? `${person.s_date}T00:00:00+08:00` : null);
  const uidFilter = `uid=eq.${enc(person.uid)}`;
  const { receipts, truncated } = await load({
    filters: [uidFilter, ...since("transaction_date", start), ...range("transaction_date", from, to)],
    pusanFilters: [`nfcid=eq.${enc(person.uid)}`, ...since("register_days", start), ...range("register_days", from, to)],
  });
  return {
    person: {
      name: person.name,
      studentId: person.studentid,
      campus: campusName(person.campus) || person.campus,
      balance: num(person.totalmoney),
      startDate: person.s_date,
      endDate: person.e_date,
    },
    receipts: receipts.map(publicReceipt),
    summary: summarize(receipts),
    truncated,
  };
}

// ---------- admin: every store, filtered ----------

// allowedCampuses: campuses this account may see (from access.mjs); null = all.
// f: { from, to, campus, store, search }
export async function adminPurchases(f, allowedCampuses) {
  if (!f.from || !f.to) throw httpError(400, "Choose a date range.");
  const days = (Date.parse(isoDay(f.to, "to")) - Date.parse(isoDay(f.from, "from"))) / 86400e3;
  if (days < 0) throw httpError(400, "The start date is after the end date.");
  if (days > 92) throw httpError(400, "Choose at most 3 months at a time.");

  let campuses = allowedCampuses ? [...allowedCampuses] : [...PURCHASE_CAMPUSES];
  if (f.campus && !/^all$/i.test(f.campus)) {
    const wanted = campusName(f.campus);
    if (!wanted || !campuses.includes(wanted)) throw httpError(403, `This account cannot view ${f.campus} purchases.`);
    campuses = [wanted];
  }
  const store = f.store && !/^all$/i.test(f.store) ? String(f.store).toLowerCase() : null;
  if (store && store !== "cafe" && store !== "mart") throw httpError(400, "Store must be 'cafe' or 'mart'.");

  const filters = range("transaction_date", f.from, f.to);
  const pusanFilters = campuses.includes("Pusan Mart") && store !== "cafe" ? range("register_days", f.from, f.to) : null;
  const bankOr = [];
  // Narrow in the DB too (exact store/campus is decided from the category below):
  // category starts with the campus name, or bank.campus is that campus (unknown categories like 'WATER').
  if (campuses.length < PURCHASE_CAMPUSES.length) {
    const words = campuses.flatMap((c) => (c === "Tarlac" ? ["Tarlac", "Talrac"] : [c]));
    bankOr.push(`or(${words.flatMap((w) => [`category.ilike.${q(`${w}*`)}`, `campus.ilike.${q(w)}`]).join(",")})`);
  }
  const search = String(f.search || "").trim();
  if (search) {
    const like = `*${search.replace(/[\\%_*,()"]/g, " ").trim()}*`;
    const card = normalizeUid(search);
    bankOr.push(`or(name.ilike.${q(like)},studentid.ilike.${q(like)},uid.eq.${q(card || search)})`);
    pusanFilters?.push(`or=${enc(`(name.ilike.${q(like)},nfcid.eq.${q(card || search)})`)}`);
  }
  if (bankOr.length) filters.push(`and=${enc(`(${bankOr.join(",")})`)}`);

  const { receipts, truncated } = await load({ filters, pusanFilters });
  const shown = receipts.filter((r) => campuses.includes(r.campus) && (!store || r.store === store));
  return { receipts: shown.map(({ at, ...r }) => r), summary: summarize(shown), truncated, campuses };
}

// Campuses an account may see purchases for (access from access.mjs).
export function purchaseCampuses(access) {
  const list = [...new Set([...(access.cafeCampuses || []), ...(access.martCampuses || [])].map(campusName).filter(Boolean))];
  const all = PURCHASE_CAMPUSES.every((c) => list.includes(c));
  return all ? null : list;
}
