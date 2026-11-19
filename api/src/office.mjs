// SMEAG OFFICE ONLINE PROGRAM: data for the /office/ tabs (Supabase / PostgREST only).
// Each section ports the SQL of one WinForms control in "SMEAG_Office (Source)/Controls/*.cs".
//
// Notes
// - bank/beforebank.transaction_date is timestamptz; the screens work in Philippine time (UTC+8, no DST).
// - Text comparisons are case-insensitive like the legacy MySQL DB (uid/studentid are citext already;
//   campus/category use ilike). bank.campus also contains the legacy typo 'Talrac' for Tarlac.
// - PostgREST returns at most 1000 rows per request, so list endpoints page and stop at a cap.
import { requiredEnv } from "./db.mjs";
import { httpError } from "./repository.mjs";
import { escapeLike, q, rest } from "./supabaseRepository.mjs";
import { PUSANMART_SETTLE_SHARE, pusanmartUnitCosts, pusanmartNameKey as nameKey } from "./backofficeSupabase.mjs";

const PAGE = 1000;
const MAX_ROWS = 5000;      // person searches
const MAX_BANK_ROWS = 20000; // bank / beforebank lists
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const PHOTO_BUCKET = "person-photos";

const PERSON_COLS = "id,uid,studentid,name,photo,age,gender,campus,s_date,e_date,totalmoney,register_date";
const BANK_COLS = "id,uid,studentid,name,campus,beforeamount,category,subcategory,transaction_type,payment,totalmoney,quantity,remark,transaction_source,order,transaction_date";

// ---------- helpers ----------

const enc = encodeURIComponent;

function isoDay(value, name) {
  const s = String(value || "");
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN;
  // Date.parse rolls 2026-02-30 over to March: require the round trip to give the same day.
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) throw httpError(400, `${name} must be a real date (YYYY-MM-DD).`);
  return s;
}

// PH day range -> absolute bounds for a timestamptz column.
function tsRange(column, from, to) {
  const a = isoDay(from, "from");
  const b = isoDay(to, "to");
  return [`${column}=gte.${enc(`${a}T00:00:00+08:00`)}`, `${column}=lte.${enc(`${b}T23:59:59.999+08:00`)}`];
}

function phDateTime(value) {
  if (!value) return null;
  return new Date(new Date(value).getTime() + PH_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

function phDay(value) {
  return value ? phDateTime(value).slice(0, 10) : null;
}

function campusNames(campus) {
  const names = [String(campus)];
  const upper = String(campus).toUpperCase();
  if (upper === "TARLAC") names.push("Talrac");
  if (upper === "TALRAC") names.push("Tarlac");
  return names;
}

// campus filter (case-insensitive, Tarlac/Talrac); "All"/"ALL"/"" means no filter.
function campusFilter(column, campus) {
  if (!campus || /^all( campuses)?$/i.test(String(campus))) return [];
  const or = campusNames(campus).map((n) => `${column}.ilike.${q(escapeLike(n))}`).join(",");
  return [`or=${enc(`(${or})`)}`];
}

function contains(column, text) {
  const t = String(text || "").trim();
  return t ? [`${column}=ilike.${enc(`*${escapeLike(t)}*`)}`] : [];
}

function exact(column, text) {
  const t = String(text || "").trim();
  return t ? [`${column}=eq.${enc(t)}`] : [];
}

function toId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, "Invalid id.");
  return n;
}

function toIds(ids) {
  if (!Array.isArray(ids) || !ids.length) throw httpError(400, "Select at least one row.");
  const list = [...new Set(ids.map(toId))];
  if (list.length > MAX_BANK_ROWS) throw httpError(400, `Too many rows at once (max ${MAX_BANK_ROWS}).`);
  return list;
}

function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

function numOrNull(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw httpError(400, `${name} must be a number.`);
  return n;
}

function intOrNull(value, name) {
  const n = numOrNull(value, name);
  if (n !== null && !Number.isInteger(n)) throw httpError(400, `${name} must be a whole number.`);
  return n;
}

function dateOrNull(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return isoDay(String(value).trim().slice(0, 10), name);
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Read up to `max` rows of `table` matching `filters`, `order` applied, 1000 per request.
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

// ---------- person (INFORMATION / MODIFY INFO / IDCARD / Graduate / Default) ----------

function mapPerson(r) {
  return {
    id: Number(r.id),
    uid: r.uid,
    studentId: r.studentid,
    name: r.name,
    photo: r.photo,
    photoUrl: photoUrl(r.photo),
    age: r.age,
    gender: r.gender,
    campus: r.campus,
    startDate: r.s_date,
    endDate: r.e_date,
    totalMoney: num(r.totalmoney),
    registerDate: phDateTime(r.register_date),
  };
}

// Filters (all optional):
//   uid        exact card uid (INFORMATION / MODIFY INFO) ; uidLike: contains (IDCARD)
//   name       contains ; campus: exact (All = any) ; age: exact
//   startFrom + endTo   s_date >= startFrom AND e_date <= endTo (INFORMATION "Date Filter")
//   regDate    DATE(register_date) = regDate (IDCARD "Reg. Date")
//   endBefore  e_date <= endBefore (Graduate)
export async function searchPeople(f) {
  const filters = [
    ...exact("uid", f.uid),
    ...contains("uid", f.uidLike),
    ...contains("name", f.name),
    ...campusFilter("campus", f.campus),
  ];
  const age = intOrNull(f.age, "Age");
  if (age !== null) filters.push(`age=eq.${age}`);
  if (f.startFrom) filters.push(`s_date=gte.${isoDay(f.startFrom, "startFrom")}`);
  if (f.endTo) filters.push(`e_date=lte.${isoDay(f.endTo, "endTo")}`);
  if (f.endBefore) filters.push(`e_date=lte.${isoDay(f.endBefore, "endBefore")}`);
  if (f.regDate) filters.push(...tsRange("register_date", f.regDate, f.regDate));
  const { rows, truncated } = await paged("person", PERSON_COLS, filters, "id.asc");
  return { people: rows.map(mapPerson), truncated };
}

// Default tab: exact uid, falling back to the released "G"+uid card.
export async function findPersonForDefault(uid) {
  const u = String(uid || "").trim();
  if (!u) throw httpError(400, "UID is required.");
  let rows = await rest(`person?select=${PERSON_COLS}&uid=eq.${enc(u)}&order=id.asc`);
  if (!rows.length) rows = await rest(`person?select=${PERSON_COLS}&uid=eq.${enc(`G${u}`)}&order=id.asc`);
  return { people: rows.map(mapPerson) };
}

// Default tab: release a card -> uid becomes "G" + uid.
export async function defaultCard(id) {
  const [row] = await rest(`person?select=id,uid,name&id=eq.${toId(id)}`);
  if (!row) throw httpError(404, "Student not found.");
  const uid = String(row.uid || "");
  if (/^g/i.test(uid)) throw httpError(409, "This card is already initialized (Defaulted).");
  const [updated] = await rest(`person?id=eq.${row.id}&select=${PERSON_COLS}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: { uid: `G${uid}` },
  });
  return { person: mapPerson(updated) };
}

function personBody(p, { requireKeys }) {
  const body = {};
  const set = (key, column, value) => { if (p[key] !== undefined) body[column] = value; };
  set("uid", "uid", String(p.uid ?? "").trim() || null);
  set("studentId", "studentid", String(p.studentId ?? "").trim() || null);
  set("name", "name", String(p.name ?? "").trim() || null);
  set("photo", "photo", String(p.photo ?? "").trim() || null);
  set("age", "age", intOrNull(p.age, "Age"));
  set("gender", "gender", String(p.gender ?? "").trim() || null);
  set("campus", "campus", String(p.campus ?? "").trim() || null);
  set("startDate", "s_date", dateOrNull(p.startDate, "Start date"));
  set("endDate", "e_date", dateOrNull(p.endDate, "End date"));
  if (requireKeys) {
    if (!body.uid || !body.studentid || !body.name) throw httpError(400, "Please fill required fields (UID, ID, Name)");
  } else {
    for (const [col, label] of [["uid", "UID"], ["studentid", "Student ID"], ["name", "Name"]]) {
      if (col in body && !body[col]) throw httpError(400, `${label} is required.`);
    }
  }
  return body;
}

// REGISTRATION: one student (form) or many (Excel import, all-or-nothing in one request).
export async function registerPeople(list) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, "No data found.");
  if (list.length > 2000) throw httpError(400, "Too many rows at once (max 2000).");
  const rows = list.map((p, i) => {
    try {
      const body = personBody(p, { requireKeys: true });
      body.totalmoney = numOrNull(p.totalMoney, "Total amount") ?? 0;
      return body;
    } catch (error) {
      if (list.length > 1) error.message = `Row ${i + 1}: ${error.message}`;
      throw error;
    }
  });
  // Every row needs the same keys for a bulk insert.
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const uniform = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
  const inserted = await rest(`person?select=${PERSON_COLS}`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: uniform,
  });
  return { people: inserted.map(mapPerson) };
}

// MODIFY INFO: uid, studentid, name, photo, age, gender, campus, s_date, e_date (never totalmoney).
export async function updatePerson(id, changes) {
  const body = personBody(changes, { requireKeys: false });
  if (!Object.keys(body).length) throw httpError(400, "Nothing to update.");
  const rows = await rest(`person?id=eq.${toId(id)}&select=${PERSON_COLS}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body,
  });
  if (!rows.length) throw httpError(404, "Student not found.");
  return { person: mapPerson(rows[0]) };
}

// Graduate: copy to person_graduate_backup, then delete from person.
export async function backupGraduates(ids) {
  const list = toIds(ids);
  let moved = 0;
  for (const part of chunk(list, 200)) {
    const rows = await rest(`person?select=uid,studentid,name,age,gender,campus,s_date,e_date,totalmoney,register_date,id&id=in.(${part.join(",")})`);
    if (!rows.length) continue;
    await rest("person_graduate_backup", {
      method: "POST",
      body: rows.map(({ id, ...r }) => ({ ...r, backup_date: new Date().toISOString() })),
    });
    await rest(`person?id=in.(${rows.map((r) => r.id).join(",")})`, { method: "DELETE" });
    moved += rows.length;
  }
  return { moved };
}

// ---------- photos (Supabase Storage, public bucket "person-photos") ----------

function storageBase() {
  return `${requiredEnv("SUPABASE_URL").replace(/\/+$/, "")}/storage/v1`;
}

export function photoUrl(photo) {
  const name = String(photo || "").trim();
  if (!name || !process.env.SUPABASE_URL) return null;
  return `${storageBase()}/object/public/${PHOTO_BUCKET}/${name.split("/").map(enc).join("/")}`;
}

async function storage(path, { method = "GET", body, headers = {} } = {}) {
  const key = requiredEnv("SUPABASE_SERVICE_KEY");
  return fetch(`${storageBase()}/${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, ...headers },
    body,
  });
}

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const res = await storage(`bucket/${PHOTO_BUCKET}`);
  if (res.status === 200) { bucketReady = true; return; }
  const created = await storage("bucket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: PHOTO_BUCKET, name: PHOTO_BUCKET, public: true, file_size_limit: 5 * 1024 * 1024 }),
  });
  const text = await created.text();
  if (!created.ok && !/already exists/i.test(text)) throw httpError(500, `Cannot create the photo storage: ${text}`);
  bucketReady = true;
}

// body: { studentId, dataUrl: "data:image/jpeg;base64,..." } -> { photo: "<file name>", photoUrl }
export async function uploadPhoto({ studentId, dataUrl }) {
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw httpError(400, "Photo must be a JPEG, PNG or WebP image.");
  const bytes = Buffer.from(m[3], "base64");
  if (bytes.length > 3 * 1024 * 1024) throw httpError(400, "Photo is too large (max 3 MB).");
  const sid = String(studentId || "").trim().replace(/[^A-Za-z0-9_-]/g, "") || "student";
  const stamp = new Date(Date.now() + PH_OFFSET_MS).toISOString().replace(/\D/g, "").slice(0, 14);
  const name = `${sid}_${stamp}.${m[2] === "jpeg" ? "jpg" : m[2]}`;
  await ensureBucket();
  const res = await storage(`object/${PHOTO_BUCKET}/${enc(name)}`, {
    method: "POST",
    headers: { "content-type": m[1], "x-upsert": "true" },
    body: bytes,
  });
  if (!res.ok) throw httpError(500, `Photo upload failed: ${await res.text()}`);
  return { photo: name, photoUrl: photoUrl(name) };
}

// ---------- office_menus (MENU LIST) ----------

function mapMenu(r) {
  return { id: Number(r.id), campus: r.Campus, mMenu: r.m_menu, sMenu: r.s_menu, payment: num(r.payment) };
}

export async function listMenus({ campus }) {
  const filters = campus && !/^all$/i.test(campus) ? [`Campus=ilike.${enc(escapeLike(campus))}`] : [];
  const { rows } = await paged("office_menus", "id,Campus,m_menu,s_menu,payment", filters, "id.asc");
  return { menus: rows.map(mapMenu) };
}

function menuBody(m, partial) {
  const body = {};
  if (m.campus !== undefined || !partial) body.Campus = String(m.campus ?? "").trim();
  if (m.mMenu !== undefined || !partial) body.m_menu = String(m.mMenu ?? "").trim();
  if (m.sMenu !== undefined || !partial) body.s_menu = String(m.sMenu ?? "").trim();
  if (m.payment !== undefined || !partial) body.payment = numOrNull(m.payment, "Price") ?? 0;
  if ("Campus" in body && !body.Campus) throw httpError(400, "Campus is required.");
  if ("m_menu" in body && !body.m_menu) throw httpError(400, "Main menu is required.");
  if ("s_menu" in body && !body.s_menu) throw httpError(400, "Sub menu is required.");
  return body;
}

export async function createMenu(m) {
  const [row] = await rest("office_menus?select=id,Campus,m_menu,s_menu,payment", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: menuBody(m, false),
  });
  return { menu: mapMenu(row) };
}

export async function updateMenu(id, m) {
  const body = menuBody(m, true);
  if (!Object.keys(body).length) throw httpError(400, "Nothing to update.");
  const rows = await rest(`office_menus?id=eq.${toId(id)}&select=id,Campus,m_menu,s_menu,payment`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body,
  });
  if (!rows.length) throw httpError(404, "Menu not found.");
  return { menu: mapMenu(rows[0]) };
}

export async function deleteMenu(id) {
  const rows = await rest(`office_menus?id=eq.${toId(id)}&select=id`, { method: "DELETE", headers: { prefer: "return=representation" } });
  if (!rows.length) throw httpError(404, "Menu not found.");
  return { id: Number(id) };
}

// ---------- bank rows ----------

function mapBank(r, source) {
  const out = {
    id: Number(r.id),
    uid: r.uid,
    studentId: r.studentid,
    name: r.name,
    campus: r.campus,
    beforeAmount: num(r.beforeamount),
    category: r.category,
    subcategory: r.subcategory,
    type: r.transaction_type,
    payment: num(r.payment),
    totalMoney: num(r.totalmoney),
    quantity: r.quantity === null || r.quantity === undefined ? null : Number(r.quantity),
    remark: r.remark,
    source: r.transaction_source,
    order: r.order,
    date: phDateTime(r.transaction_date),
  };
  if (source) out.table = source;
  return out;
}

// LIST MENU: bank (+ person.age) by campus / name / age / category / subcategory / date range.
export async function listBank(f) {
  const filters = [
    ...tsRange("transaction_date", f.from, f.to),
    ...campusFilter("campus", f.campus),
    ...contains("name", f.name),
    ...contains("category", f.category),
    ...contains("subcategory", f.subcategory),
  ];
  const age = intOrNull(f.age, "Age");
  if (age !== null) {
    const { rows: people } = await paged("person", "uid", [`age=eq.${age}`, "uid=not.is.null"], "id.asc", 20000);
    const uids = [...new Set(people.map((p) => p.uid))];
    if (!uids.length) return { rows: [], truncated: false };
    // Long uid lists don't fit in one URL: query in chunks and merge (newest first).
    let rows = [];
    let truncated = false;
    for (const part of chunk(uids, 150)) {
      const res = await paged("bank", BANK_COLS, [...filters, `uid=in.(${part.map((u) => q(u)).join(",")})`], "transaction_date.desc,id.desc", MAX_BANK_ROWS);
      rows.push(...res.rows);
      truncated = truncated || res.truncated;
    }
    rows.sort(newestFirst);
    if (rows.length > MAX_BANK_ROWS) { rows = rows.slice(0, MAX_BANK_ROWS); truncated = true; }
    return withAges(rows, truncated);
  }
  const { rows, truncated } = await paged("bank", BANK_COLS, filters, "transaction_date.desc,id.desc", MAX_BANK_ROWS);
  return withAges(rows, truncated);
}

function newestFirst(a, b) {
  const x = String(a.transaction_date ?? a.date ?? "");
  const y = String(b.transaction_date ?? b.date ?? "");
  if (x !== y) return x < y ? 1 : -1;
  return Number(b.id) - Number(a.id);
}

async function withAges(rows, truncated) {
  const ages = await agesFor(rows.map((r) => r.uid));
  return { rows: rows.map((r) => ({ ...mapBank(r), age: ages.get(String(r.uid || "").toLowerCase()) ?? null })), truncated };
}

async function agesFor(uids) {
  const list = [...new Set(uids.filter(Boolean).map((u) => String(u)))];
  const ages = new Map();
  for (const part of chunk(list, 150)) {
    const rows = await rest(`person?select=uid,age&uid=in.(${part.map((u) => q(u)).join(",")})`);
    for (const r of rows) ages.set(String(r.uid).toLowerCase(), r.age);
  }
  return ages;
}

// LIST MENU update: category, subcategory, type, payment, quantity, remark (balance is NOT recalculated).
export async function updateBank(id, c) {
  const body = {};
  if (c.category !== undefined) body.category = String(c.category ?? "").trim() || null;
  if (c.subcategory !== undefined) body.subcategory = String(c.subcategory ?? "").trim() || null;
  if (c.type !== undefined) {
    const t = String(c.type || "").trim().toLowerCase();
    if (!["increase", "decrease", "exception"].includes(t)) throw httpError(400, "Type must be increase, decrease or exception.");
    body.transaction_type = t;
  }
  if (c.payment !== undefined) body.payment = numOrNull(c.payment, "Payment");
  if (c.quantity !== undefined) body.quantity = intOrNull(c.quantity, "Quantity");
  if (c.remark !== undefined) body.remark = String(c.remark ?? "").trim() || null;
  if (!Object.keys(body).length) throw httpError(400, "Nothing to update.");
  const rows = await rest(`bank?id=eq.${toId(id)}&select=${BANK_COLS}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body,
  });
  if (!rows.length) throw httpError(404, "Transaction not found.");
  return { row: mapBank(rows[0]) };
}

export async function deleteBank(id) {
  const rows = await rest(`bank?id=eq.${toId(id)}&select=id`, { method: "DELETE", headers: { prefer: "return=representation" } });
  if (!rows.length) throw httpError(404, "Transaction not found.");
  return { id: Number(id) };
}

// ---------- RECHARGE/CASHOUT ----------

let categoryCache = null;
// Distinct bank.category per type (combo boxes). PostgREST has no DISTINCT, so read the
// category/type columns once and cache them for 10 minutes.
export async function bankCategories() {
  if (categoryCache && categoryCache.until > Date.now()) return categoryCache.value;
  const { rows } = await paged("bank", "category,transaction_type", ["category=not.is.null"], "id.desc", 60000);
  const inc = new Set();
  const dec = new Set();
  for (const r of rows) {
    const t = String(r.transaction_type || "").toLowerCase();
    if (t === "increase") inc.add(r.category);
    else if (t === "decrease") dec.add(r.category);
  }
  const sort = (s) => [...s].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const value = { increase: sort(inc), decrease: sort(dec) };
  categoryCache = { value, until: Date.now() + 10 * 60 * 1000 };
  return value;
}

// bank rows of one campus in a date range, split into recharge (increase) and cash-out (decrease).
export async function rechargeCashout({ campus, from, to, rechargeCategory, cashoutCategory }) {
  if (!campus) throw httpError(400, "Campus is required.");
  const filters = [...tsRange("transaction_date", from, to), ...campusFilter("campus", campus)];
  const { rows, truncated } = await paged("bank", BANK_COLS, filters, "transaction_date.asc,id.asc", 20000);
  const pick = (cat) => (r) => !cat || /^all$/i.test(cat) || String(r.category || "") === cat;
  const recharge = rows.filter((r) => String(r.transaction_type).toLowerCase() === "increase").filter(pick(rechargeCategory));
  const cashout = rows.filter((r) => String(r.transaction_type).toLowerCase() === "decrease").filter(pick(cashoutCategory));
  return { recharge: recharge.map((r) => mapBank(r)), cashout: cashout.map((r) => mapBank(r)), truncated };
}

// ---------- PAYMENT INQUIRY (bank + beforebank + PusanmartPayments) ----------

// PUSAN MART purchases are only in PusanmartPayments (nfcid citext, allpayments, register_days);
// they never touch bank or the e-money balance. Rows are shaped like bank rows for the same grid.
// PusanmartPayments has no campus: "PUSAN MART" in the campus box shows only these rows,
// a real campus (CAPITAL, ...) leaves them out, All includes them.
const NO_RESULT = { rows: [], truncated: false };
const isPusanCampus = (campus) => /^pusan\s*mart$/i.test(String(campus || "").trim());

function mapPusanmart(r, studentIds) {
  return {
    id: Number(r.id),
    table: "PUSANMART",
    uid: r.nfcid,
    studentId: studentIds.get(String(r.nfcid || "").toLowerCase()) ?? null,
    name: r.name,
    campus: "Pusan Mart",
    beforeAmount: null,
    category: "Pusan Mart",
    subcategory: null,
    type: "decrease",
    payment: num(r.allpayments),
    totalMoney: null,
    quantity: null,
    remark: null,
    source: "PusanMart",
    order: null,
    date: phDateTime(r.register_days),
  };
}

async function studentIdsFor(uids) {
  const list = [...new Set(uids.filter(Boolean).map((u) => String(u)))];
  const ids = new Map();
  for (const part of chunk(list, 150)) {
    const rows = await rest(`person?select=uid,studentid&uid=in.(${part.map((u) => q(u)).join(",")})&order=id.asc`);
    for (const r of rows) {
      const key = String(r.uid).toLowerCase();
      if (!ids.has(key)) ids.set(key, r.studentid); // duplicate uids: oldest person row, like checkout
    }
  }
  return ids;
}

export async function paymentInquiry({ uid, name, campus, from, to }) {
  const filters = [];
  const pusanFilters = ["center=eq.PusanMart"];
  const byCard = Boolean(String(uid || "").trim());
  const pusanOnly = !byCard && isPusanCampus(campus);
  if (byCard) {
    // Card search: the whole history, ignoring the other filters.
    filters.push(...exact("uid", uid));
    pusanFilters.push(...exact("nfcid", uid));
  } else {
    filters.push(...contains("name", name));
    pusanFilters.push(...contains("name", name));
    if (!pusanOnly) filters.push(...campusFilter("campus", campus));
    if (from || to) {
      filters.push(...tsRange("transaction_date", from, to));
      pusanFilters.push(...tsRange("register_days", from, to));
    }
  }
  if (!filters.length && !pusanOnly) throw httpError(400, "Enter a card, name, campus or date range.");
  const withPusan = byCard || pusanOnly || !campusFilter("campus", campus).length;
  const order = "transaction_date.desc,id.desc";
  const [a, b, p] = await Promise.all([
    pusanOnly ? NO_RESULT : paged("bank", BANK_COLS, filters, order, MAX_BANK_ROWS),
    pusanOnly ? NO_RESULT : paged("beforebank", BANK_COLS, filters, order, MAX_BANK_ROWS),
    withPusan
      ? paged("PusanmartPayments", "id,nfcid,name,allpayments,register_days", pusanFilters, "register_days.desc,id.desc", MAX_BANK_ROWS)
      : NO_RESULT,
  ]);
  const studentIds = await studentIdsFor(p.rows.map((r) => r.nfcid));
  const all = [
    ...a.rows.map((r) => mapBank(r, "BANK")),
    ...b.rows.map((r) => mapBank(r, "BEFOREBANK")),
    ...p.rows.map((r) => mapPusanmart(r, studentIds)),
  ].sort(newestFirst);
  return { rows: all.slice(0, MAX_BANK_ROWS), truncated: a.truncated || b.truncated || p.truncated || all.length > MAX_BANK_ROWS };
}

// ---------- TransData (bank -> beforebank) ----------

export async function transDataList({ from, to }) {
  const { rows, truncated } = await paged("bank", BANK_COLS, tsRange("transaction_date", from, to), "transaction_date.desc,id.desc", MAX_BANK_ROWS);
  return { rows: rows.map((r) => mapBank(r)), truncated };
}

// Move rows bank -> beforebank. beforebank always gets NEW ids: bank and beforebank id ranges
// overlap on live data (3,087 bank ids also exist in beforebank as different, older transactions).
//
// Preferred: the office_transdata_move RPC (migrations/supabase_office_functions.sql) does it in one
// transaction (all or nothing, row locks so concurrent requests cannot copy a row twice).
// Fallback while that migration is not installed: per chunk, DELETE ... RETURNING first (only one
// concurrent request gets each row), then insert the returned rows into beforebank; if that insert
// fails, the rows are put back into bank with their original ids.
export async function transDataMove(ids) {
  const list = toIds(ids);
  try {
    const moved = await rest("rpc/office_transdata_move", { method: "POST", body: { p_ids: list } });
    return { moved: Number(moved), atomic: true };
  } catch (error) {
    if (!/office_transdata_move|PGRST202|schema cache/i.test(error.message)) throw error;
  }
  const cols = `${BANK_COLS},picture`;
  let moved = 0;
  for (const part of chunk(list, 200)) {
    const rows = await rest(`bank?id=in.(${part.join(",")})&select=${cols}`, {
      method: "DELETE",
      headers: { prefer: "return=representation" },
    });
    if (!rows.length) continue;
    try {
      await rest("beforebank", { method: "POST", body: rows.map(({ id, ...r }) => r) });
    } catch (error) {
      await rest("bank", { method: "POST", body: rows }).catch((restoreError) => {
        console.error("TransData: could not restore bank rows", rows.map((r) => r.id), restoreError);
      });
      error.message = `TransData stopped: ${moved} row(s) were moved before the error; the rest stay in bank. ${error.message}`;
      throw error;
    }
    moved += rows.length;
  }
  return { moved, atomic: false };
}

// ---------- REPORT (daily totals by category; bank + beforebank + PusanmartPayments; saved corrections) ----------

export const OFFICE_CATEGORIES = ["Recharge", "AGRecharge", "EBILL", "Records", "Refund", "CashOut", "Souvenir", "Visa", "Academic", "Admin", "Activities", "Diving Shop", "Massage", "Car Service"];
export const STORE_CATEGORIES = ["Mart", "Cafe", "Pusan Mart"];
const REPORT_CATEGORIES = [...OFFICE_CATEGORIES, ...STORE_CATEGORIES];

// Office columns count rows whose category is exactly that name, filed under the buyer's campus (bank.campus).
// Store sales are filed under the campus and store where they were SOLD:
//   - "Capital Cafe", "ENCANTO MART", "Tarlac Store", ... -> the campus the category names, Cafe or Mart;
//   - terminal rows whose category names no store ("WATER", "ENCANTO MINI CAKES") -> the store of the
//     other lines of the same sale (same card + time), else Mart; campus = bank.campus;
//   - "Pusan Mart" = bank rows with category exactly "Pusan Mart" + PusanmartPayments (see pusanmartRows).
// Services sold by the office, filed under the campus the category names ("Talac massage" = Tarlac):
//   - Massage     = "Talac massage" / "Tarlac massage";
//   - Car Service = "Capital Car Service", "Encanto Car Service", "Tarlac Car Service".
//   Sales are decreases, refunds (increase, same item) are subtracted; the driver's 5% incentive
//   ("... Car Rent incentive for driver 5%", an increase to the driver's card) is not a sale and is skipped.
// Other office categories that match no column stay out.
const SERVICE_CATEGORIES = ["Massage", "Car Service"];

function serviceColumn(category) {
  const c = String(category || "").trim().toLowerCase();
  if (/massage/.test(c)) return "Massage";
  if (/car\s*service/.test(c)) return "Car Service";
  return null;
}

function officeColumn(category) {
  const c = String(category || "").trim().toLowerCase();
  return OFFICE_CATEGORIES.find((name) => name.toLowerCase() === c) || (c === "pusan mart" ? "Pusan Mart" : null);
}

function campusOfCategory(category) {
  const c = String(category || "").trim().toUpperCase();
  const hit = CAMPUS_PREFIXES.find(([prefix]) => c.startsWith(prefix));
  return hit ? hit[1] : null;
}

function storeColumn(category) {
  const c = String(category || "").toUpperCase();
  if (/CAFE|CAFÉ|AMERICANO/.test(c)) return "Cafe";
  if (/MART|STORE/.test(c)) return "Mart";
  return null;
}

const TERMINAL_SOURCES = new Set(["pos", "market"]);

// The report column and the campus (as written in bank) of one bank row, or null when the row is not counted.
function classifyReportRows(rows) {
  const storeOfSale = new Map();
  const saleKey = (r) => `${String(r.uid || "").toLowerCase()}|${r.transaction_date}`;
  for (const r of rows) {
    if (officeColumn(r.category) || serviceColumn(r.category)) continue;
    const col = storeColumn(r.category);
    if (col && !storeOfSale.has(saleKey(r))) storeOfSale.set(saleKey(r), col);
  }
  return rows.map((r) => {
    const service = serviceColumn(r.category);
    if (service) {
      if (/incentive/i.test(String(r.subcategory || ""))) return null;
      return { row: r, col: service, campus: campusOfCategory(r.category) || r.campus };
    }
    const office = officeColumn(r.category);
    if (office) return { row: r, col: office, campus: r.campus };
    const named = storeColumn(r.category);
    const terminal = TERMINAL_SOURCES.has(String(r.transaction_source || "").trim().toLowerCase());
    if (!named && !terminal) return null;
    const col = named || storeOfSale.get(saleKey(r)) || "Mart";
    return { row: r, col, campus: (named && campusOfCategory(r.category)) || r.campus };
  }).filter(Boolean);
}

// Category prefixes that name the campus of a store or service (legacy typos Talrac / Talac included).
const CAMPUS_PREFIXES = [["CAPITAL", "Capital"], ["ENCANTO", "Encanto"], ["TARLAC", "Tarlac"], ["TALRAC", "Tarlac"], ["TALAC", "Tarlac"], ["BAYDREAM", "Baydream"]];

function sameCampus(a, b) {
  const norm = (v) => String(v || "").trim().toUpperCase().replace(/^TALRAC$/, "TARLAC");
  return norm(a) === norm(b);
}

function reportRange(campus, from, to) {
  if (!campus) throw httpError(400, "Campus is required.");
  const a = isoDay(from, "from");
  const b = isoDay(to, "to");
  const dayCount = Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  if (dayCount < 1) throw httpError(400, "End date is before start date.");
  if (dayCount > 100) throw httpError(400, "The report covers at most 100 days.");
  return { a, b, dayCount };
}

// CashOut/Refund/store and service sales are decreases; the other office categories are increases.
function decreaseColumn(cat) {
  return cat === "CashOut" || cat === "Refund" || STORE_CATEGORIES.includes(cat) || SERVICE_CATEGORIES.includes(cat);
}

// Every source row counted by the report for campus/a..b: { col, day, amount (signed: + adds to the column), ... }.
async function reportEntries(campus, a, b, detail = false) {
  // Rows of this campus's students, plus store/service sales of this campus bought by other campuses.
  const names = campusNames(campus);
  const prefixes = CAMPUS_PREFIXES.filter(([, name]) => names.some((n) => sameCampus(n, name))).map(([prefix]) => prefix);
  const campusOr = [
    ...names.map((n) => `campus.ilike.${q(escapeLike(n))}`),
    ...(prefixes.length ? prefixes : names).map((p) => `category.ilike.${q(`${escapeLike(p)}*`)}`),
  ];
  const filters = [...tsRange("transaction_date", a, b), `or=${enc(`(${campusOr.join(",")})`)}`];
  const select = detail ? BANK_COLS : "id,uid,campus,category,subcategory,transaction_type,payment,quantity,transaction_source,transaction_date";
  const pusanOnly = isPusanCampus(campus);
  const [bank, before, pusan, pusanItems] = await Promise.all([
    pusanOnly ? NO_RESULT : paged("bank", select, filters, "id.asc", 100000),
    pusanOnly ? NO_RESULT : paged("beforebank", select, filters, "id.asc", 100000),
    pusanmartRows(campus, a, b, detail),
    pusanmartItemRows(campus, a, b, select),
  ]);

  const entries = [];
  const tagged = [
    ...classifyReportRows(bank.rows).map((x) => ({ ...x, table: "bank" })),
    ...classifyReportRows(before.rows).map((x) => ({ ...x, table: "beforebank" })),
  ];
  for (const { row: r, col, campus: rowCampus, table } of tagged) {
    if (!names.some((n) => sameCampus(n, rowCampus))) continue;
    const t = String(r.transaction_type || "").toLowerCase();
    const pay = Number(r.payment || 0);
    let amount = 0;
    if (t === "increase") amount = decreaseColumn(col) ? -pay : pay;
    else if (t === "decrease") amount = decreaseColumn(col) ? pay : -pay;
    entries.push({ col, day: phDay(r.transaction_date), amount, table, row: r });
  }
  for (const r of pusan.rows) {
    entries.push({ col: "Pusan Mart", day: phDay(r.register_days), amount: Number(r.allpayments || 0), table: "PusanmartPayments", row: r });
  }
  for (const { row: r, table } of pusanItems.rows) {
    const pay = Number(r.payment || 0);
    const t = String(r.transaction_type || "").toLowerCase();
    const amount = t === "decrease" ? pay : t === "increase" ? -pay : 0;
    entries.push({ col: "Pusan Mart", day: phDay(r.transaction_date), amount, table, row: r });
  }
  return { entries, payAllByDay: pusan.allByDay, truncated: bank.truncated || before.truncated || pusan.truncated || pusanItems.truncated };
}

export async function report({ campus, from, to }) {
  const { a, b, dayCount } = reportRange(campus, from, to);
  const { entries, payAllByDay, truncated } = await reportEntries(campus, a, b);

  // day -> column -> net (sign as the column counts it)
  const sums = new Map();
  for (const { col, day, amount } of entries) {
    const byCol = sums.get(day) || new Map();
    byCol.set(col, (byCol.get(col) || 0) + amount);
    sums.set(day, byCol);
  }

  const adjustments = await rest(
    `report_adjustments?select=report_date,category,value&campus=ilike.${enc(escapeLike(campus))}&report_date=gte.${a}&report_date=lte.${b}`,
  );
  const saved = new Map(adjustments.map((r) => [`${r.report_date}|${r.category}`, Number(r.value)]));

  const days = [];
  for (let i = 0; i < dayCount; i++) {
    const date = new Date(Date.parse(`${a}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
    const values = {};
    const adjusted = [];
    for (const cat of REPORT_CATEGORIES) {
      const net = sums.get(date)?.get(cat) || 0;
      // Service columns keep their sign: a day with more refunds than sales is negative, so the total is net sales.
      values[cat] = SERVICE_CATEGORIES.includes(cat) ? round(net) : round(Math.abs(net));
      const key = `${date}|${cat}`;
      if (saved.has(key)) { values[cat] = round(saved.get(key)); adjusted.push(cat); }
    }
    days.push({ no: i + 1, date, values, adjusted });
  }
  return {
    campus,
    officeCategories: OFFICE_CATEGORIES,
    storeCategories: STORE_CATEGORIES,
    days,
    pusanMart: await pusanmartProfit(entries, payAllByDay, days, a, b),
    truncated,
  };
}

// Pusan Mart column -> sales, cost, profit and the 50/50 split of the profit (Pusan Mart / SMEAG).
// Same cost rules as the PusanMart closing report (pusanmartDaily):
//   - barcode lines ("Pusan Mart Mart"): quantity x store_menus.cost (Bizmatech unit cost, by product name);
//   - Pusan Pay (PusanmartPayments, amount only): the day's typed "Cost Exp." (pusanmart_daily_cost). It covers
//     every Pusan Pay sale of that day, so a campus report takes the campus's share of the day's Pusan Pay sales.
// Sales = the Pusan Mart value shown in the report (a saved manual value included).
// Sales whose cost is not known yet (Pusan Pay day without a typed cost, product without a unit cost) are
// missingSales and stay out of the profit (like the closing report): profit = (sales - missingSales) - cost.
async function pusanmartProfit(entries, payAllByDay, days, a, b) {
  const per = new Map();   // day -> { item, itemCost, pay, uncosted }
  const at = (day) => { if (!per.has(day)) per.set(day, { item: 0, itemCost: 0, pay: 0, uncosted: 0 }); return per.get(day); };
  const isItem = (e) => e.table !== "PusanmartPayments" && nameKey(e.row.category) === nameKey(PUSANMART_ITEM_CATEGORY);
  const itemRows = entries.filter((e) => e.col === "Pusan Mart" && isItem(e));
  const costs = itemRows.length ? await pusanmartUnitCosts() : new Map();
  const uncostedNames = new Map();
  for (const e of entries) {
    if (e.col !== "Pusan Mart") continue;
    const d = at(e.day);
    if (!isItem(e)) { d.pay += e.amount; continue; }   // Pusan Pay (amount only)
    d.item += e.amount;
    const sign = e.amount < 0 ? -1 : 1;
    const qty = Number(e.row.quantity || 0);
    const p = costs.get(nameKey(e.row.subcategory));
    if (p && p.cost != null) d.itemCost += sign * p.cost * qty;
    else {
      d.uncosted += e.amount;
      const name = String(e.row.subcategory || "?").trim();
      uncostedNames.set(name, (uncostedNames.get(name) || 0) + sign * qty);
    }
  }
  const typed = new Map();
  let costTableMissing = false;
  try {
    const rows = await rest(`pusanmart_daily_cost?select=day,cost&day=gte.${a}&day=lte.${b}&limit=1000`);
    for (const r of rows) typed.set(String(r.day).slice(0, 10), Number(r.cost));
  } catch (e) {
    if (!/pusanmart_daily_cost/.test(String(e?.message || ""))) throw e;
    costTableMissing = true;
  }
  const out = [];
  const t = { sales: 0, itemSales: 0, paySales: 0, itemCost: 0, payCost: 0, missingSales: 0, missingPayDays: 0 };
  for (const day of days) {
    const sales = Number(day.values["Pusan Mart"] || 0);
    const d = per.get(day.date) || { item: 0, itemCost: 0, pay: 0, uncosted: 0 };
    let payCost = 0, missing = d.uncosted;
    if (d.pay > 0) {
      const all = payAllByDay.get(day.date) || d.pay;
      if (typed.has(day.date)) payCost = typed.get(day.date) * Math.min(1, d.pay / all);
      else { missing += d.pay; t.missingPayDays++; }
    }
    const cost = round(d.itemCost + payCost);
    const profit = round(sales - missing - cost);
    out.push({ date: day.date, sales, cost, profit, missingSales: round(missing) });
    t.sales += sales; t.itemSales += d.item; t.paySales += d.pay;
    t.itemCost += d.itemCost; t.payCost += payCost; t.missingSales += missing;
  }
  const cost = round(t.itemCost + t.payCost);
  const profit = round(t.sales - t.missingSales - cost);
  const pusanShare = round(profit * PUSANMART_SETTLE_SHARE);
  return {
    share: PUSANMART_SETTLE_SHARE,
    costTableMissing,
    days: out,
    totals: {
      sales: round(t.sales), costedSales: round(t.sales - t.missingSales), itemSales: round(t.itemSales), paySales: round(t.paySales),
      itemCost: round(t.itemCost), payCost: round(t.payCost), cost, profit,
      pusanShare, smeagShare: round(profit - pusanShare),
      // what Pusan Mart is paid: its cost back + its half of the profit
      settlement: round(cost + pusanShare),
      missingSales: round(t.missingSales), missingPayDays: t.missingPayDays,
      uncosted: [...uncostedNames].map(([name, qty]) => ({ name, qty })),
    },
  };
}

// Transactions behind the REPORT cells: one day (from = to) or the whole range, optionally one column.
export async function reportDetail({ campus, from, to, category }) {
  const { a, b } = reportRange(campus, from, to || from);
  if (category && !REPORT_CATEGORIES.includes(category)) throw httpError(400, `Unknown report column: ${category}`);
  const { entries, truncated } = await reportEntries(campus, a, b, true);
  const rows = entries
    .filter((e) => !category || e.col === category)
    .map(({ col, amount, table, row: r }) => table === "PusanmartPayments"
      ? {
          id: r.id, table, column: col, date: phDateTime(r.register_days), uid: r.nfcid, studentId: null, name: r.name,
          campus: null, category: "Pusan Mart", subcategory: "Pusan Mart purchase", type: "decrease",
          payment: round(r.allpayments), amount: round(amount), balance: null, source: "PusanmartPayments", remark: null, staff: null,
        }
      : {
          id: r.id, table, column: col, date: phDateTime(r.transaction_date), uid: r.uid, studentId: r.studentid, name: r.name,
          campus: r.campus, category: r.category, subcategory: r.subcategory, type: r.transaction_type,
          payment: round(r.payment), amount: round(amount), balance: r.totalmoney == null ? null : round(r.totalmoney),
          source: r.transaction_source, remark: r.remark, staff: r.order == null ? null : String(r.order),
        })
    .sort((x, y) => REPORT_CATEGORIES.indexOf(x.column) - REPORT_CATEGORIES.indexOf(y.column) ||
      String(x.date).localeCompare(String(y.date)) || Number(x.id) - Number(y.id));
  return { campus, from: a, to: b, category: category || null, columns: REPORT_CATEGORIES, rows, truncated };
}

// PUSAN MART purchases (PusanmartPayments) per PH day. The table has no campus, so a campus
// report counts the purchases of that campus's students (person.campus, like bank.campus);
// campus "PUSAN MART" counts every purchase.
async function pusanmartRows(campus, from, to, detail = false) {
  const filters = ["center=eq.PusanMart", ...tsRange("register_days", from, to)];
  const select = detail ? "id,nfcid,name,allpayments,register_days" : "id,nfcid,allpayments,register_days";
  const { rows, truncated } = await paged("PusanmartPayments", select, filters, "id.asc", 100000);
  // every campus's Pusan Pay sales per day (the typed daily cost is shared out by these)
  const allByDay = new Map();
  for (const r of rows) allByDay.set(phDay(r.register_days), (allByDay.get(phDay(r.register_days)) || 0) + Number(r.allpayments || 0));
  if (isPusanCampus(campus)) return { rows, truncated, allByDay };
  const wanted = new Set(campusNames(campus).map((n) => n.toLowerCase()));
  const campusOf = await campusesFor(rows.map((r) => r.nfcid));
  return { rows: rows.filter((r) => wanted.has(String(campusOf.get(String(r.nfcid || "").toLowerCase()) || "").toLowerCase())), truncated, allByDay };
}

// Pusan Mart barcode sales (Sales screen scan, pos_checkout): bank rows with category "Pusan Mart Mart" and
// bank.campus "Pusan Mart", so the campus filter above never sees them and they write no PusanmartPayments row.
// They belong to the Pusan Mart column like Pusan Pay: filed under the buyer's campus (person.campus),
// campus "PUSAN MART" counts every one. Same rows as the mart Pay List "Barcode sales".
const PUSANMART_ITEM_CATEGORY = "Pusan Mart Mart";
async function pusanmartItemRows(campus, from, to, select) {
  const filters = [`category=ilike.${enc(escapeLike(PUSANMART_ITEM_CATEGORY))}`, ...tsRange("transaction_date", from, to)];
  const [bank, before] = await Promise.all([
    paged("bank", select, filters, "id.asc", 100000),
    paged("beforebank", select, filters, "id.asc", 100000),
  ]);
  const rows = [...bank.rows.map((row) => ({ row, table: "bank" })), ...before.rows.map((row) => ({ row, table: "beforebank" }))];
  const truncated = bank.truncated || before.truncated;
  if (isPusanCampus(campus)) return { rows, truncated };
  const wanted = new Set(campusNames(campus).map((n) => n.toLowerCase()));
  const campusOf = await campusesFor(rows.map((x) => x.row.uid));
  return { rows: rows.filter((x) => wanted.has(String(campusOf.get(String(x.row.uid || "").toLowerCase()) || "").toLowerCase())), truncated };
}

async function campusesFor(uids) {
  const list = [...new Set(uids.filter(Boolean).map((u) => String(u)))];
  const campuses = new Map();
  for (const part of chunk(list, 150)) {
    const rows = await rest(`person?select=uid,campus&uid=in.(${part.map((u) => q(u)).join(",")})&order=id.asc`);
    for (const r of rows) {
      const key = String(r.uid).toLowerCase();
      if (!campuses.has(key)) campuses.set(key, r.campus); // duplicate uids: oldest person row
    }
  }
  return campuses;
}

// UPDATE: store every value shown on screen for that campus/day (upsert on campus+date+category).
export async function saveReport({ campus, days }, staffLoginId) {
  if (!campus) throw httpError(400, "Campus is required.");
  if (!Array.isArray(days) || !days.length) throw httpError(400, "Search the report first, then UPDATE.");
  const now = new Date().toISOString();
  const rows = [];
  const seen = new Set();
  for (const d of days) {
    const date = isoDay(d.date, "date");
    if (seen.has(date)) throw httpError(400, `Date ${date} appears twice.`);
    seen.add(date);
    for (const cat of REPORT_CATEGORIES) {
      const v = numOrNull(d.values?.[cat], `${cat} (${date})`) ?? 0;
      rows.push({ campus, report_date: date, category: cat, value: round(v), updated_by: staffLoginId || "System", updated_at: now });
    }
  }
  if (rows.length > 100 * REPORT_CATEGORIES.length) throw httpError(400, "The report covers at most 100 days.");
  await rest("report_adjustments?on_conflict=campus,report_date,category", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates" },
    body: rows,
  });
  return { saved: rows.length };
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
