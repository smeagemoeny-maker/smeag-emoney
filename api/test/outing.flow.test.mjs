// OUTING tab (outing.mjs) with NO network: global fetch is an in-memory PostgREST, any other URL fails.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_KEY = "test-key";

const tables = {
  person: [
    { id: 7, uid: "04aa11", studentid: "S7", name: "KIM TEST", campus: "Capital" },
    { id: 8, uid: "04bb22", studentid: "S8", name: "LEE TEST", campus: "Encanto" },
  ],
  student_outing: [],
};
let seq = 0;

function cond(col, op, val) {
  return (row) => {
    const cell = row[col];
    if (op === "eq") return String(cell) === val;
    if (op === "ilike") return String(cell ?? "").toLowerCase() === val.toLowerCase();
    if (op === "is") return cell == null;
    if (op === "gte") return cell != null && Date.parse(cell) >= Date.parse(val);
    if (op === "lt") return cell != null && Date.parse(cell) < Date.parse(val);
    if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").includes(String(cell));
    throw new Error(`fake rest: op ${op}`);
  };
}
// "a.gte.X" or "and(a.gte.X,b.lt.Y)"
function part(p) {
  const and = /^and\((.*)\)$/.exec(p);
  if (and) { const fs = and[1].split(",").map(part); return (row) => fs.every((f) => f(row)); }
  const m = /^(\w+)\.(\w+)\.(.*)$/.exec(p);
  return cond(m[1], m[2], m[3]);
}
function splitTop(s) {
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function parseFilters(params) {
  const f = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit"].includes(k)) continue;
    if (k === "or") { const fs = splitTop(v.replace(/^\(|\)$/g, "")).map(part); f.push((row) => fs.some((fn) => fn(row))); continue; }
    const m = /^(\w+)\.(.*)$/.exec(v);
    f.push(cond(k, m[1], m[2]));
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
  const rep = String(init.headers?.prefer || "").includes("representation");
  if (init.method === "GET") return rows.filter(match).map((r) => structuredClone(r));
  if (init.method === "PATCH") {
    const hit = rows.filter(match);
    hit.forEach((r) => Object.assign(r, body));
    return rep ? hit.map((r) => structuredClone(r)) : null;
  }
  if (init.method === "POST") {
    const out = [];
    for (const item of [].concat(body)) {
      if (rows.some((r) => r.person_id === item.person_id && r.returned_at == null && r.voided_at == null)) {
        return { __status: 409, message: 'duplicate key value violates unique constraint "student_outing_one_open"' };
      }
      const row = { id: ++seq, returned_at: null, returned_by: null, voided_at: null, voided_by: null, void_reason: null, ...item };
      rows.push(row);
      out.push(structuredClone(row));
    }
    return rep ? out : null;
  }
  throw new Error(`fake rest: ${init.method}`);
}

globalThis.fetch = async (url, init = {}) => {
  const s = String(url);
  if (!s.startsWith("http://supabase.test/")) throw new Error(`unexpected network call: ${s}`);
  const out = restCall(s, { method: "GET", ...init });
  return new Response(out === null ? "" : JSON.stringify(out), { status: out?.__status || 200 });
};

const outing = await import("../src/outing.mjs");
const admin = { cafeCampuses: ["Capital", "Encanto", "Tarlac"] };
const capital = { cafeCampuses: ["Capital"] };
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

let firstId;

test("tap: unknown card, campus scope, on campus", async () => {
  await assert.rejects(() => outing.byUid("FFFF", admin), /not registered/);
  await assert.rejects(() => outing.byUid("04BB22", capital), /cannot handle/);
  const r = await outing.byUid("04:AA:11", admin);
  assert.equal(r.person.name, "KIM TEST");
  assert.equal(r.open, null);
});

test("check out: validation, then one open outing per student", async () => {
  await assert.rejects(() => outing.checkOut({ uid: "04aa11", kind: "WALK", expectedReturnAt: inHours(3) }, "k", admin), /OUTING or OVERNIGHT/);
  await assert.rejects(() => outing.checkOut({ uid: "04aa11", kind: "OUTING", expectedReturnAt: inHours(-1) }, "k", admin), /already past/);
  await assert.rejects(() => outing.checkOut({ uid: "04aa11", kind: "OUTING", expectedReturnAt: inHours(24 * 20) }, "k", admin), /14 days/);
  await assert.rejects(() => outing.checkOut({ uid: "04bb22", kind: "OUTING", expectedReturnAt: inHours(3) }, "k", capital), /cannot handle/);

  const { outing: o } = await outing.checkOut({ uid: "04AA11", kind: "OUTING", expectedReturnAt: inHours(3), destination: "SM Mall", clientKey: "c1" }, "kenneth", admin);
  firstId = o.id;
  assert.equal(o.status, "out");
  assert.equal(o.studentName, "KIM TEST");
  assert.equal(tables.student_outing[0].out_by, "kenneth");

  const again = await outing.checkOut({ uid: "04AA11", kind: "OUTING", expectedReturnAt: inHours(3), clientKey: "c1" }, "kenneth", admin);
  assert.equal(again.repeated, true);
  assert.equal(tables.student_outing.length, 1);
  await assert.rejects(() => outing.checkOut({ uid: "04AA11", kind: "OVERNIGHT", expectedReturnAt: inHours(20) }, "k", admin), /already out/);

  const tap = await outing.byUid("04aa11", admin);
  assert.equal(tap.open.id, firstId);
});

test("list: still out, late counter, campus filter", async () => {
  await outing.checkOut({ uid: "04bb22", kind: "OVERNIGHT", expectedReturnAt: inHours(20) }, "k", admin);
  // make LEE late: expected return in the past
  tables.student_outing[1].expected_return_at = inHours(-1);
  const all = await outing.list({ view: "out" }, admin);
  assert.equal(all.outings.length, 2);
  assert.deepEqual(all.summary, { outing: 1, overnight: 1, late: 1, outingLate: 0, overnightNoon: 0, overnightMidnight: 0, returnedToday: 0 });
  assert.equal(all.outings.find((r) => r.studentName === "LEE TEST").status, "late");
  const cap = await outing.list({ view: "out" }, capital);
  assert.equal(cap.outings.length, 1);
  const day = await outing.list({ view: "day" }, admin);
  assert.equal(day.outings.length, 2);
});

test("check in, late return, undo, void", async () => {
  const back = await outing.checkIn(firstId, "anna", admin);
  assert.equal(back.outing.status, "returned");
  assert.equal(back.outing.returnedBy, "anna");
  assert.equal((await outing.checkIn(firstId, "anna", admin)).repeated, true);

  const lee = tables.student_outing[1];
  const late = await outing.checkIn(lee.id, "anna", admin);
  assert.equal(late.outing.status, "returned_late");
  assert.ok(late.outing.lateMinutes >= 59);

  const s = await outing.list({ view: "day" }, admin);
  assert.equal(s.summary.returnedToday, 2);
  assert.equal(s.summary.late, 0);

  const undone = await outing.undoReturn(firstId, "anna", admin);
  assert.equal(undone.outing.status, "out");
  assert.match(tables.student_outing[0].memo, /undone by anna/);

  await assert.rejects(() => outing.voidOuting(firstId, {}, "anna", admin), /why/);
  const v = await outing.voidOuting(firstId, { reason: "wrong card" }, "anna", admin);
  assert.equal(v.outing.status, "voided");
  assert.equal((await outing.byUid("04aa11", admin)).open, null);
  // voided -> can go out again
  const next = await outing.checkOut({ uid: "04aa11", kind: "OVERNIGHT", expectedReturnAt: inHours(20) }, "k", admin);
  assert.equal(next.outing.kind, "OVERNIGHT");
});

test("overnight check points: next day 12:00 and 24:00 (PH)", async () => {
  // left 2026-11-24 23:30 PH (= 15:30Z) -> noon 2026-11-25 12:00 PH, midnight 2026-11-26 00:00 PH
  assert.deepEqual(outing.overnightDeadlines("2026-11-24T15:30:00.000Z"),
    { noon: "2026-11-25T04:00:00.000Z", midnight: "2026-11-25T16:00:00.000Z" });
  // left 00:30 PH on the 25th -> it is already "the 25th": check points are the 26th
  assert.equal(outing.overnightDeadlines("2026-11-24T16:30:00.000Z").noon, "2026-11-26T04:00:00.000Z");

  tables.student_outing.length = 0;
  const mk = (id, personId, kind, outAgoH) => tables.student_outing.push({ id: 100 + id, person_id: personId, uid: "u" + id, student_name: "S" + id,
    campus: "Capital", kind, out_at: inHours(-outAgoH), expected_return_at: inHours(-outAgoH + 1), returned_at: null, voided_at: null });
  mk(1, 51, "OVERNIGHT", 1);    // just left: fine
  mk(2, 52, "OVERNIGHT", 40);   // past next-day noon, maybe past midnight
  mk(3, 53, "OVERNIGHT", 60);   // surely past next-day 24:00
  mk(4, 54, "OUTING", 60);      // outings never count here
  const noon = await outing.list({ view: "overnight_noon" }, admin);
  const mid = await outing.list({ view: "overnight_midnight" }, admin);
  assert.ok(noon.outings.every((r) => r.kind === "OVERNIGHT" && r.overnightStage >= 1));
  assert.ok(noon.outings.some((r) => r.studentName === "S3") && noon.outings.some((r) => r.studentName === "S2"));
  assert.ok(mid.outings.some((r) => r.studentName === "S3"));
  assert.ok(!mid.outings.some((r) => r.studentName === "S1") && !noon.outings.some((r) => r.studentName === "S1"));
  assert.equal(noon.summary.overnightNoon, noon.outings.length);
  assert.equal(noon.summary.overnightMidnight, mid.outings.length);
  assert.equal((await outing.list({ view: "out_outing" }, admin)).outings.length, 1);
  assert.equal((await outing.list({ view: "out_overnight" }, admin)).outings.length, 3);
});

test("phDayRange: Philippine day is UTC+8", () => {
  const r = outing.phDayRange("2026-11-24");
  assert.equal(r.start, "2026-11-23T16:00:00.000Z");
  assert.equal(r.end, "2026-11-24T16:00:00.000Z");
});
