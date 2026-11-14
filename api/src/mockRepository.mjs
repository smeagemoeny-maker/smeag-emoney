import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUid } from "./db.mjs";
import { checkoutCategory, httpError, validateChargeInput, validateCheckoutInput } from "./repository.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dbsql = path.join(root, "DBSQL");

let cache;

export async function mockLogin({ loginId }) {
  const data = loadMockData();
  const id = String(loginId || "").trim();
  const manager = id ? data.managers.find((item) => item.login_id === id) : null;
  if (!manager) return null;
  const { password: _password, ...safeManager } = manager;
  return safeManager;
}

export async function mockListProducts({ campus }) {
  const data = loadMockData();
  const normalized = String(campus || "All Campuses").toUpperCase();
  if (!campus || normalized === "ALL CAMPUSES") return data.products;
  return data.products.filter((item) => item.campus.toUpperCase() === normalized || item.campus.toUpperCase() === "ALL");
}

export async function mockFindPersonByUid(uid) {
  const data = loadMockData();
  const wanted = normalizeUid(uid);
  return data.people.find((item) => normalizeUid(item.uid) === wanted) || null;
}

// Same rules as the live checkout, applied to in-memory data (changes reset on restart).
export async function mockCreateCheckout({ uid, store, campus, cart, discountLabel, discountRate }) {
  validateCheckoutInput({ uid, store, campus, cart, discountRate });
  const person = await mockFindPersonByUid(uid);
  if (!person) throw httpError(404, "This NFC card is not registered.");
  const data = loadMockData();
  const rate = Number(discountRate || 0);

  let balance = Number(person.totalMoney || 0);
  let finalTotal = 0;
  const lines = [];
  for (const item of cart) {
    const product = data.products.find((entry) => entry.id === Number(item.productId));
    const quantity = Number(item.quantity);
    if (!product) throw httpError(404, `Product not found: ${item.productId}`);
    if (product.stock < quantity) throw httpError(409, `Insufficient stock: ${product.sMenu}`);
    const lineTotal = product.payment * quantity;
    const linePayment = roundMoney(lineTotal - lineTotal * rate);
    if (balance < linePayment) throw httpError(409, "Insufficient balance.");
    balance = roundMoney(balance - linePayment);
    finalTotal = roundMoney(finalTotal + linePayment);
    lines.push({ product, quantity });
  }

  for (const { product, quantity } of lines) {
    product.stock -= quantity;
    product.salesNumber += quantity;
  }
  person.totalMoney = balance;

  return {
    orderId: `mock-${Date.now()}`,
    finalTotal,
    remainingBalance: balance,
    buyerName: person.name,
    discountLabel,
    category: checkoutCategory(store, campus),
  };
}

export async function mockCreateCharge({ uid, campus, amount, staffLoginId }) {
  validateChargeInput({ uid, campus, amount, staffLoginId });
  const person = await mockFindPersonByUid(uid);
  if (!person) throw httpError(404, "This NFC card is not registered.");
  const beforeAmount = Number(person.totalMoney || 0);
  const payment = roundMoney(amount);
  person.totalMoney = roundMoney(beforeAmount + payment);
  return { uid: normalizeUid(uid), buyerName: person.name, amount: payment, beforeAmount, totalMoney: person.totalMoney };
}

export async function mockCreatePusanmartPayment({ uid, totalAmount }) {
  if (!(Number(totalAmount) > 0)) throw httpError(400, "Total amount must be greater than 0.");
  const person = await mockFindPersonByUid(uid);
  if (!person) throw httpError(404, "This NFC card is not registered.");
  return {
    id: Date.now(),
    nfcid: normalizeUid(uid),
    name: person.name,
    allPayments: Number(totalAmount || 0),
  };
}

function loadMockData() {
  if (cache) return cache;
  cache = {
    managers: parseManagers(read("mgperson.sql")),
    products: parseProducts(read("store_menus.sql")),
    people: parsePeople(read("person.sql")),
  };
  return cache;
}

function read(file) {
  return fs.readFileSync(path.join(dbsql, file), "utf8");
}

function parseManagers(sql) {
  return tuples(sql, "mgperson").map((values) => ({
    id: Number(values[0]),
    login_id: values[1],
    password: values[2],
    name: values[3],
    position: values[4],
    campus: values[5],
  }));
}

function parseProducts(sql) {
  return tuples(sql, "store_menus").map((values) => ({
    id: Number(values[0]),
    campus: values[1],
    mMenu: values[2],
    sMenu: values[3],
    imagePath: values[4],
    payment: Number(values[5] || 0),
    stock: Number(values[6] || 0),
    salesNumber: Number(values[7] || 0),
    minStock: Number(values[8] || 5),
  }));
}

function parsePeople(sql) {
  return tuples(sql, "person").map((values) => ({
    id: Number(values[0]),
    uid: values[1],
    studentId: values[2],
    name: values[3],
    age: values[5] ? Number(values[5]) : null,
    gender: values[6],
    campus: values[7],
    startDate: values[8],
    endDate: values[9],
    totalMoney: Number(values[10] || 0),
  }));
}

function tuples(sql, tableName) {
  const regex = new RegExp("INSERT INTO `" + tableName + "`[^]*?VALUES\\s*\\(([^]*?)\\);", "g");
  const result = [];
  let match;
  while ((match = regex.exec(sql)) !== null) {
    result.push(parseTuple(match[1]));
  }
  return result;
}

function parseTuple(source) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "'" && next === "'") {
      current += "'";
      index += 1;
      continue;
    }
    if (char === "'") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(clean(current));
      current = "";
      continue;
    }
    current += char;
  }
  values.push(clean(current));
  return values;
}

function clean(value) {
  const trimmed = value.trim();
  if (trimmed.toUpperCase() === "NULL") return null;
  return trimmed;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
