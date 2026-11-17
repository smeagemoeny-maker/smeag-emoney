// Supabase (PostgREST) version of backoffice.mjs: same exports, same return shapes.
// Office transactions run in the pos_office_transaction RPC
// (migrations/supabase_backoffice_functions.sql) so bank rows + balance change together.
//
// Supabase notes: timestamps are timestamptz (absolute time); the screens work in
// Philippine time (UTC+8, no DST). PostgREST returns at most 1000 rows per request.
import { normalizeUid } from "./db.mjs";
import { httpError } from "./repository.mjs";
import { escapeLike, q, rest } from "./supabaseRepository.mjs";
import { validateOfficeLines } from "./backoffice.mjs";

const PAGE_SIZE = 1000;
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const PRODUCT_SELECT = "id,Campus,m_menu,s_menu,image_path,payment,stock,sales_number,min_stock";
const PERSON_SELECT = "id,uid,studentid,name,age,gender,campus,s_date,e_date,totalmoney";

// ---------- products (store_menus) ----------

export async function createProduct({ campus, mMenu, sMenu, imagePath, payment, stock, minStock }, staffLoginId) {
  if (!campus) throw httpError(400, "Campus is required.");
  if (!String(sMenu || "").trim()) throw httpError(400, "Product name is required.");
  const price = Number(payment);
  if (!(price >= 0)) throw httpError(400, "Price must be 0 or more.");
  const [row] = await rest(`store_menus?select=${PRODUCT_SELECT}`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: {
      Campus: campus,
      m_menu: mMenu || null,
      s_menu: String(sMenu).trim(),
      image_path: imagePath || null,
      payment: price,
      stock: toInt(stock, 0),
      min_stock: toInt(minStock, 5),
      manager: staffLoginId || null,
    },
  });
  return mapProduct(row);
}

const PRODUCT_FIELDS = {
  campus: "Campus",
  mMenu: "m_menu",
  sMenu: "s_menu",
  imagePath: "image_path",
  payment: "payment",
  stock: "stock",
  minStock: "min_stock",
};

export async function updateProduct(id, changes) {
  const body = {};
  for (const [key, column] of Object.entries(PRODUCT_FIELDS)) {
    if (changes[key] === undefined) continue;
    let value = changes[key];
    if (key === "payment") {
      value = Number(value);
      if (!(value >= 0)) throw httpError(400, "Price must be 0 or more.");
    } else if (key === "stock" || key === "minStock") {
      value = toInt(value, NaN);
      if (!(value >= 0)) throw httpError(400, `${key === "stock" ? "Stock" : "Minimum stock"} must be 0 or more.`);
    } else if (key === "sMenu" && !String(value || "").trim()) {
      throw httpError(400, "Product name is required.");
    }
    body[column] = value === "" ? null : value;
  }
  if (!Object.keys(body).length) throw httpError(400, "Nothing to update.");
  const rows = await rest(`store_menus?id=eq.${productId(id)}&select=${PRODUCT_SELECT}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body,
  });
  if (!rows.length) throw httpError(404, "Product not found.");
  return mapProduct(rows[0]);
}

export async function deleteProduct(id) {
  const rows = await rest(`store_menus?id=eq.${productId(id)}&select=id`, {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
  if (!rows.length) throw httpError(404, "Product not found.");
  return { id: Number(id) };
}

export async function getProduct(id) {
  const rows = await rest(`store_menus?id=eq.${productId(id)}&select=${PRODUCT_SELECT}`);
  if (!rows[0]) throw httpError(404, "Product not found.");
  return mapProduct(rows[0]);
}

// ---------- sales history / report (bank) ----------

// "YYYY-MM-DD".."YYYY-MM-DD" in Philippine time -> absolute timestamptz bounds.
function range(from, to) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(from || "")) || !re.test(String(to || ""))) throw httpError(400, "from/to must be YYYY-MM-DD.");
  return [`${from}T00:00:00+08:00`, `${to}T23:59:59.999+08:00`];
}

function phDateTime(value) {
  if (!value) return null;
  return new Date(new Date(value).getTime() + PH_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

// Same filter as the MySQL version: date range, campus (both 'Tarlac' and legacy 'Talrac'),
// optional category; all comparisons case-insensitive.
function bankFilter({ from, to, campus, category }) {
  const [start, end] = range(from, to);
  const parts = [
    `transaction_date=gte.${encodeURIComponent(start)}`,
    `transaction_date=lte.${encodeURIComponent(end)}`,
  ];
  if (campus && campus !== "All Campuses") {
    const names = [campus];
    if (String(campus).toUpperCase() === "TARLAC") names.push("Talrac");
    const or = names.map((name) => `campus.ilike.${q(escapeLike(name))}`).join(",");
    parts.push(`or=${encodeURIComponent(`(${or})`)}`);
  }
  if (category) parts.push(`category=ilike.${encodeURIComponent(escapeLike(category))}`);
  return parts.join("&");
}

async function pagedBank(filter, select, max) {
  const rows = [];
  for (let offset = 0; offset < max; offset += PAGE_SIZE) {
    const limit = Math.min(PAGE_SIZE, max - offset);
    const page = await rest(`bank?select=${select}&${filter}&order=transaction_date.desc,id.desc&offset=${offset}&limit=${limit}`);
    rows.push(...page);
    if (page.length < limit) break;
  }
  return rows;
}

export async function listSales(filter) {
  const select = "id,uid,studentid,name,campus,beforeamount,category,subcategory,transaction_type,payment,totalmoney,quantity,transaction_date,remark,transaction_source,order";
  const rows = await pagedBank(bankFilter(filter), select, 5000);
  return rows.map((r) => ({
    id: Number(r.id),
    uid: r.uid,
    studentId: r.studentid,
    name: r.name,
    campus: r.campus,
    beforeAmount: Number(r.beforeamount || 0),
    category: r.category,
    subcategory: r.subcategory,
    type: r.transaction_type,
    payment: Number(r.payment || 0),
    totalMoney: Number(r.totalmoney || 0),
    quantity: Number(r.quantity || 0),
    date: phDateTime(r.transaction_date),
    remark: r.remark,
    source: r.transaction_source,
    order: r.order,
  }));
}

// Same numbers as the MySQL version (Android Report screen), aggregated here because
// PostgREST has no GROUP BY. Capped at 50,000 sale rows per report.
export async function salesReport({ from, to, campus, category, productCampus }) {
  const rows = await pagedBank(
    `${bankFilter({ from, to, campus, category })}&transaction_type=eq.decrease`,
    "id,subcategory,payment,quantity,transaction_date,order",
    50000,
  );

  const totals = new Map();
  const orders = new Set();
  const top = new Map();
  for (const r of rows) {
    const day = phDateTime(r.transaction_date).slice(0, 10);
    totals.set(day, (totals.get(day) || 0) + Number(r.payment || 0));
    orders.add(r.order ?? `id:${r.id}`);
    const item = top.get(r.subcategory) || { name: r.subcategory, quantity: 0, amount: 0 };
    item.quantity += Number(r.quantity || 0);
    item.amount += Number(r.payment || 0);
    top.set(r.subcategory, item);
  }

  const stockCampus = productCampus || campus;
  const stockFilter = stockCampus && stockCampus !== "All Campuses"
    ? `&or=${encodeURIComponent(`(Campus.ilike.${q(escapeLike(stockCampus))},Campus.ilike.all)`)}`
    : "";
  const products = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await rest(`store_menus?select=${PRODUCT_SELECT}${stockFilter}&order=id.asc&offset=${offset}&limit=${PAGE_SIZE}`);
    products.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  // stock <= min_stock compares two columns, which PostgREST filters can't express.
  const lowStock = products
    .filter((p) => Number(p.stock || 0) <= Number(p.min_stock || 0))
    .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0))
    .map(mapProduct);

  const days = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`) && days.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, total: round(totals.get(key) || 0) });
  }
  return {
    daily: days,
    total: round(days.reduce((sum, d) => sum + d.total, 0)),
    orderCount: orders.size,
    topProducts: [...top.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10)
      .map((t) => ({ ...t, amount: round(t.amount) })),
    lowStock,
  };
}

// ---------- buyers (person) ----------

export async function searchPeople({ search }) {
  const term = String(search || "").trim();
  if (!term) {
    const rows = await rest(`person?select=${PERSON_SELECT}&order=register_date.desc.nullslast,id.desc&limit=200`);
    return rows.map(mapPerson);
  }
  const like = q(`*${escapeLike(term)}*`);
  const or = `(uid.ilike.${like},studentid.ilike.${like},name.ilike.${like})`;
  const rows = await rest(`person?select=${PERSON_SELECT}&or=${encodeURIComponent(or)}&order=name.asc&limit=200`);
  return rows.map(mapPerson);
}

// Profile fields only; balances change only through payments/charges/office transactions.
export async function updatePerson(id, { name, studentId, age }) {
  const body = {};
  if (name !== undefined) {
    if (!String(name).trim()) throw httpError(400, "Name is required.");
    body.name = String(name).trim();
  }
  if (studentId !== undefined) body.studentid = String(studentId).trim() || null;
  if (age !== undefined) {
    const value = age === "" || age === null ? null : toInt(age, NaN);
    if (value !== null && !(value >= 0)) throw httpError(400, "Age must be 0 or more.");
    body.age = value;
  }
  if (!Object.keys(body).length) throw httpError(400, "Nothing to update.");
  const rows = await rest(`person?id=eq.${productId(id)}&select=${PERSON_SELECT}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body,
  });
  if (!rows.length) throw httpError(404, "Buyer not found.");
  return mapPerson(rows[0]);
}

// ---------- PusanMart pay list ----------

export async function listPusanmartPayments({ from, to }) {
  const [start, end] = range(from, to);
  const filter = `center=eq.PusanMart&register_days=gte.${encodeURIComponent(start)}&register_days=lte.${encodeURIComponent(end)}`;
  const rows = [];
  for (let offset = 0; offset < 5000; offset += PAGE_SIZE) {
    const page = await rest(
      `PusanmartPayments?select=id,nfcid,center,name,allpayments,stock,register_days&${filter}&order=register_days.desc,id.desc&offset=${offset}&limit=${PAGE_SIZE}`,
    );
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows.map((r) => ({
    id: Number(r.id),
    nfcid: r.nfcid,
    center: r.center,
    name: r.name,
    allPayments: Number(r.allpayments || 0),
    stock: Number(r.stock || 0),
    date: phDateTime(r.register_days),
  }));
}

// ---------- PusanMart daily sales / cost / net ----------
// Sales = PusanmartPayments per Philippine day (matches the PusanMart POS "Net Sales").
// Cost  = "Cost Exp." typed in from the POS Daily Sales Report (pusanmart_daily_cost).
// Net   = sales - cost, only for days whose cost was entered.

export async function pusanmartDaily({ from, to }) {
  const [start, end] = range(from, to);
  if (from > to) throw httpError(400, "Start date must be on or before the end date.");
  const filter = `center=eq.PusanMart&register_days=gte.${encodeURIComponent(start)}&register_days=lte.${encodeURIComponent(end)}`;
  const sales = new Map();
  for (let offset = 0; offset < 50000; offset += PAGE_SIZE) {
    const page = await rest(`PusanmartPayments?select=id,allpayments,register_days&${filter}&order=id.asc&offset=${offset}&limit=${PAGE_SIZE}`);
    for (const r of page) {
      const day = phDateTime(r.register_days).slice(0, 10);
      const s = sales.get(day) || { count: 0, sales: 0 };
      s.count += 1;
      s.sales += Number(r.allpayments || 0);
      sales.set(day, s);
    }
    if (page.length < PAGE_SIZE) break;
  }
  const costs = new Map();
  let costTableMissing = false;
  try {
    const costRows = await rest(`pusanmart_daily_cost?select=day,cost,note,updated_by,updated_at&day=gte.${from}&day=lte.${to}&limit=${PAGE_SIZE}`);
    for (const c of costRows) costs.set(c.day, c);
  } catch (e) {
    if (!isMissingCostTable(e)) throw e;
    costTableMissing = true; // sales still show until the migration is run
  }

  const days = [];
  for (let d = new Date(`${to}T00:00:00Z`); d >= new Date(`${from}T00:00:00Z`) && days.length < 400; d.setUTCDate(d.getUTCDate() - 1)) {
    const key = d.toISOString().slice(0, 10);
    const s = sales.get(key) || { count: 0, sales: 0 };
    const c = costs.get(key);
    const cost = c ? Number(c.cost) : null;
    days.push({
      date: key,
      count: s.count,
      sales: round(s.sales),
      cost,
      net: cost === null ? null : round(s.sales - cost),
      note: c?.note || null,
      updatedBy: c?.updated_by || null,
      updatedAt: c ? phDateTime(c.updated_at) : null,
    });
  }
  const withCost = days.filter((d) => d.cost !== null);
  return {
    days,
    costTableMissing,
    totals: {
      count: days.reduce((a, d) => a + d.count, 0),
      sales: round(days.reduce((a, d) => a + d.sales, 0)),
      cost: round(withCost.reduce((a, d) => a + d.cost, 0)),
      net: round(withCost.reduce((a, d) => a + d.net, 0)),
      // sales of the days that have a cost, so the margin compares like with like
      salesWithCost: round(withCost.reduce((a, d) => a + d.sales, 0)),
      daysWithCost: withCost.length,
      daysMissingCost: days.filter((d) => d.cost === null && d.count > 0).length,
    },
  };
}

function isMissingCostTable(e) {
  return /pusanmart_daily_cost/.test(String(e?.message || "")) && /schema cache|does not exist/i.test(String(e?.message || ""));
}

const MISSING_COST_TABLE = "The pusanmart_daily_cost table is missing: run api/migrations/supabase_pusanmart_daily_cost.sql in the Supabase SQL Editor.";

// cost "" / null removes the day's entry.
export async function savePusanmartCost(date, input, staffLoginId) {
  try {
    return await writePusanmartCost(date, input, staffLoginId);
  } catch (e) {
    if (isMissingCostTable(e)) throw httpError(503, MISSING_COST_TABLE);
    throw e;
  }
}

async function writePusanmartCost(date, { cost, note } = {}, staffLoginId) {
  const [day] = range(date, date);
  const key = day.slice(0, 10);
  if (cost === null || cost === undefined || String(cost).trim() === "") {
    await rest(`pusanmart_daily_cost?day=eq.${key}`, { method: "DELETE" });
    return { date: key, cost: null };
  }
  const value = Number(String(cost).replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0) throw httpError(400, "Cost must be 0 or more.");
  const [row] = await rest("pusanmart_daily_cost?on_conflict=day&select=day,cost,note,updated_by,updated_at", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      day: key,
      cost: round(value),
      note: String(note || "").trim() || null,
      updated_by: staffLoginId || null,
      updated_at: new Date().toISOString(),
    },
  });
  return { date: row.day, cost: Number(row.cost), note: row.note, updatedBy: row.updated_by, updatedAt: phDateTime(row.updated_at) };
}

// ---------- office program (office_menus + bank) ----------

export async function listOfficeMenus({ campus }) {
  const names = ["All"];
  if (campus) names.push(campus);
  const upper = String(campus || "").toUpperCase();
  if (upper === "TARLAC") names.push("Talrac");
  if (upper === "TALRAC") names.push("Tarlac");
  const or = names.map((name) => `Campus.ilike.${q(escapeLike(name))}`).join(",");
  const rows = await rest(`office_menus?select=id,Campus,m_menu,s_menu,payment&or=${encodeURIComponent(`(${or})`)}&order=id.asc&limit=${PAGE_SIZE}`);
  return rows.map((r) => ({ id: r.id, campus: r.Campus, mMenu: r.m_menu, sMenu: r.s_menu, payment: Number(r.payment || 0) }));
}

export async function createOfficeTransaction({ uid, lines, clientKey }, staffLoginId) {
  const normalized = normalizeUid(uid);
  if (!normalized) throw httpError(400, "UID is required.");
  if (!staffLoginId) throw httpError(401, "Staff login is required.");
  validateOfficeLines(lines);
  const result = await rest("rpc/pos_office_transaction", {
    method: "POST",
    body: {
      p_uid: normalized,
      p_lines: lines.map((line) => ({
        type: String(line.type).toUpperCase(),
        mMenu: String(line.mMenu).trim(),
        sMenu: String(line.sMenu).trim(),
        unitPrice: Number(line.unitPrice),
        qty: Number(line.qty),
      })),
      p_staff_id: String(staffLoginId),
      // One key per cart on the office screen: a repeated Confirm returns the first result, no second charge.
      p_client_key: typeof clientKey === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(clientKey) ? clientKey : null,
    },
  });
  return {
    id: Number(result.id),
    repeated: result.repeated === true,
    bankIds: (result.bankIds || []).map(Number),
    balanceBefore: Number(result.balanceBefore),
    balanceAfter: Number(result.balanceAfter),
    netChange: Number(result.netChange),
  };
}

// ---------- helpers ----------

function productId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, "Invalid id.");
  return n;
}

function mapProduct(row) {
  return {
    id: row.id,
    campus: row.Campus,
    mMenu: row.m_menu,
    sMenu: row.s_menu,
    imagePath: row.image_path,
    payment: Number(row.payment || 0),
    stock: Number(row.stock || 0),
    salesNumber: Number(row.sales_number || 0),
    minStock: Number(row.min_stock || 0),
  };
}

function mapPerson(row) {
  return {
    id: row.id,
    uid: row.uid,
    studentId: row.studentid,
    name: row.name,
    age: row.age,
    gender: row.gender,
    campus: row.campus,
    startDate: row.s_date,
    endDate: row.e_date,
    totalMoney: Number(row.totalmoney || 0),
  };
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
