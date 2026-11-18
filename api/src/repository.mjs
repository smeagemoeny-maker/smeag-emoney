import { getPool, normalizeUid } from "./db.mjs";

// Login is by ID only (no password).
export async function login({ loginId }) {
  const id = String(loginId || "").trim();
  if (!id) return null;
  const pool = await getPool();
  const [rows] = await pool.execute(
    "SELECT id, login_id, name, position, campus FROM mgperson WHERE login_id = ? ORDER BY id LIMIT 1",
    [id],
  );
  return rows[0] || null;
}

export async function listProducts({ campus }) {
  const pool = await getPool();
  const hasCampus = campus && campus !== "All Campuses";
  const sql = hasCampus
    ? "SELECT id, Campus, m_menu, s_menu, image_path, payment, stock, sales_number, min_stock FROM store_menus WHERE UPPER(Campus) = ? OR UPPER(Campus) = 'ALL' ORDER BY m_menu, s_menu"
    : "SELECT id, Campus, m_menu, s_menu, image_path, payment, stock, sales_number, min_stock FROM store_menus ORDER BY Campus, m_menu, s_menu";
  const params = hasCampus ? [campus.toUpperCase()] : [];
  const [rows] = await pool.execute(sql, params);
  return rows.map(mapProduct);
}

export async function findPersonByUid(uid) {
  const pool = await getPool();
  const [rows] = await pool.execute(
    "SELECT id, uid, studentid, name, age, gender, campus, s_date, e_date, totalmoney FROM person WHERE uid = ? LIMIT 1",
    [normalizeUid(uid)],
  );
  return rows[0] ? mapPerson(rows[0]) : null;
}

// Same rule as pos_checkout in the DB: 0 / 10% / 15% everywhere; Staff 30% only at the Capital Cafe.
const ALLOWED_DISCOUNTS = new Set([0, 0.1, 0.15]);
const CAPITAL_CAFE_STAFF_DISCOUNT = 0.3;

function discountAllowed(rate, { store, campus }) {
  if (ALLOWED_DISCOUNTS.has(rate)) return true;
  return rate === CAPITAL_CAFE_STAFF_DISCOUNT && store === "cafe" && String(campus).trim().toUpperCase() === "CAPITAL";
}

export function validateCheckoutInput({ uid, store, campus, cart, discountRate }) {
  if (!normalizeUid(uid)) throw httpError(400, "NFC UID is required.");
  if (!campus || typeof campus !== "string") throw httpError(400, "Campus is required.");
  if (store != null && store !== "cafe" && store !== "mart") throw httpError(400, "Store must be 'cafe' or 'mart'.");
  if (!Array.isArray(cart) || cart.length === 0) throw httpError(400, "Cart is empty.");
  if (!discountAllowed(Number(discountRate || 0), { store, campus })) throw httpError(400, "Invalid discount rate.");
  for (const item of cart) {
    const quantity = Number(item?.quantity);
    if (!Number(item?.productId) || !Number.isInteger(quantity) || quantity <= 0) {
      throw httpError(400, "Invalid cart item.");
    }
    const hasRate = item.discountRate != null && item.discountRate !== "";
    const hasAmount = item.discountAmount != null && item.discountAmount !== "";
    if (hasRate && hasAmount) throw httpError(400, "Use either an item discount rate or an amount, not both.");
    if (hasRate && !(Number(item.discountRate) >= 0 && Number(item.discountRate) <= 1)) {
      throw httpError(400, "Invalid item discount rate.");
    }
    if (hasAmount && !(Number(item.discountAmount) >= 0 && Number.isFinite(Number(item.discountAmount)))) {
      throw httpError(400, "Invalid item discount amount.");
    }
  }
}

// Per-item discount (cart line { discountRate } or { discountAmount }) replaces the cart-wide rate for that line.
// Same rule as pos_checkout in api/migrations/supabase_pos_checkout_item_discount.sql.
export function itemDiscount(item) {
  const hasRate = item.discountRate != null && item.discountRate !== "";
  const hasAmount = item.discountAmount != null && item.discountAmount !== "";
  if (hasAmount) return { amount: Math.round(Number(item.discountAmount) * 100) / 100 };
  if (hasRate) return { rate: Math.round(Number(item.discountRate) * 10000) / 10000 };
  return null;
}

export function linePaymentFor(lineTotal, item, cartRate, cartLabel) {
  const d = itemDiscount(item);
  if (d && d.amount != null) {
    const off = Math.min(d.amount, lineTotal);
    return { payment: roundMoney(lineTotal - off), remark: `Item -₱${off.toFixed(2)}` };
  }
  if (d) {
    const pct = Math.round(d.rate * 10000) / 100;
    return { payment: roundMoney(lineTotal - lineTotal * d.rate), remark: d.rate === 0 ? "No Discount" : `Item ${pct}%` };
  }
  return { payment: roundMoney(lineTotal - lineTotal * Number(cartRate || 0)), remark: cartLabel || "No Discount" };
}

// bank.category per campus store (same names as the store terminals) — see stores.mjs.
export { checkoutCategory } from "./stores.mjs";
import { checkoutCategory } from "./stores.mjs";

export async function createCheckout({ uid, store, campus, cart, discountLabel, discountRate }) {
  validateCheckoutInput({ uid, store, campus, cart, discountRate });

  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [people] = await conn.execute(
      "SELECT uid, studentid, name, totalmoney FROM person WHERE uid = ? FOR UPDATE",
      [normalizeUid(uid)],
    );
    const person = people[0];
    if (!person) throw httpError(404, "This NFC card is not registered.");

    let remainingBalance = toMoney(person.totalmoney);
    let finalTotal = 0;
    const orderId = crypto.randomUUID();

    for (const item of cart) {
      const productId = Number(item.productId);
      const quantity = Number(item.quantity);

      const [products] = await conn.execute(
        "SELECT id, Campus, m_menu, s_menu, payment, stock, sales_number FROM store_menus WHERE id = ? FOR UPDATE",
        [productId],
      );
      const product = products[0];
      if (!product) throw httpError(404, `Product not found: ${productId}`);
      if (Number(product.stock) < quantity) {
        throw httpError(409, `Insufficient stock: ${product.s_menu}`);
      }

      const lineTotal = toMoney(product.payment) * quantity;
      const { payment: linePayment, remark } = linePaymentFor(lineTotal, item, discountRate, discountLabel);
      finalTotal = roundMoney(finalTotal + linePayment);
      if (remainingBalance < linePayment) {
        throw httpError(409, "Insufficient balance.");
      }

      const beforeAmount = remainingBalance;
      remainingBalance = roundMoney(remainingBalance - linePayment);

      await conn.execute(
        "UPDATE store_menus SET stock = ?, sales_number = ? WHERE id = ?",
        [Number(product.stock) - quantity, Number(product.sales_number || 0) + quantity, productId],
      );
      await conn.execute(
        `INSERT INTO bank
          (uid, studentid, name, campus, beforeamount, category, subcategory, transaction_type, payment, totalmoney, quantity, transaction_source, remark, \`order\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'decrease', ?, ?, ?, 'PWA POS', ?, ?)`,
        [
          normalizeUid(uid),
          person.studentid || "",
          person.name || "",
          campus,
          beforeAmount,
          checkoutCategory(store, campus),
          product.s_menu,
          linePayment,
          remainingBalance,
          quantity,
          remark,
          orderId,
        ],
      );
    }

    await conn.execute("UPDATE person SET totalmoney = ? WHERE uid = ?", [remainingBalance, normalizeUid(uid)]);
    await conn.commit();
    return { orderId, finalTotal, remainingBalance, buyerName: person.name || null };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// Top-up (charge) at a cafe counter. Same bank row shape as the office program:
// transaction_type 'increase', remark 'R', `order` = staff login_id.
export const MAX_CHARGE = Number(process.env.MAX_CHARGE || 10000);

export function validateChargeInput({ uid, campus, amount, staffLoginId }) {
  if (!normalizeUid(uid)) throw httpError(400, "NFC UID is required.");
  if (!campus || typeof campus !== "string") throw httpError(400, "Campus is required.");
  if (!staffLoginId) throw httpError(401, "Staff login is required to charge.");
  const value = Number(amount);
  if (!(value > 0)) throw httpError(400, "Charge amount must be greater than 0.");
  if (value > MAX_CHARGE) throw httpError(400, `Charge amount cannot exceed ${MAX_CHARGE}.`);
  if (Math.round(value * 100) !== value * 100) throw httpError(400, "Charge amount has too many decimals.");
}

export async function createCharge({ uid, campus, amount, staffLoginId }) {
  validateChargeInput({ uid, campus, amount, staffLoginId });
  const normalized = normalizeUid(uid);
  const payment = roundMoney(amount);

  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [people] = await conn.execute(
      "SELECT uid, studentid, name, campus, totalmoney FROM person WHERE uid = ? FOR UPDATE",
      [normalized],
    );
    const person = people[0];
    if (!person) throw httpError(404, "This NFC card is not registered.");

    const beforeAmount = toMoney(person.totalmoney);
    const totalMoney = roundMoney(beforeAmount + payment);
    await conn.execute(
      `INSERT INTO bank
        (uid, studentid, name, campus, beforeamount, category, subcategory, transaction_type, payment, totalmoney, quantity, transaction_source, remark, \`order\`)
       VALUES (?, ?, ?, ?, ?, ?, 'Charge', 'increase', ?, ?, 1, 'PWA POS', 'R', ?)`,
      [normalized, person.studentid || "", person.name || "", campus, beforeAmount, `${campus} Cafe`, payment, totalMoney, String(staffLoginId)],
    );
    await conn.execute("UPDATE person SET totalmoney = ? WHERE uid = ?", [totalMoney, normalized]);
    await conn.commit();
    return { uid: normalized, buyerName: person.name || null, amount: payment, beforeAmount, totalMoney };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function createPusanmartPayment({ uid, totalAmount }) {
  if (!(Number(totalAmount) > 0)) throw httpError(400, "Total amount must be greater than 0.");
  const person = await findPersonByUid(uid);
  if (!person) throw httpError(404, "This NFC card is not registered.");

  const pool = await getPool();
  const [result] = await pool.execute(
    "INSERT INTO PusanmartPayments (nfcid, center, name, allpayments, stock, register_days) VALUES (?, 'PusanMart', ?, ?, 0, NOW())",
    [normalizeUid(uid), person.name || "", toMoney(totalAmount)],
  );

  return {
    id: result.insertId,
    nfcid: normalizeUid(uid),
    name: person.name,
    allPayments: toMoney(totalAmount),
  };
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

function toMoney(value) {
  return Number(value || 0);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
