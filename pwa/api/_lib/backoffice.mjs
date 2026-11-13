// Endpoints behind the Register / Modify / History / Report / Buyer Info / Pay List screens
// and the office program's OFFICE MENU tab. SQL follows the old Android app (DbRepository.kt)
// and the row shapes already in the production `bank` table.
import { getPool, normalizeUid } from "./db.mjs";
import { httpError } from "./repository.mjs";

// ---------- products (store_menus) ----------

export async function createProduct({ campus, mMenu, sMenu, imagePath, payment, stock, minStock }, staffLoginId) {
  if (!campus) throw httpError(400, "Campus is required.");
  if (!String(sMenu || "").trim()) throw httpError(400, "Product name is required.");
  const price = Number(payment);
  if (!(price >= 0)) throw httpError(400, "Price must be 0 or more.");
  const pool = await getPool();
  const [result] = await pool.execute(
    "INSERT INTO store_menus (Campus, m_menu, s_menu, image_path, payment, stock, min_stock, manager) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [campus, mMenu || null, String(sMenu).trim(), imagePath || null, price, toInt(stock, 0), toInt(minStock, 5), staffLoginId || null],
  );
  return getProduct(result.insertId);
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
  const sets = [];
  const params = [];
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
    sets.push(`${column} = ?`);
    params.push(value === "" ? null : value);
  }
  if (!sets.length) throw httpError(400, "Nothing to update.");
  const pool = await getPool();
  const [result] = await pool.execute(`UPDATE store_menus SET ${sets.join(", ")} WHERE id = ?`, [...params, Number(id)]);
  if (!result.affectedRows) throw httpError(404, "Product not found.");
  return getProduct(id);
}

export async function deleteProduct(id) {
  const pool = await getPool();
  const [result] = await pool.execute("DELETE FROM store_menus WHERE id = ?", [Number(id)]);
  if (!result.affectedRows) throw httpError(404, "Product not found.");
  return { id: Number(id) };
}

export async function getProduct(id) {
  const pool = await getPool();
  const [rows] = await pool.execute(
    "SELECT id, Campus, m_menu, s_menu, image_path, payment, stock, sales_number, min_stock FROM store_menus WHERE id = ?",
    [Number(id)],
  );
  if (!rows[0]) throw httpError(404, "Product not found.");
  return mapProduct(rows[0]);
}

// ---------- sales history / report (bank) ----------

// Inclusive date range "YYYY-MM-DD" .. "YYYY-MM-DD"; bank.transaction_date is Philippine wall-clock time.
function range(from, to) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(from || "")) || !re.test(String(to || ""))) throw httpError(400, "from/to must be YYYY-MM-DD.");
  return [`${from} 00:00:00`, `${to} 23:59:59`];
}

// campus filter like the Android app (UPPER(campus) = ?); category narrows to one store, e.g. "Capital Cafe".
function bankFilter({ from, to, campus, category }) {
  const where = ["transaction_date >= ?", "transaction_date <= ?"];
  const params = range(from, to);
  if (campus && campus !== "All Campuses") {
    where.push("UPPER(campus) IN (?, ?)");
    // bank.campus has both 'Tarlac' and the legacy typo 'Talrac'.
    const upper = String(campus).toUpperCase();
    params.push(upper, upper === "TARLAC" ? "TALRAC" : upper);
  }
  if (category) {
    where.push("UPPER(category) = ?");
    params.push(String(category).toUpperCase());
  }
  return { where: where.join(" AND "), params };
}

export async function listSales(filter) {
  const { where, params } = bankFilter(filter);
  const pool = await getPool();
  const [rows] = await pool.execute(
    `SELECT id, uid, studentid, name, campus, beforeamount, category, subcategory, transaction_type, payment, totalmoney,
            quantity, DATE_FORMAT(transaction_date, '%Y-%m-%d %H:%i:%s') AS transaction_date, remark, transaction_source, \`order\`
       FROM bank WHERE ${where} ORDER BY transaction_date DESC, id DESC LIMIT 5000`,
    params,
  );
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
    date: r.transaction_date,
    remark: r.remark,
    source: r.transaction_source,
    order: r.order,
  }));
}

// Same numbers as the Android Report screen: daily totals, order count, top sellers, low stock.
export async function salesReport({ from, to, campus, category, productCampus }) {
  const { where, params } = bankFilter({ from, to, campus, category });
  const pool = await getPool();
  const sales = `${where} AND transaction_type = 'decrease'`;

  const [daily] = await pool.execute(
    `SELECT DATE_FORMAT(transaction_date, '%Y-%m-%d') AS d, SUM(payment) AS total FROM bank WHERE ${sales} GROUP BY d ORDER BY d`,
    params,
  );
  const [[count]] = await pool.execute(`SELECT COUNT(DISTINCT COALESCE(\`order\`, id)) AS cnt FROM bank WHERE ${sales}`, params);
  const [top] = await pool.execute(
    `SELECT subcategory, SUM(quantity) AS qty, SUM(payment) AS amount FROM bank WHERE ${sales}
      GROUP BY subcategory ORDER BY qty DESC LIMIT 10`,
    params,
  );
  const stockCampus = productCampus || campus;
  const [low] = stockCampus && stockCampus !== "All Campuses"
    ? await pool.execute(
        "SELECT id, Campus, m_menu, s_menu, image_path, payment, stock, sales_number, min_stock FROM store_menus WHERE (UPPER(Campus) = ? OR UPPER(Campus) = 'ALL') AND stock <= min_stock ORDER BY stock",
        [String(stockCampus).toUpperCase()],
      )
    : await pool.execute("SELECT id, Campus, m_menu, s_menu, image_path, payment, stock, sales_number, min_stock FROM store_menus WHERE stock <= min_stock ORDER BY stock");

  // Every day in the range, zero-filled (the Android chart shows empty days too).
  const totals = new Map(daily.map((r) => [r.d, Number(r.total || 0)]));
  const days = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`) && days.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, total: totals.get(key) || 0 });
  }
  return {
    daily: days,
    total: days.reduce((sum, d) => sum + d.total, 0),
    orderCount: Number(count?.cnt || 0),
    topProducts: top.map((r) => ({ name: r.subcategory, quantity: Number(r.qty || 0), amount: Number(r.amount || 0) })),
    lowStock: low.map(mapProduct),
  };
}

// ---------- buyers (person) ----------

export async function searchPeople({ search }) {
  const term = String(search || "").trim();
  const pool = await getPool();
  const like = `%${term}%`;
  const [rows] = term
    ? await pool.execute(
        "SELECT id, uid, studentid, name, age, gender, campus, s_date, e_date, totalmoney FROM person WHERE uid LIKE ? OR studentid LIKE ? OR name LIKE ? ORDER BY name LIMIT 200",
        [like, like, like],
      )
    : await pool.execute("SELECT id, uid, studentid, name, age, gender, campus, s_date, e_date, totalmoney FROM person ORDER BY register_date DESC, id DESC LIMIT 200");
  return rows.map(mapPerson);
}

// Profile fields only. The balance changes only through payments/charges/office transactions,
// so every change has a bank row.
export async function updatePerson(id, { name, studentId, age }) {
  const sets = [];
  const params = [];
  if (name !== undefined) {
    if (!String(name).trim()) throw httpError(400, "Name is required.");
    sets.push("name = ?");
    params.push(String(name).trim());
  }
  if (studentId !== undefined) {
    sets.push("studentid = ?");
    params.push(String(studentId).trim() || null);
  }
  if (age !== undefined) {
    const value = age === "" || age === null ? null : toInt(age, NaN);
    if (value !== null && !(value >= 0)) throw httpError(400, "Age must be 0 or more.");
    sets.push("age = ?");
    params.push(value);
  }
  if (!sets.length) throw httpError(400, "Nothing to update.");
  const pool = await getPool();
  const [result] = await pool.execute(`UPDATE person SET ${sets.join(", ")} WHERE id = ?`, [...params, Number(id)]);
  if (!result.affectedRows) throw httpError(404, "Buyer not found.");
  const [rows] = await pool.execute(
    "SELECT id, uid, studentid, name, age, gender, campus, s_date, e_date, totalmoney FROM person WHERE id = ?",
    [Number(id)],
  );
  return mapPerson(rows[0]);
}

// ---------- PusanMart pay list ----------

export async function listPusanmartPayments({ from, to }) {
  const pool = await getPool();
  const [rows] = await pool.execute(
    `SELECT id, nfcid, center, name, allpayments, stock, DATE_FORMAT(register_days, '%Y-%m-%d %H:%i:%s') AS register_days
       FROM PusanmartPayments WHERE center = 'PusanMart' AND register_days >= ? AND register_days <= ?
      ORDER BY register_days DESC, id DESC LIMIT 5000`,
    range(from, to),
  );
  return rows.map((r) => ({
    id: Number(r.id),
    nfcid: r.nfcid,
    center: r.center,
    name: r.name,
    allPayments: Number(r.allpayments || 0),
    stock: Number(r.stock || 0),
    date: r.register_days,
  }));
}

// ---------- office program (office_menus + bank) ----------

export async function listOfficeMenus({ campus }) {
  const pool = await getPool();
  const upper = String(campus || "").toUpperCase();
  const [rows] = await pool.execute(
    "SELECT id, Campus, m_menu, s_menu, payment FROM office_menus WHERE UPPER(Campus) IN ('ALL', ?, ?) ORDER BY id",
    [upper, upper === "TARLAC" ? "TALRAC" : upper === "TALRAC" ? "TARLAC" : upper],
  );
  return rows.map((r) => ({ id: r.id, campus: r.Campus, mMenu: r.m_menu, sMenu: r.s_menu, payment: Number(r.payment || 0) }));
}

// Office line types as stored in production bank rows:
//   INCREASE  -> transaction_type 'increase',  remark 'R', balance + amount
//   DECREASE  -> transaction_type 'decrease',  remark 'N', balance - amount (cannot go below 0)
//   EXCEPTION -> transaction_type 'exception', remark 'E', recorded only, balance unchanged
const OFFICE_TYPES = {
  INCREASE: { type: "increase", remark: "R", sign: 1 },
  DECREASE: { type: "decrease", remark: "N", sign: -1 },
  EXCEPTION: { type: "exception", remark: "E", sign: 0 },
};

export function validateOfficeLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw httpError(400, "Add at least one line.");
  if (lines.length > 50) throw httpError(400, "Too many lines.");
  for (const line of lines) {
    if (!OFFICE_TYPES[String(line?.type || "").toUpperCase()]) throw httpError(400, "Invalid line type.");
    if (!String(line.mMenu || "").trim() || !String(line.sMenu || "").trim()) throw httpError(400, "Category and item are required.");
    const price = Number(line.unitPrice);
    const qty = Number(line.qty);
    if (!(price > 0) || Math.round(price * 100) !== price * 100) throw httpError(400, "Price must be greater than 0.");
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw httpError(400, "Qty must be 1-999.");
  }
}

export async function createOfficeTransaction({ uid, lines }, staffLoginId) {
  const normalized = normalizeUid(uid);
  if (!normalized) throw httpError(400, "UID is required.");
  if (!staffLoginId) throw httpError(401, "Staff login is required.");
  validateOfficeLines(lines);

  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [people] = await conn.execute(
      "SELECT uid, studentid, name, campus, totalmoney FROM person WHERE uid = ? FOR UPDATE",
      [normalized],
    );
    const person = people[0];
    if (!person) throw httpError(404, "Student not found.");

    const balanceBefore = Number(person.totalmoney || 0);
    let balance = balanceBefore;
    const ids = [];
    for (const line of lines) {
      const kind = OFFICE_TYPES[String(line.type).toUpperCase()];
      const qty = Number(line.qty);
      const amount = round(Number(line.unitPrice) * qty);
      const before = balance;
      balance = round(balance + kind.sign * amount);
      if (balance < 0) throw httpError(409, "Insufficient balance.");
      const [result] = await conn.execute(
        `INSERT INTO bank
          (uid, studentid, name, campus, beforeamount, category, subcategory, transaction_type, payment, totalmoney, quantity, remark, transaction_source, \`order\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'office', ?)`,
        [person.uid, person.studentid || "", person.name || "", person.campus || "", before, String(line.mMenu).trim(), String(line.sMenu).trim(),
          kind.type, amount, balance, qty, kind.remark, String(staffLoginId)],
      );
      ids.push(Number(result.insertId));
    }
    await conn.execute("UPDATE person SET totalmoney = ? WHERE uid = ?", [balance, person.uid]);
    await conn.commit();
    return { id: ids[ids.length - 1], bankIds: ids, balanceBefore, balanceAfter: balance, netChange: round(balance - balanceBefore) };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ---------- helpers ----------

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
