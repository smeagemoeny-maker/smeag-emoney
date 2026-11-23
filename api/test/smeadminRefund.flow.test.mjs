// End-to-end flow of the SME REFUND tab with NO network: global fetch is replaced by a fake smeadmin site
// and a small in-memory PostgREST. Any other URL fails the test, so the real Supabase is never touched.
// Covers: sync -> link card -> pay -> pay again (no double charge) -> cancelled later in smeadmin.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.PASSPORT_HMAC_SECRET = "test-secret-0123456789abcdef";
process.env.SMEADMIN_LOGIN_ID = "bot";
process.env.SMEADMIN_PASSWORD = "pw";
process.env.SMEADMIN_BASE_URL = "http://sme.test/gnuboard4";
process.env.TOKEN_SECRET = "t".repeat(32);

const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

// ---------- fake smeadmin ----------
const sme = {
  changes: {
    // allowance, matches (10,000 vs 1,046 x 9.56 = 9,999.76)
    91001: { name: "TEST ONE", amount: "10,000P", note: "student allowance pay thru Alipay 1,046RMB\n1RMB=9.56P", process: "normal", result: "center", day: today },
    // allowance, wrong note (456 RMB) -> mismatch
    91002: { name: "TEST ONE", amount: "10,000p", note: "student alloawance pay thru Alipay 456rmb\n1rmb=9.56p", process: "normal", result: "center", day: today },
    // course shortening -> other
    91003: { name: "TEST TWO", amount: "4,400p", note: "shorten 4w m-bill 2,000p + e-bill 2,400p", process: "normal", result: "center", day: today },
    // old request (2013) -> outside the window, never read
    50001: { name: "OLD ONE", amount: "1,000p", note: "allowance", process: "normal", result: "center", day: "2013-02-14" },
  },
  students: { "TEST ONE": [{ no: 81001, start: "2026-10-04", end: "2026-10-31" }, { no: 81002, start: "2026-11-01", end: "2026-12-01" }], "TEST TWO": [] },
  passport: { 81002: "e 1234-5678", 81001: "E12345678" },
  requests: [],
};

function smeHtml(url) {
  const u = new URL(url);
  const p = u.pathname.replace("/gnuboard4/", "");
  sme.requests.push(`${p}${u.search}`);
  if (p === "adm/student_list_change.php") {
    const want = u.searchParams.get("info_result");
    const rows = Object.entries(sme.changes).filter(([, c]) => c.result === want).sort((a, b) => b[0] - a[0])
      .map(([no, c]) => `<tr><td><input type="checkbox" name="checked_id[]" value="${no}"></td><td>agency</td><td>${c.name}</td><td>${c.name}</td>
        <td>${c.day}(10:00:00)</td><td>CAPITAL</td><td></td><td></td><td></td><td>REFUND</td><td></td><td>정상</td><td>INVOICE</td><td></td><td></td><td></td></tr>`);
    return `<form name=fboardlist><table><tr><td>AGENCY</td><td>APPLY DATE</td><td>REFUND</td></tr>${rows.join("")}</table></form>`;
  }
  if (p === "adm/student_modify_change.php") {
    const no = u.searchParams.get("modify_no");
    const c = sme.changes[no];
    return `<form name=lesson_form><input type=hidden name=modify_no value='${no}'><input name="k_name" value='${c.name}'>
      <input name="origin_period" value='2026-11-01~2026-12-01(4weeks)'><input name="apply_sme_campus" value='CAPITAL'>
      <input name="apply_date" value='${c.day}(10:00:00)'><input name="info_refund_amount" value='${c.amount}'>
      <textarea name="info_refund_note">${c.note}</textarea>
      <select name="info_process"><option value="normal">상태</option><option value="${c.process}" selected>x</option></select>
      <select name="info_result"><option value="${c.result}" selected>x</option></select></form>`;
  }
  if (p === "adm/student_list.php") {
    const list = sme.students[u.searchParams.get("stx")] || [];
    return `<table>${list.map((s) => `<tr><td><input type="checkbox" name="checked_id[]" value="${s.no}"></td><td>a</td><td>중국</td>
      <td>${u.searchParams.get("stx")}</td><td>${u.searchParams.get("stx")}</td><td>1990-01-02</td><td>36</td><td>여</td><td>2026-10-13</td>
      <td>${s.start}</td><td>${s.start}</td><td>-</td><td>${s.end}</td><td>4주</td><td>정상</td><td>IELTS</td></tr>`).join("")}</table>`;
  }
  if (p === "adm/student_modify.php") {
    const no = u.searchParams.get("modify_no");
    return `<input name="s_jumin" value='1990-01-02'><input name="s_addr" value='${sme.passport[no]}'><input name="k_name" value='TEST ONE'>
      <script>alert("Passport Number Field Error!")</script>`;
  }
  if (p === "bbs/login_check.php") return "<script>location.replace('/gnuboard4/adm/index.php');</script>";
  if (p === "bbs/logout.php") return "bye";
  throw new Error(`fake smeadmin: unexpected ${p}`);
}

// ---------- fake PostgREST ----------
const tables = {
  smeadmin_refund: [], student_identity: [], smeadmin_sync_state: [{ id: 1 }],
  person: [
    { id: 7, uid: "04aa11", name: "TEST ONE", campus: "Capital", totalmoney: 12000, s_date: "2026-11-01", e_date: "2026-12-01" },
    { id: 8, uid: "04bb22", name: "SOMEONE ELSE", campus: "Capital", totalmoney: 50000, s_date: "2026-11-01", e_date: "2026-12-01" },
  ],
};
const keys = { smeadmin_refund: "change_no", student_identity: "passport_hash", smeadmin_sync_state: "id" };
const txnKeys = new Map();
let txnSeq = 100;

function parseFilters(params) {
  const f = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
    const m = /^(eq|in|gte)\.(.*)$/.exec(v);
    if (!m) throw new Error(`fake rest: filter ${k}=${v}`);
    f.push([k, m[1], m[1] === "in" ? m[2].replace(/^\(|\)$/g, "").split(",") : m[2]]);
  }
  return (row) => f.every(([k, op, val]) => {
    const cell = row[k];
    if (op === "eq") return String(cell).toLowerCase() === String(val).toLowerCase();
    if (op === "in") return val.map(String).includes(String(cell));
    return String(cell) >= String(val);
  });
}

function restCall(url, init) {
  const u = new URL(url);
  const path = u.pathname.replace("/rest/v1/", "");
  const body = init.body ? JSON.parse(init.body) : undefined;
  const prefer = String(init.headers?.prefer || "");
  if (path === "rpc/pos_office_transaction") {
    if (body.p_client_key && txnKeys.has(body.p_client_key)) return { ...txnKeys.get(body.p_client_key), repeated: true };
    const p = tables.person.find((x) => x.uid === body.p_uid);
    if (!p) return { __status: 404, code: "PT404", message: "Student not found." };
    const amount = body.p_lines.reduce((a, l) => a + l.unitPrice * l.qty, 0);
    if (p.totalmoney < amount) return { __status: 409, code: "PT409", message: "Insufficient balance." };
    const before = p.totalmoney;
    p.totalmoney -= amount;
    const result = { id: ++txnSeq, bankIds: [txnSeq], balanceBefore: before, balanceAfter: p.totalmoney, netChange: -amount, lines: body.p_lines };
    if (body.p_client_key) txnKeys.set(body.p_client_key, result);
    return { ...result, repeated: false };
  }
  const rows = tables[path];
  if (!rows) throw new Error(`fake rest: table ${path}`);
  const match = parseFilters(u.searchParams);
  if (init.method === "GET") return rows.filter(match).map((r) => ({ ...r }));
  if (init.method === "PATCH") { rows.filter(match).forEach((r) => Object.assign(r, body)); return null; }
  if (init.method === "POST") {
    for (const item of [].concat(body)) {
      const k = keys[path];
      const hit = rows.find((r) => r[k] === item[k]);
      if (hit && prefer.includes("ignore-duplicates")) continue;
      if (hit) Object.assign(hit, item);
      else rows.push({ status: "pending", first_seen_at: new Date().toISOString(), person_id: null, ...item });
    }
    return null;
  }
  throw new Error(`fake rest: ${init.method}`);
}

globalThis.fetch = async (url, init = {}) => {
  const s = String(url);
  if (s.startsWith("http://sme.test/")) return new Response(smeHtml(s), { headers: { "set-cookie": "PHPSESSID=x" } });
  if (s.startsWith("http://supabase.test/")) {
    const out = restCall(s, { method: "GET", ...init });
    const status = out && out.__status ? out.__status : 200;
    return new Response(out === null ? "" : JSON.stringify(out), { status });
  }
  throw new Error(`unexpected network call: ${s}`);
};

const ref = await import("../src/smeadminRefund.mjs");
const admin = { cafeCampuses: ["Capital", "Encanto", "Tarlac"] };
const encanto = { cafeCampuses: ["Encanto"] };
const byNo = (no) => tables.smeadmin_refund.find((r) => r.change_no === no);

test("sync: reads recent refunds only, classifies them, keeps only a passport hash", async () => {
  const r = await ref.sync("kenneth");
  assert.equal(r.listed, 3);
  assert.equal(r.errors.length, 0);
  assert.equal(byNo(91001).status, "pending");
  assert.equal(byNo(91002).status, "mismatch");
  assert.equal(byNo(91003).status, "other");
  assert.equal(byNo(50001), undefined);
  assert.ok(!sme.requests.some((q) => /modify_no=50001/.test(q)), "old request must not be read");
  assert.ok(!sme.requests.some((q) => /delete|_ok\.php|confirm/.test(q)));
  // registration of the request period (81002), passport stored as hash + last 4 only
  assert.equal(byNo(91001).sme_student_no, 81002);
  assert.equal(byNo(91001).passport_last4, "5678");
  assert.equal(tables.student_identity.length, 1);
  assert.ok(!JSON.stringify(tables).includes("12345678"), "full passport number must not be stored");
  // "other" refunds do not trigger the 2-page passport lookup
  assert.equal(byNo(91003).passport_hash, undefined);
});

test("list + campus scope", async () => {
  const all = await ref.list({ status: "pending,mismatch,other" }, admin);
  assert.deepEqual(all.refunds.map((x) => x.changeNo).sort(), [91001, 91002, 91003]);
  assert.equal(all.refunds.find((x) => x.changeNo === 91001).card, null);
  const other = await ref.list({ status: "all" }, encanto);
  assert.equal(other.refunds.length, 0);
});

test("pay is blocked until the card is linked; wrong name needs confirmation", async () => {
  await assert.rejects(() => ref.pay(91001, {}, "kenneth", admin), /Link the student's card/);
  await assert.rejects(() => ref.linkCard(91001, { uid: "04BB22" }, "kenneth", admin), /NAME_MISMATCH/);
  const linked = await ref.linkCard(91001, { uid: "04AA11" }, "kenneth", admin);
  assert.equal(linked.card.uid, "04aa11");
  assert.equal(linked.card.nameMatches, true);
  await assert.rejects(() => ref.pay(91001, { uid: "04bb22" }, "kenneth", admin), /not this student's linked card/);
  await assert.rejects(() => ref.pay(91001, {}, "kenneth", encanto), /cannot handle CAPITAL/);
});

test("pay: one DECREASE Refund/Student allowance line, never twice", async () => {
  const before = tables.person[0].totalmoney;
  const res = await ref.pay(91001, { uid: "04AA11" }, "kenneth", admin);
  assert.equal(res.transaction.balanceBefore - res.transaction.balanceAfter, 10000);
  assert.equal(tables.person[0].totalmoney, before - 10000);
  assert.equal(byNo(91001).status, "paid");
  assert.equal(byNo(91001).paid_by, "kenneth");
  const line = txnKeys.get("smeadmin-refund-91001").lines[0];
  assert.deepEqual([line.type, line.mMenu, line.sMenu, line.unitPrice, line.qty], ["DECREASE", "Refund", "Student allowance", 10000, 1]);
  await assert.rejects(() => ref.pay(91001, {}, "kenneth", admin), /Already paid/);
  // even if our row were reset, the RPC key stops a second charge
  byNo(91001).status = "pending";
  const again = await ref.pay(91001, {}, "kenneth", admin);
  assert.equal(again.transaction.repeated, true);
  assert.equal(tables.person[0].totalmoney, before - 10000);
});

test("mismatch and other cannot be paid", async () => {
  await assert.rejects(() => ref.pay(91002, {}, "kenneth", admin), /does not match/);
  await assert.rejects(() => ref.pay(91003, {}, "kenneth", admin), /not a student allowance/);
});

test("passport search finds the card and the refunds", async () => {
  const r = await ref.findByPassport("E1234 5678", admin);
  assert.equal(r.known, true);
  assert.equal(r.card.uid, "04aa11");
  assert.deepEqual(r.refunds.map((x) => x.changeNo).sort(), [91001, 91002]);
  await assert.rejects(() => ref.findByPassport("12", admin), /6-12/);
});

test("cancelled in smeadmin after we paid -> paid_then_cancelled", async () => {
  sme.changes[91001].process = "cancel";
  sme.changes[91001].result = "cancel";
  await ref.sync("kenneth");
  assert.equal(byNo(91001).status, "paid_then_cancelled");
  assert.equal(byNo(91001).paid_by, "kenneth", "paid fields survive a sync");
});
