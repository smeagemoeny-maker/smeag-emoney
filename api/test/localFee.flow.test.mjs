// Local Fee sheets + payments with NO network: global fetch is an in-memory PostgREST, any other URL fails.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_KEY = "test-key";

const tables = {
  person: [
    { id: 7, uid: "04aa11", studentid: "S7", name: "KIM TEST", campus: "Capital" },
    { id: 8, uid: "04bb22", studentid: "S8", name: "LEE TEST", campus: "Encanto" },
  ],
  local_fee_record: [],
  local_fee_payment: [],
};
const seq = { local_fee_record: 0, local_fee_payment: 0 };

function parseFilters(params) {
  const f = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit"].includes(k)) continue;
    if (k === "or") {
      const parts = v.replace(/^\(|\)$/g, "").split(",").map((p) => /^(\w+)\.ilike\.\*(.*)\*$/.exec(p));
      f.push((row) => parts.some(([, col, val]) => String(row[col] ?? "").toLowerCase().includes(val.toLowerCase())));
      continue;
    }
    const m = /^(eq|in|is|ilike)\.(.*)$/.exec(v);
    if (!m) throw new Error(`fake rest: filter ${k}=${v}`);
    const [, op, val] = m;
    f.push((row) => {
      const cell = row[k];
      if (op === "eq") return String(cell) === val;
      if (op === "ilike") return String(cell ?? "").toLowerCase() === val.toLowerCase();
      if (op === "is") return cell == null;
      return val.replace(/^\(|\)$/g, "").split(",").includes(String(cell));
    });
  }
  return (row) => f.every((fn) => fn(row));
}

function restCall(url, init) {
  const u = new URL(url);
  const path = u.pathname.replace("/rest/v1/", "");
  const rows = tables[path];
  if (!rows) throw new Error(`fake rest: table ${path}`);
  const body = init.body ? JSON.parse(init.body) : undefined;
  const match = parseFilters(u.searchParams);
  if (init.method === "GET") return rows.filter(match).map((r) => structuredClone(r));
  if (init.method === "PATCH") { rows.filter(match).forEach((r) => Object.assign(r, body)); return null; }
  if (init.method === "POST") {
    const out = [];
    for (const item of [].concat(body)) {
      if (path === "local_fee_payment" && item.client_key && rows.some((r) => r.client_key === item.client_key)) {
        return { __status: 409, message: "duplicate key value violates unique constraint" };
      }
      const row = { id: ++seq[path], created_at: new Date().toISOString(), received_at: new Date().toISOString(),
        status: "active", voided_at: null, ...item };
      rows.push(row);
      out.push(structuredClone(row));
    }
    return String(init.headers?.prefer || "").includes("representation") ? out : null;
  }
  throw new Error(`fake rest: ${init.method}`);
}

globalThis.fetch = async (url, init = {}) => {
  const s = String(url);
  if (!s.startsWith("http://supabase.test/")) throw new Error(`unexpected network call: ${s}`);
  const out = restCall(s, { method: "GET", ...init });
  return new Response(out === null ? "" : JSON.stringify(out), { status: out?.__status || 200 });
};

const fee = await import("../src/localFee.mjs");
const admin = { cafeCampuses: ["Capital", "Encanto", "Tarlac"] };
const capital = { cafeCampuses: ["Capital"] };

const items12 = [
  { key: "visa_ext_1", name: "VISA 1차 연장", amount: 5130, detail: "1–59일" },
  { key: "visa_ext_2", name: "VISA 2차 연장", amount: 6400, detail: "60–84일" },
  { key: "ssp", name: "SSP", amount: 7800 },
  { key: "ssp_icard", name: "SSP I-Card", amount: 4300 },
  { key: "visa_icard", name: "Visa I-Card", amount: 4300 },
  { key: "deposit", name: "Deposit", amount: 3000 },
  { key: "maint", name: "Maintenance", amount: 6000 },
  { key: "elec", name: "Electricity & Water", amount: 7200 },
  { key: "pickup", name: "공항 픽업", amount: 1200 },
];
const base = { entryType: "G30", preset: "2025-07", weeks: 12, extraDays: 0, pickup: true, items: items12 };

let sheetId;

test("create: student from person, total recomputed on the server", async () => {
  const { record } = await fee.create({ ...base, personId: 7, total: 1 }, "kenneth", admin);
  sheetId = record.id;
  assert.equal(record.studentName, "KIM TEST");
  assert.equal(record.campus, "Capital");
  assert.equal(record.total, 45330);
  assert.equal(record.status, "unpaid");
  assert.equal(tables.local_fee_record[0].created_by, "kenneth");
});

test("create: bad input and campus scope", async () => {
  await assert.rejects(() => fee.create({ ...base, entryType: "X" , personId: 7 }, "k", admin), /entry type/);
  await assert.rejects(() => fee.create({ ...base, personId: 7, items: [{ key: "a", amount: 1 }, { key: "a", amount: 2 }] }, "k", admin), /Duplicate/);
  await assert.rejects(() => fee.create({ ...base, personId: 7, items: [{ key: "Bad Key", amount: 1 }] }, "k", admin), /Invalid line key/);
  await assert.rejects(() => fee.create({ ...base, personId: 8 }, "k", capital), /cannot handle Encanto/);
  await assert.rejects(() => fee.create({ ...base, studentName: "NO CAMPUS" }, "k", admin), /Campus is required/);
});

test("pay: partial, full, never more than due, double submit ignored", async () => {
  let r = await fee.pay(sheetId, { itemKey: "ssp", amount: 5000, method: "CASH", clientKey: "c1" }, "kenneth", admin);
  assert.equal(r.record.status, "partial");
  assert.equal(r.record.items.find((i) => i.key === "ssp").due, 2800);
  r = await fee.pay(sheetId, { itemKey: "ssp", amount: 5000, method: "CASH", clientKey: "c1" }, "kenneth", admin);
  assert.equal(r.repeated, true);
  assert.equal(tables.local_fee_payment.length, 1);
  await assert.rejects(() => fee.pay(sheetId, { itemKey: "ssp", amount: 3000, method: "CASH" }, "k", admin), /only ₱2,800 is still due/);
  await assert.rejects(() => fee.pay(sheetId, { itemKey: "nope", amount: 1, method: "CASH" }, "k", admin), /fee line/);
  await assert.rejects(() => fee.pay(sheetId, { itemKey: "ssp", amount: 1, method: "BITCOIN" }, "k", admin), /Payment method/);
  await assert.rejects(() => fee.pay(sheetId, { itemKey: "ssp", amount: 0, method: "CASH" }, "k", admin), /more than 0/);
  r = await fee.pay(sheetId, { itemKey: "ssp", amount: 2800, method: "GCASH", clientKey: "c2" }, "kenneth", admin);
  assert.equal(r.record.items.find((i) => i.key === "ssp").due, 0);
  await assert.rejects(() => fee.pay(sheetId, { itemKey: "ssp", amount: 1, method: "CASH" }, "k", admin), /already fully paid/);
  for (const it of items12.filter((i) => i.key !== "ssp")) {
    r = await fee.pay(sheetId, { itemKey: it.key, amount: it.amount, method: "CASH", clientKey: `k-${it.key}` }, "kenneth", admin);
  }
  assert.equal(r.record.status, "paid");
  assert.equal(r.record.due, 0);
  assert.equal(r.record.paid, 45330);
});

test("void: needs a reason, only once, money becomes due again", async () => {
  const pid = tables.local_fee_payment.find((p) => p.item_key === "pickup").id;
  await assert.rejects(() => fee.voidPayment(pid, {}, "k", admin), /why/);
  const r = await fee.voidPayment(pid, { reason: "no pickup" }, "kenneth", admin);
  assert.equal(r.record.status, "partial");
  assert.equal(r.record.items.find((i) => i.key === "pickup").due, 1200);
  assert.equal(r.payments.find((p) => p.id === pid).voidedBy, "kenneth");
  await assert.rejects(() => fee.voidPayment(pid, { reason: "again" }, "k", admin), /Already voided/);
});

test("recalculate (shorter stay): removed paid line shows as overpaid", async () => {
  const items8 = items12.filter((i) => !["visa_ext_2", "visa_icard"].includes(i.key));
  const r = await fee.update(sheetId, { weeks: 8, items: items8 }, "kenneth", admin);
  assert.equal(r.record.weeks, 8);
  assert.equal(r.record.status, "overpaid");
  const removed = r.record.items.filter((i) => i.removed).map((i) => i.key).sort();
  assert.deepEqual(removed, ["visa_ext_2", "visa_icard"]);
});

test("list: search, status filter, campus scope; cancel needs payments voided", async () => {
  const other = await fee.create({ ...base, personId: 8 }, "kenneth", admin);
  assert.equal((await fee.list({ search: "kim" }, admin)).records.length, 1);
  assert.equal((await fee.list({}, capital)).records.length, 1);
  assert.equal((await fee.list({ status: "unpaid" }, admin)).records[0].studentName, "LEE TEST");
  await assert.rejects(() => fee.get(other.record.id, capital), /cannot handle Encanto/);
  await assert.rejects(() => fee.cancel(sheetId, "k", admin), /Void the payments/);
  const c = await fee.cancel(other.record.id, "kenneth", admin);
  assert.equal(c.record.status, "cancelled");
  await assert.rejects(() => fee.pay(other.record.id, { itemKey: "ssp", amount: 1, method: "CASH" }, "k", admin), /cancelled/);
  assert.equal((await fee.list({}, admin)).records.length, 1);
});
