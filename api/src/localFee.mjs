// /simulator "Local Fee": fee sheets per student + the payments received for them (cash, GCash, ...).
//
//   list()           sheets with paid / due per item (search by name or student ID, campus-scoped)
//   get()            one sheet with every payment (voided ones too)
//   create()/update() the page calculates the lines; the server checks them, recomputes the total and stores them
//   pay()            one payment for one item (never more than what is still due; client_key = no double submit)
//   voidPayment()    a wrong payment is voided, never deleted
//   cancel()         a sheet without active payments
//
// Payments here do NOT touch the e-money card balance. Tables: api/migrations/supabase_local_fee.sql.
import { httpError } from "./repository.mjs";
import { rest } from "./supabaseRepository.mjs";

const enc = encodeURIComponent;
const ENTRY_TYPES = ["G30", "G59", "C30", "C14", "C7"];
const METHODS = ["CASH", "GCASH", "BANK", "CARD", "OTHER"];
const RECORD_COLS = "id,person_id,uid,student_id,student_name,campus,entry_type,preset,weeks,extra_days,arrival_date,pickup,ssp_again,items,total,memo,status,created_by,created_at,updated_by,updated_at";
const PAYMENT_COLS = "id,record_id,item_key,item_name,amount,method,memo,received_by,received_at,voided_at,voided_by,void_reason";

// A missing table means the migration has not been run yet: say so instead of a bare 500.
async function db(path, opts) {
  try {
    return await rest(path, opts);
  } catch (e) {
    if (/local_fee_/.test(String(e.message)) && /does not exist|Could not find|schema cache/i.test(String(e.message))) {
      throw httpError(501, "Run api/migrations/supabase_local_fee.sql in the Supabase SQL Editor first.");
    }
    throw e;
  }
}

const cents = (n) => Math.round(Number(n) * 100);
const peso = (c) => c / 100;

function campusAllowed(access, campus) {
  if (!access || access.cafeCampuses.length >= 3) return true; // Admin with every campus
  return access.cafeCampuses.some((c) => c.toUpperCase() === String(campus || "").toUpperCase());
}

function toId(v, label = "id") {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, `Invalid ${label}.`);
  return n;
}

function text(v, max) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

// ---------- shape ----------

function cleanItems(items) {
  if (!Array.isArray(items) || !items.length) throw httpError(400, "No fee lines.");
  if (items.length > 60) throw httpError(400, "Too many fee lines.");
  const seen = new Set();
  return items.map((it) => {
    const key = String(it?.key || "");
    if (!/^[a-z0-9_]{1,40}$/.test(key)) throw httpError(400, `Invalid line key: ${key || "(empty)"}`);
    if (seen.has(key)) throw httpError(400, `Duplicate line: ${key}`);
    seen.add(key);
    const amount = Number(it.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) throw httpError(400, `Invalid amount for ${key}.`);
    return { key, name: text(it.name, 80) || key, amount: peso(cents(amount)), detail: text(it.detail, 200) || "" };
  });
}

function sheetBody(b, { partial }) {
  const out = {};
  if (!partial || b.entryType !== undefined) {
    if (!ENTRY_TYPES.includes(b.entryType)) throw httpError(400, "Choose the entry type.");
    out.entry_type = b.entryType;
  }
  if (!partial || b.preset !== undefined) {
    const p = text(b.preset, 20);
    if (!p) throw httpError(400, "Fee table version is required.");
    out.preset = p;
  }
  if (!partial || b.weeks !== undefined) {
    const w = Number(b.weeks);
    if (!Number.isInteger(w) || w < 1 || w > 104) throw httpError(400, "Weeks: 1-104.");
    out.weeks = w;
  }
  if (!partial || b.extraDays !== undefined) {
    const d = Number(b.extraDays || 0);
    if (!Number.isInteger(d) || d < 0 || d > 120) throw httpError(400, "Extra days: 0-120.");
    out.extra_days = d;
  }
  if (b.arrivalDate !== undefined) {
    const a = text(b.arrivalDate, 10);
    if (a && !/^\d{4}-\d{2}-\d{2}$/.test(a)) throw httpError(400, "Arrival date must be YYYY-MM-DD.");
    out.arrival_date = a;
  }
  if (b.pickup !== undefined) out.pickup = !!b.pickup;
  if (b.sspAgain !== undefined) out.ssp_again = !!b.sspAgain;
  if (b.memo !== undefined) out.memo = text(b.memo, 500);
  if (!partial || b.items !== undefined) {
    out.items = cleanItems(b.items);
    out.total = peso(out.items.reduce((a, it) => a + cents(it.amount), 0));
  }
  return out;
}

function summarize(r, payments) {
  const active = payments.filter((p) => !p.voided_at);
  const paidBy = new Map();
  for (const p of active) paidBy.set(p.item_key, (paidBy.get(p.item_key) || 0) + cents(p.amount));
  const items = (r.items || []).map((it) => {
    const paid = paidBy.get(it.key) || 0;
    return { ...it, paid: peso(paid), due: peso(cents(it.amount) - paid) };
  });
  // money received for a line that a recalculation removed is still shown (as an overpaid line)
  for (const [key, paid] of paidBy) {
    if (!items.some((it) => it.key === key)) {
      const name = active.find((p) => p.item_key === key)?.item_name || key;
      items.push({ key, name, amount: 0, detail: "removed by recalculation", paid: peso(paid), due: peso(-paid), removed: true });
    }
  }
  const total = cents(r.total);
  const paid = active.reduce((a, p) => a + cents(p.amount), 0);
  const status = r.status === "cancelled" ? "cancelled"
    : paid === 0 ? (total === 0 ? "paid" : "unpaid")
    : items.some((it) => cents(it.due) < 0) ? "overpaid"
    : paid >= total ? "paid" : "partial";
  return {
    id: Number(r.id), personId: r.person_id, uid: r.uid, studentId: r.student_id, studentName: r.student_name, campus: r.campus,
    entryType: r.entry_type, preset: r.preset, weeks: r.weeks, extraDays: r.extra_days, arrivalDate: r.arrival_date,
    pickup: r.pickup, sspAgain: r.ssp_again, memo: r.memo, items, total: peso(total), paid: peso(paid), due: peso(total - paid),
    status, createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at,
  };
}

function mapPayment(p) {
  return {
    id: Number(p.id), recordId: Number(p.record_id), itemKey: p.item_key, itemName: p.item_name, amount: Number(p.amount),
    method: p.method, memo: p.memo, receivedBy: p.received_by, receivedAt: p.received_at,
    voidedAt: p.voided_at, voidedBy: p.voided_by, voidReason: p.void_reason,
  };
}

async function paymentsFor(ids) {
  if (!ids.length) return [];
  return db(`local_fee_payment?select=${PAYMENT_COLS}&record_id=in.(${ids.join(",")})&order=id.asc`);
}

async function loadRecord(id, access) {
  const r = (await db(`local_fee_record?select=${RECORD_COLS}&id=eq.${toId(id)}`))[0];
  if (!r) throw httpError(404, "Fee sheet not found.");
  if (!campusAllowed(access, r.campus)) throw httpError(403, `This account cannot handle ${r.campus} students.`);
  return r;
}

// ---------- read ----------

export async function list({ search, status, personId, campus } = {}, access) {
  const filters = [`select=${RECORD_COLS}`, "order=id.desc", "limit=300"];
  filters.push(status === "cancelled" ? "status=eq.cancelled" : status === "all" ? "" : "status=eq.active");
  if (personId) filters.push(`person_id=eq.${toId(personId, "personId")}`);
  if (campus && campus !== "All") filters.push(`campus=ilike.${enc(String(campus).replace(/[*,()]/g, ""))}`);
  const s = String(search || "").replace(/[*,()"\\]/g, " ").trim();
  if (s) filters.push(`or=(${["student_name", "student_id", "uid"].map((c) => `${c}.ilike.${enc(`*${s}*`)}`).join(",")})`);
  const rows = (await db(`local_fee_record?${filters.filter(Boolean).join("&")}`)).filter((r) => campusAllowed(access, r.campus));
  const pays = await paymentsFor(rows.map((r) => r.id));
  let out = rows.map((r) => summarize(r, pays.filter((p) => Number(p.record_id) === Number(r.id))));
  if (["unpaid", "partial", "paid", "overpaid"].includes(status)) out = out.filter((r) => r.status === status);
  if (status === "open") out = out.filter((r) => r.status === "unpaid" || r.status === "partial" || r.status === "overpaid");
  return { records: out };
}

export async function get(id, access) {
  const r = await loadRecord(id, access);
  const pays = await paymentsFor([r.id]);
  return { record: summarize(r, pays), payments: pays.map(mapPayment) };
}

// ---------- write ----------

export async function create(body = {}, staffLoginId, access) {
  const row = sheetBody(body, { partial: false });
  if (body.personId) {
    const p = (await rest(`person?select=id,uid,studentid,name,campus&id=eq.${toId(body.personId, "personId")}`))[0];
    if (!p) throw httpError(404, "Student not found.");
    Object.assign(row, { person_id: p.id, uid: p.uid, student_id: p.studentid, student_name: p.name, campus: p.campus });
  } else {
    row.student_name = text(body.studentName, 100);
    row.student_id = text(body.studentId, 40);
    row.campus = text(body.campus, 40);
    if (!row.student_name) throw httpError(400, "Student name is required.");
  }
  if (!row.campus) throw httpError(400, "Campus is required.");
  if (!campusAllowed(access, row.campus)) throw httpError(403, `This account cannot handle ${row.campus} students.`);
  const [saved] = await db(`local_fee_record?select=${RECORD_COLS}`, {
    method: "POST", headers: { prefer: "return=representation" },
    body: { ...row, created_by: staffLoginId, updated_by: staffLoginId },
  });
  return { record: summarize(saved, []), payments: [] };
}

export async function update(id, body = {}, staffLoginId, access) {
  const r = await loadRecord(id, access);
  if (r.status === "cancelled") throw httpError(409, "This fee sheet was cancelled.");
  const patch = sheetBody(body, { partial: true });
  await db(`local_fee_record?id=eq.${r.id}`, {
    method: "PATCH", body: { ...patch, updated_by: staffLoginId, updated_at: new Date().toISOString() },
  });
  return get(r.id, access);
}

export async function pay(id, body = {}, staffLoginId, access) {
  const r = await loadRecord(id, access);
  if (r.status === "cancelled") throw httpError(409, "This fee sheet was cancelled.");
  const clientKey = text(body.clientKey, 80);
  if (clientKey) {
    const dup = (await db(`local_fee_payment?select=id,record_id&client_key=eq.${enc(clientKey)}`))[0];
    if (dup) return { ...(await get(r.id, access)), repeated: true };
  }
  const item = (r.items || []).find((it) => it.key === body.itemKey);
  if (!item) throw httpError(400, "Choose a fee line that is on this sheet.");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, "Amount must be more than 0.");
  if (!METHODS.includes(body.method)) throw httpError(400, `Payment method: ${METHODS.join(", ")}.`);
  const pays = await paymentsFor([r.id]);
  const paid = pays.filter((p) => !p.voided_at && p.item_key === item.key).reduce((a, p) => a + cents(p.amount), 0);
  const due = cents(item.amount) - paid;
  if (due <= 0) throw httpError(409, `${item.name} is already fully paid.`);
  if (cents(amount) > due) throw httpError(409, `${item.name}: only ₱${peso(due).toLocaleString("en-US")} is still due.`);
  await db("local_fee_payment", {
    method: "POST", headers: { prefer: "return=minimal" },
    body: { record_id: r.id, item_key: item.key, item_name: item.name, amount: peso(cents(amount)), method: body.method,
      memo: text(body.memo, 200), client_key: clientKey, received_by: staffLoginId },
  });
  return { ...(await get(r.id, access)), repeated: false };
}

export async function voidPayment(paymentId, body = {}, staffLoginId, access) {
  const p = (await db(`local_fee_payment?select=${PAYMENT_COLS}&id=eq.${toId(paymentId)}`))[0];
  if (!p) throw httpError(404, "Payment not found.");
  await loadRecord(p.record_id, access);
  if (p.voided_at) throw httpError(409, `Already voided by ${p.voided_by}.`);
  const reason = text(body.reason, 200);
  if (!reason) throw httpError(400, "Write why this payment is voided.");
  await db(`local_fee_payment?id=eq.${p.id}&voided_at=is.null`, {
    method: "PATCH", body: { voided_at: new Date().toISOString(), voided_by: staffLoginId, void_reason: reason },
  });
  return get(p.record_id, access);
}

export async function cancel(id, staffLoginId, access) {
  const r = await loadRecord(id, access);
  if (r.status === "cancelled") return get(r.id, access);
  const pays = await paymentsFor([r.id]);
  if (pays.some((p) => !p.voided_at)) throw httpError(409, "Void the payments of this sheet first.");
  await db(`local_fee_record?id=eq.${r.id}`, {
    method: "PATCH", body: { status: "cancelled", updated_by: staffLoginId, updated_at: new Date().toISOString() },
  });
  return get(r.id, access);
}
