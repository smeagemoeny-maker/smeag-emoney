// Supabase (PostgREST) data access. Same exports/return shapes as repository.mjs (MySQL).
// Checkout and charge run inside the pos_checkout / pos_charge RPCs
// (migrations/supabase_pos_functions.sql) so balance + stock changes stay in one transaction.
import "./env.mjs";
import { normalizeUid, requiredEnv } from "./db.mjs";
import { httpError, validateChargeInput, validateCheckoutInput } from "./repository.mjs";
import { checkoutCategory } from "./stores.mjs";

const PAGE_SIZE = 1000;

function config() {
  return {
    url: requiredEnv("SUPABASE_URL").replace(/\/+$/, ""),
    key: requiredEnv("SUPABASE_SERVICE_KEY"),
  };
}

export async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const { url, key } = config();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // PTxxx errors raised by the RPCs carry their own HTTP status (400/401/404/409).
    const status = res.status >= 400 && res.status < 500 && data?.code?.startsWith?.("PT") ? res.status : 500;
    throw httpError(status, data?.message || `Supabase error ${res.status}`);
  }
  return data;
}

// Quote a PostgREST filter value so spaces/commas/parentheses are safe.
export function q(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Login is by ID only (no password); the account's position/campus decides what it may use (access.mjs).
export async function login({ loginId }) {
  const id = String(loginId || "").trim();
  if (!id) return null;
  const rows = await rest(
    `mgperson?select=id,login_id,name,position,campus&login_id=eq.${encodeURIComponent(id)}&order=id.asc&limit=1`,
  );
  return rows[0] || null;
}

export async function listProducts({ campus }) {
  const hasCampus = campus && campus !== "All Campuses";
  const select = "select=id,Campus,m_menu,s_menu,image_path,payment,stock,sales_number,min_stock";
  // ilike without wildcards = case-insensitive equality (MySQL compared with UPPER()).
  const filter = hasCampus
    ? `&or=${encodeURIComponent(`(Campus.ilike.${q(escapeLike(campus))},Campus.ilike.all)`)}`
    : "";
  const order = hasCampus ? "&order=m_menu.asc,s_menu.asc,id.asc" : "&order=Campus.asc,m_menu.asc,s_menu.asc,id.asc";

  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await rest(`store_menus?${select}${filter}${order}&offset=${offset}&limit=${PAGE_SIZE}`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows.map(mapProduct);
}

export async function findPersonByUid(uid) {
  const normalized = normalizeUid(uid);
  if (!normalized) return null;
  const rows = await rest(
    `person?select=id,uid,studentid,name,age,gender,campus,s_date,e_date,totalmoney&uid=eq.${encodeURIComponent(normalized)}&order=id.asc&limit=1`,
  );
  return rows[0] ? mapPerson(rows[0]) : null;
}

export async function createCheckout({ uid, store, campus, cart, discountLabel, discountRate }) {
  validateCheckoutInput({ uid, store, campus, cart, discountRate });
  return rest("rpc/pos_checkout", {
    method: "POST",
    body: {
      p_uid: normalizeUid(uid),
      p_store: store ?? null,
      p_campus: campus,
      p_cart: cart.map((item) => ({ productId: Number(item.productId), quantity: Number(item.quantity) })),
      p_discount_label: discountLabel || "No Discount",
      p_discount_rate: Number(discountRate || 0),
      p_category: checkoutCategory(store || "mart", campus),
    },
  });
}

export async function createCharge({ uid, campus, amount, staffLoginId }) {
  validateChargeInput({ uid, campus, amount, staffLoginId });
  return rest("rpc/pos_charge", {
    method: "POST",
    body: {
      p_uid: normalizeUid(uid),
      p_campus: campus,
      p_amount: Number(amount),
      p_staff_id: String(staffLoginId),
    },
  });
}

export async function createPusanmartPayment({ uid, totalAmount }) {
  if (!(Number(totalAmount) > 0)) throw httpError(400, "Total amount must be greater than 0.");
  const person = await findPersonByUid(uid);
  if (!person) throw httpError(404, "This NFC card is not registered.");

  const [row] = await rest("PusanmartPayments", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: {
      nfcid: normalizeUid(uid),
      center: "PusanMart",
      name: person.name || "",
      allpayments: Number(totalAmount),
      stock: 0,
      register_days: new Date().toISOString(),
    },
  });

  return { id: row.id, nfcid: normalizeUid(uid), name: person.name, allPayments: Number(totalAmount) };
}

export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

function mapProduct(row) {
  return {
    id: row.id,
    campus: row.Campus,
    mMenu: row.m_menu,
    sMenu: row.s_menu,
    imagePath: row.image_path,
    payment: row.payment,
    stock: row.stock,
    salesNumber: row.sales_number,
    minStock: row.min_stock,
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
    totalMoney: row.totalmoney,
  };
}
