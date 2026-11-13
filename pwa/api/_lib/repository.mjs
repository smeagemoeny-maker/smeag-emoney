import { getPool, normalizeUid } from "./db.mjs";

export async function login({ loginId, password }) {
  const pool = await getPool();
  const [rows] = await pool.execute(
    "SELECT id, login_id, name, position, campus FROM mgperson WHERE login_id = ? AND password = ? LIMIT 1",
    [loginId, password],
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

const ALLOWED_DISCOUNTS = new Set([0, 0.1, 0.15]);

export function validateCheckoutInput({ uid, store, campus, cart, discountRate }) {
  if (!normalizeUid(uid)) throw httpError(400, "NFC UID is required.");
  if (!campus || typeof campus !== "string") throw httpError(400, "Campus is required.");
  if (store != null && store !== "cafe" && store !== "mart") throw httpError(400, "Store must be 'cafe' or 'mart'.");
  if (!Array.isArray(cart) || cart.length === 0) throw httpError(400, "Cart is empty.");
  if (!ALLOWED_DISCOUNTS.has(Number(discountRate || 0))) throw httpError(400, "Invalid discount rate.");
  for (const item of cart) {
    const quantity = Number(item?.quantity);
    if (!Number(item?.productId) || !Number.isInteger(quantity) || quantity <= 0) {
      throw httpError(400, "Invalid cart item.");
    }
  }
}

// bank.category: cafe sales are "<Campus> Cafe"; mart sales keep the Android format "<Campus> Mart".
export function checkoutCategory(store, campus) {
  return store === "cafe" ? `${campus} Cafe` : `${campus} Mart`;
}

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
      const linePayment = roundMoney(lineTotal - lineTotal * Number(discountRate || 0));
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
          discountLabel || "No Discount",
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
