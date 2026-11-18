// Supabase (PostgREST) version of backoffice.mjs: same exports, same return shapes.
// Office transactions run in the pos_office_transaction RPC
// (migrations/supabase_backoffice_functions.sql) so bank rows + balance change together.
//
// Supabase notes: timestamps are timestamptz (absolute time); the screens work in
// Philippine time (UTC+8, no DST). PostgREST returns at most 1000 rows per request.
import { normalizeUid } from "./db.mjs";
import { httpError } from "./repository.mjs";
import { cleanBarcode, escapeLike, q, rest, withProductColumns } from "./supabaseRepository.mjs";
import { validateOfficeLines } from "./backoffice.mjs";

const PAGE_SIZE = 1000;
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const PRODUCT_SELECT = "id,Campus,m_menu,s_menu,image_path,payment,stock,sales_number,min_stock";
const PERSON_SELECT = "id,uid,studentid,name,age,gender,campus,s_date,e_date,totalmoney";

// ---------- products (store_menus) ----------

export async function createProduct({ campus, mMenu, sMenu, imagePath, payment, stock, minStock, barcode }, staffLoginId) {
  if (!campus) throw httpError(400, "Campus is required.");
  if (!String(sMenu || "").trim()) throw httpError(400, "Product name is required.");
  const price = Number(payment);
  if (!(price >= 0)) throw httpError(400, "Price must be 0 or more.");
  const code = cleanBarcode(barcode);
  if (code) await assertBarcodeFree(campus, code);
  const body = {
    Campus: campus,
    m_menu: mMenu || null,
    s_menu: String(sMenu).trim(),
    image_path: imagePath || null,
    payment: price,
    stock: toInt(stock, 0),
    min_stock: toInt(minStock, 5),
    manager: staffLoginId || null,
  };
  const [row] = await withProductColumns((columns, extras) => {
    if (code && !extras) throw httpError(503, "Barcodes are not set up yet: run api/migrations/supabase_pusanmart_products_import.sql.");
    return rest(`store_menus?select=${columns}`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: code ? { ...body, barcode: code } : body,
    });
  });
  return mapProduct(row);
}

// One barcode = one product per campus, so a scan at the counter always finds exactly one item.
async function assertBarcodeFree(campus, code, exceptId) {
  const rows = await withProductColumns((_, extras) => (extras
    ? rest(`store_menus?select=id,s_menu&barcode=eq.${encodeURIComponent(q(code))}&Campus=ilike.${encodeURIComponent(q(escapeLike(campus)))}&limit=2`)
    : []));
  const other = rows.find((r) => Number(r.id) !== Number(exceptId));
  if (other) throw httpError(409, `Barcode ${code} is already used by ${other.s_menu || `product ${other.id}`}.`);
}

const PRODUCT_FIELDS = {
  campus: "Campus",
  mMenu: "m_menu",
  sMenu: "s_menu",
  imagePath: "image_path",
  payment: "payment",
  stock: "stock",
  minStock: "min_stock",
  barcode: "barcode",
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
    } else if (key === "barcode") {
      value = cleanBarcode(value);
    } else if (key === "sMenu" && !String(value || "").trim()) {
      throw httpError(400, "Product name is required.");
    }
    body[column] = value === "" ? null : value;
  }
  if (!Object.keys(body).length) throw httpError(400, "Nothing to update.");
  if (body.barcode) {
    const [current] = await rest(`store_menus?id=eq.${productId(id)}&select=Campus`);
    if (current) await assertBarcodeFree(current.Campus, body.barcode, id);
  }
  const rows = await withProductColumns((columns, extras) => {
    if ("barcode" in body && !extras) throw httpError(503, "Barcodes are not set up yet: run api/migrations/supabase_pusanmart_products_import.sql.");
    return rest(`store_menus?id=eq.${productId(id)}&select=${columns}`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body,
    });
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
  const rows = await withProductColumns((columns) => rest(`store_menus?id=eq.${productId(id)}&select=${columns}`));
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
  // memo exists only after supabase_pusanmart_memo.sql: fall back to the old column list until then.
  const load = async (cols) => {
    const rows = [];
    for (let offset = 0; offset < 5000; offset += PAGE_SIZE) {
      const page = await rest(
        `PusanmartPayments?select=${cols}&${filter}&order=register_days.desc,id.desc&offset=${offset}&limit=${PAGE_SIZE}`,
      );
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return rows;
  };
  const baseCols = "id,nfcid,center,name,allpayments,stock,register_days";
  let rows;
  try {
    rows = await load(`${baseCols},memo,bank_order,staff`);
  } catch (e) {
    if (!/memo|bank_order|staff/.test(String(e?.message || ""))) throw e;
    rows = await load(baseCols);
  }

  // Discount label lives on the linked bank row (remark = "<label>" or "<label> · <memo>", pos_pusanmart_pay).
  // Unit price (before discount) = paid / (1 - rate), so the export can show list price, discount and paid.
  const labels = new Map();
  if (rows.some((r) => r.bank_order)) {
    const bankFilter = `category=eq.${encodeURIComponent("Pusan Mart")}&transaction_source=eq.${encodeURIComponent("PWA POS")}` +
      `&transaction_date=gte.${encodeURIComponent(start)}&transaction_date=lte.${encodeURIComponent(end)}`;
    for (let offset = 0; offset < 20000; offset += PAGE_SIZE) {
      const page = await rest(`bank?select=id,order,remark&${bankFilter}&order=id.asc&offset=${offset}&limit=${PAGE_SIZE}`);
      for (const b of page) if (b.order) labels.set(b.order, String(b.remark || "").split(" · ")[0].trim());
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows.map((r) => {
    const paid = Number(r.allpayments || 0);
    const label = (r.bank_order && labels.get(r.bank_order)) || "No Discount";
    const pct = /(\d+(?:\.\d+)?)\s*%/.exec(label);
    const rate = pct ? Math.min(0.99, Number(pct[1]) / 100) : 0;
    const unitPrice = round(paid / (1 - rate));
    return {
      id: Number(r.id),
      nfcid: r.nfcid,
      center: r.center,
      name: r.name,
      allPayments: paid,
      unitPrice,
      discountLabel: label,
      discountRate: rate,
      discountAmount: round(unitPrice - paid),
      stock: Number(r.stock || 0),
      date: phDateTime(r.register_days),
      memo: r.memo || "",
      staff: r.staff || "",
    };
  });
}

// ---------- PusanMart daily sales / cost / net (closing report, R1:SUMMARY) ----------
// Two kinds of Pusan Mart sales:
//   1. Barcode sales: items scanned on the Sales screen (pos_checkout -> one bank row per item,
//      category "Pusan Mart Mart"). Their cost is calculated automatically: quantity x store_menus.cost
//      (unit cost from the Bizmatech POS export, matched by product name).
//   2. Pusan Pay: amount-only payments (PusanmartPayments). Items were rung up on the Bizmatech POS,
//      so their cost is the "Cost Exp." typed in from its Daily Sales Report (pusanmart_daily_cost).
// Cost = auto (barcode) + typed (Pusan Pay). Profit = net sales - cost.
// Settlement (what Pusan Mart is paid) = cost + SETTLE_SHARE x profit.
export const PUSANMART_SETTLE_SHARE = 0.5;
const PUSANMART_ITEM_CATEGORY = "Pusan Mart Mart";
const PUSANMART_CAMPUS = "Pusan Mart";

const nameKey = (v) => String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");

async function pusanmartUnitCosts() {
  // Current Pusan Mart list first, then the old hand-made list, so a name only on the old list still has a price.
  const byName = new Map();
  for (const campus of ["PUSAN MART", "PUSAN MART (OLD)"]) {
    let rows;
    try {
      rows = await rest(`store_menus?select=s_menu,payment,cost&Campus=ilike.${encodeURIComponent(escapeLike(campus))}&limit=5000`);
    } catch (e) {
      if (!/cost/.test(String(e?.message || ""))) throw e;
      rows = (await rest(`store_menus?select=s_menu,payment&Campus=ilike.${encodeURIComponent(escapeLike(campus))}&limit=5000`))
        .map((r) => ({ ...r, cost: null }));
    }
    for (const r of rows) {
      const key = nameKey(r.s_menu);
      const prev = byName.get(key);
      if (!prev || (prev.cost == null && r.cost != null)) {
        byName.set(key, { cost: r.cost == null ? null : Number(r.cost), price: Number(r.payment || 0) });
      }
    }
  }
  return byName;
}

export async function pusanmartDaily({ from, to }) {
  const [start, end] = range(from, to);
  if (from > to) throw httpError(400, "Start date must be on or before the end date.");
  const blank = () => ({
    payOrders: new Set(), paySales: 0, payGross: 0,
    itemOrders: new Set(), itemSales: 0, itemGross: 0, itemCost: 0, itemQty: 0, itemLines: 0, uncosted: new Map(),
  });
  const agg = new Map();
  const dayOf = (key) => { if (!agg.has(key)) agg.set(key, blank()); return agg.get(key); };

  // Same rows as the Report Summary (salesReport for campus "Pusan Mart"): every bank decrease row of the
  // Pusan Mart campus, any source. So Net Sales / Trans. here always equal Total Revenue / Transactions there.
  //   category "Pusan Mart Mart" -> barcode item line; anything else -> Pusan Pay (amount only).
  const rows = await pagedBank(
    `${bankFilter({ from, to, campus: PUSANMART_CAMPUS })}&transaction_type=eq.decrease`,
    "id,category,subcategory,quantity,payment,remark,order,transaction_date",
    100000,
  );
  const itemRows = [];
  for (const b of rows) {
    if (nameKey(b.category) === nameKey(PUSANMART_ITEM_CATEGORY)) { itemRows.push(b); continue; }
    // Pusan Pay: discount label is the remark ("<label>" or "<label> · <memo>"); gross = paid / (1 - rate).
    const d = dayOf(phDateTime(b.transaction_date).slice(0, 10));
    const paid = Number(b.payment || 0);
    const pct = /(\d+(?:\.\d+)?)\s*%/.exec(String(b.remark || "").split(" · ")[0]);
    const rate = pct ? Math.min(0.99, Number(pct[1]) / 100) : 0;
    d.payOrders.add(b.order ?? `id:${b.id}`);
    d.paySales += paid;
    d.payGross += round(paid / (1 - rate));
  }

  const costs = itemRows.length ? await pusanmartUnitCosts() : new Map();
  for (const b of itemRows) {
    const d = dayOf(phDateTime(b.transaction_date).slice(0, 10));
    const qty = Number(b.quantity || 0);
    const paid = Number(b.payment || 0);
    const p = costs.get(nameKey(b.subcategory));
    d.itemOrders.add(b.order ?? `id:${b.id}`);
    d.itemSales += paid;
    d.itemQty += qty;
    d.itemLines += 1;
    d.itemGross += p && p.price ? Math.max(paid, p.price * qty) : paid;
    if (p && p.cost != null) d.itemCost += p.cost * qty;
    else {
      const name = String(b.subcategory || "?").trim();
      d.uncosted.set(name, (d.uncosted.get(name) || 0) + qty);
    }
  }

  const typed = new Map();
  let costTableMissing = false;
  try {
    const costRows = await rest(`pusanmart_daily_cost?select=day,cost,note,updated_by,updated_at&day=gte.${from}&day=lte.${to}&limit=${PAGE_SIZE}`);
    for (const c of costRows) typed.set(c.day, c);
  } catch (e) {
    if (!isMissingCostTable(e)) throw e;
    costTableMissing = true; // sales still show until the migration is run
  }

  const days = [];
  for (let dt = new Date(`${to}T00:00:00Z`); dt >= new Date(`${from}T00:00:00Z`) && days.length < 400; dt.setUTCDate(dt.getUTCDate() - 1)) {
    const key = dt.toISOString().slice(0, 10);
    const a = agg.get(key) || blank();
    const c = typed.get(key);
    const payCost = c ? Number(c.cost) : null;
    const sales = round(a.paySales + a.itemSales);
    const gross = round(a.payGross + a.itemGross);
    const itemCost = round(a.itemCost);
    // Cost is known when every Pusan Pay day has its typed cost (barcode cost is always automatic).
    const payCount = a.payOrders.size;
    const payNeedsCost = payCount > 0 && payCost === null;
    const cost = payNeedsCost ? null : round(itemCost + (payCost || 0));
    const net = cost === null ? null : round(sales - cost);
    days.push({
      date: key,
      count: payCount + a.itemOrders.size,
      gross,
      discount: round(Math.max(0, gross - sales)),
      sales,
      cost,
      // cost found so far: barcode (auto) + typed Pusan Pay cost; equals cost once nothing is missing
      knownCost: round(itemCost + (payCost || 0)),
      net,
      settlement: net === null ? null : round(cost + round(net * PUSANMART_SETTLE_SHARE)),
      pay: { count: payCount, sales: round(a.paySales), cost: payCost, missing: payNeedsCost },
      items: {
        count: a.itemOrders.size, lines: a.itemLines, qty: a.itemQty, sales: round(a.itemSales), cost: itemCost,
        uncosted: [...a.uncosted].map(([name, qty]) => ({ name, qty })),
      },
      // the typed Pusan Pay cost so far, even when the day still has no sales
      typedCost: payCost,
      note: c?.note || null,
      updatedBy: c?.updated_by || null,
      updatedAt: c ? phDateTime(c.updated_at) : null,
    });
  }
  const withCost = days.filter((d) => d.cost !== null && (d.count > 0 || d.cost > 0));
  return {
    days,
    costTableMissing,
    settleShare: PUSANMART_SETTLE_SHARE,
    totals: {
      count: days.reduce((a, d) => a + d.count, 0),
      gross: round(days.reduce((a, d) => a + d.gross, 0)),
      discount: round(days.reduce((a, d) => a + d.discount, 0)),
      sales: round(days.reduce((a, d) => a + d.sales, 0)),
      cost: round(withCost.reduce((a, d) => a + d.cost, 0)),
      net: round(withCost.reduce((a, d) => a + d.net, 0)),
      settlement: round(withCost.reduce((a, d) => a + d.settlement, 0)),
      itemCost: round(days.reduce((a, d) => a + d.items.cost, 0)),
      itemSales: round(days.reduce((a, d) => a + d.items.sales, 0)),
      knownCost: round(days.reduce((a, d) => a + d.knownCost, 0)),
      // Pusan Pay sales whose cost is still to be typed in (Bizmatech "Cost Exp.")
      paySalesMissingCost: round(days.filter((d) => d.pay.missing).reduce((a, d) => a + d.pay.sales, 0)),
      // sales of the days that have a cost, so the margin compares like with like
      salesWithCost: round(withCost.reduce((a, d) => a + d.sales, 0)),
      daysWithCost: withCost.length,
      daysMissingCost: days.filter((d) => d.cost === null).length,
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
    barcode: row.barcode ?? null,
    itemCode: row.item_code ?? null,
    cost: row.cost == null ? null : Number(row.cost),
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
