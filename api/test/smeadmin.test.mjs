// Parser + rule tests for smeadmin.mjs / smeadminRefund.mjs. Fixtures copy the smeadmin page structure
// (checked 2026-11-21) with made-up students; amounts are the three real cases of 2026-11-19.
// Run: cd api && npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  amountCurrency, refundKind, checkDiff, createSmeadminClient, normalizePassport, parseAmount, parseChangeList, parseChangeRecord,
  parseRmbNote, parseStudentDetail, parseStudentList, passportHash, sameName,
} from "../src/smeadmin.mjs";
import { nextStatus } from "../src/smeadminRefund.mjs";

const changeRow = (no, name, refund = "REFUND", status = "정상") => `
  <tr class='list col1'>
    <td align="center"><input type="checkbox" name="checked_id[]" id="checked_id" class="checkbox" value="${no}"></td>
    <td align="left">	test agency	</td>
    <td align="center">	${name} </td>
    <td align="center">	${name}			</td>
    <td align="center">	2026-11-19(14:06:09)		</td>
    <td align="center"><span style="color:#00D900; font-weight:bold;">CAPITAL</span></td>
    <td align="center"></td><td align="center"></td><td align="center"></td>
    <td align="center">${refund}</td>
    <td align="center"></td>
    <td align="center">${status}<input type="button" value="MODIFY" onclick="student_modify_change_modify(${no})"></td>
    <td align="center"><a href="javascript:open_invoice_for('${no}')">INVOICE</a></td>
    <td align="center">확정대기중</td>
    <td align="center"></td>
    <td align="center"><a href='student_delete2.php?modify_no=${no}&page=1' onclick='return aaa();'><img src='x.gif'></a></td>
  </tr>`;

const changeListHtml = `<html><form name=fboardlist method=post><table>
  <tr><td>AGENCY</td><td>NAME</td><td>STUDENT</td><td>APPLY DATE</td><td>CENTER</td><td>CHANGE</td><td>ADD COURSE</td>
  <td>ETC FEE</td><td>REFUND</td><td>HOLDING</td><td>MODIFY</td><td>INVOICE</td><td>RESULT</td></tr>
  ${changeRow(90001, "TEST ONE")}
  ${changeRow(90002, "TEST TWO", "", "정상")}
  </table></form><a href="?page=1">1</a><a href="?page=3">3</a></html>`;

const changeRecordHtml = (no, amount, note, process = "normal", result = "center") => `
  <form name=lesson_form method=post onsubmit="check_form();return false;">
  <input type=hidden name=modify_no value='${no}'>
  <input type=hidden name=mb_id value='studytour'>
  <input type="text" name="k_name" value='TEST ONE' class=input_st>
  <input type="text" name="origin_period" value='2026-11-01~2026-12-01(4weeks)'>
  <input type="text" name="apply_sme_campus" value='CAPITAL'>
  <input type="text" name="apply_date" value='2026-11-19(14:53:12)'>
  <input type="text" name="info_refund_amount" value='${amount}' class=input_st>
  <textarea name="info_refund_note" value='${note}' cols="40" rows="4" class=input_st>${note}</textarea>
  <select name="info_process">
    <option value="normal">상태(Status)</option>
    <option value="normal" ${process === "normal" ? "selected" : ""}>정상(Normal)</option>
    <option value="cancel" ${process === "cancel" ? "selected" : ""}>취소(Cancel)</option>
  </select>
  <select name="info_result">
    <option value="center" ${result === "center" ? "selected" : ""}>-센터수납미처리(Center not yet)-</option>
    <option value="refund" ${result === "refund" ? "selected" : ""}>환급완료(Refunded)</option>
    <option value="cancel" ${result === "cancel" ? "selected" : ""}>취소(Cancel)</option>
  </select>
  <input type="button" value="Modify" onclick="check_form()">
  </form>`;

const studentRow = (no, name, start, end) => `
  <tr class='list$list col1 ht center'>
    <td align="center"><input type="checkbox" name="checked_id[]" class="checkbox"
        value="${no}" /></td>
    <td align="left">test agency</td><td align="center">중국</td>
    <td align="center">${name}</td><td align="center">${name}</td><td align="center">1990-01-02</td>
    <td align="center">36</td><td align="center">여</td><td align="center">2026-10-13</td><td align="center">${start}</td>
    <td align="center">${start}</td><td align="center"><font color=green>EXTEND(연장)</font></td>
    <td align="center">${end}</td><td align="center">4주</td><td align="center">연장</td><td align="center">IELTS</td>
    <td align="center">CAPITAL1 / 407</td>
    <td align="left"><input type="button" value="수정" onclick="student_modify(${no})"></td>
  </tr>`;

test("change list: rows, refund flag, last page", () => {
  const { rows, lastPage } = parseChangeList(changeListHtml);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].changeNo, rows[0].name, rows[0].campus, rows[0].isRefund], [90001, "TEST ONE", "CAPITAL", true]);
  assert.equal(rows[1].isRefund, false);
  assert.equal(lastPage, 3);
});

test("change record: amount, note, selected status (first label option is not a value)", () => {
  const r = parseChangeRecord(changeRecordHtml(90001, "10,000P", "student allowance pay thru Alipay 1,046RMB\n1RMB=9.56P"), 90001);
  assert.equal(r.amountText, "10,000P");
  assert.equal(r.startDate, "2026-11-01");
  assert.equal(r.process, "normal");
  assert.equal(r.result, "center");
  assert.match(r.note, /1,046RMB/);
  const none = parseChangeRecord(changeRecordHtml(90001, "1P", "", "none", "none"), 90001);
  assert.equal(none.process, null);
  assert.throws(() => parseChangeRecord(changeRecordHtml(90001, "1P", ""), 90009), /layout/);
});

test("student list + detail: student no, period, passport from s_addr", () => {
  const list = parseStudentList(`<table>${studentRow(80001, "TEST ONE", "2026-10-04", "2026-10-31")}${studentRow(80002, "TEST ONE", "2026-11-01", "2026-12-01")}</table>`);
  assert.deepEqual(list.map((s) => [s.studentNo, s.startDate, s.endDate]), [[80001, "2026-10-04", "2026-10-31"], [80002, "2026-11-01", "2026-12-01"]]);
  const d = parseStudentDetail(`<input type="text" name="s_jumin" id="s_jumin" value='1990-01-02' size="16">
    <input type="text" name="s_addr" value='e 1234-5678' class=input_st>
    <script>if(!f.s_addr.value){ alert("Passport Number Field Error!"); }</script>`);
  assert.equal(normalizePassport(d.passport), "E12345678");
  assert.equal(d.birthDate, "1990-01-02");
});

test("logged-out page is an error, not an empty list", () => {
  assert.throws(() => parseChangeList(`<script>alert('로그인 하십시오.');</script><script>location.replace('../bbs/login.php?url=x');</script>`), /login/);
});

test("amount + RMB note parsing and the check", () => {
  assert.equal(parseAmount("10,000P"), 10000);
  assert.equal(parseAmount("10,000p"), 10000);
  assert.equal(parseAmount(""), null);
  assert.deepEqual(parseRmbNote("student allowance pay thru Alipay 1,046RMB\n1RMB=9.56P"), { rmb: 1046, rate: 9.56 });
  assert.deepEqual(parseRmbNote("1rmb=9.56p\nstudent alloawance pay thru Alipay 456rmb"), { rmb: 456, rate: 9.56 });
  assert.deepEqual(parseRmbNote("allowance pay thru Alipay 470.87RMB\n1RMB=9.56P"), { rmb: 470.87, rate: 9.56 });
  assert.equal(checkDiff(10000, 1046, 9.56), -0.24);
  assert.equal(checkDiff(4500, 470.87, 9.56), 1.52);
  assert.equal(checkDiff(10000, null, 9.56), null);
});

test("status rules: the three real requests of 2026-11-19", () => {
  const rec = (amountText, process, result, note = "student allowance pay thru Alipay") => ({ amountText, process, result, note });
  // 27810: 4,500P, 470.87 RMB -> diff 1.52, within the default 2P
  assert.equal(nextStatus(null, rec("4,500P", "normal", "center"), 1.52, 2), "pending");
  assert.equal(nextStatus(null, rec("4,500P", "normal", "center"), 1.52, 1), "mismatch");
  // 27811: 10,000p but 456 RMB, cancelled in smeadmin
  assert.equal(nextStatus(null, rec("10,000p", "cancel", "cancel"), -5640.64, 2), "cancelled");
  assert.equal(nextStatus(null, rec("10,000p", "normal", "center"), -5640.64, 2), "mismatch");
  // 27812: cancelled after being paid here -> must stand out
  assert.equal(nextStatus({ status: "paid" }, rec("10,000P", "cancel", "cancel"), -0.24, 2), "paid_then_cancelled");
  assert.equal(nextStatus({ status: "paid" }, rec("10,000P", "normal", "refund"), -0.24, 2), "paid");
  // done in smeadmin without this screen
  assert.equal(nextStatus(null, rec("10,000P", "normal", "refund"), -0.24, 2), "closed");
  // allowance without RMB/rate -> no check, the amount alone is enough
  assert.equal(nextStatus(null, rec("3,000P", "normal", "center"), null, 2), "pending");
  // real recent non-allowance refunds: shown, never paid from the card
  assert.equal(nextStatus(null, rec("4,400p", "normal", "center", "shorten 4w m-bill 2,000p + e-bill 2,400p"), null, 2), "other");
  // allowance written in dollars -> locked
  assert.equal(nextStatus(null, rec("$ 100", "normal", "center"), null, 2), "mismatch");
});

test("passport: normalize, hash without the number, names", () => {
  assert.equal(normalizePassport(" e12-345 678 "), "E12345678");
  assert.equal(normalizePassport("12"), null);
  const h = passportHash("E12345678", "x".repeat(32));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes("E12345678"));
  assert.equal(h, passportHash("E12345678", "x".repeat(32)));
  assert.throws(() => passportHash("E12345678", ""), /PASSPORT_HMAC_SECRET/);
  assert.ok(sameName("DUAN XIUJIAO", "duan  xiujiao"));
  assert.ok(sameName("XIUJIAO DUAN", "DUAN XIUJIAO"));
  assert.ok(sameName("KIM MINSUNG(supporter)", "KIM MINSUNG"));
  assert.ok(!sameName("DUAN YIBO", "DUAN XIUJIAO"));
});

test("client: only allowed pages, never delete/save", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push([init.method, url]);
    const html = url.includes("login_check") ? "<script>location.replace('/gnuboard4/adm/index.php');</script>"
      : url.includes("student_list_change") ? changeListHtml : changeRecordHtml(90001, "1P", "");
    return new Response(html, { headers: { "set-cookie": "PHPSESSID=abc; path=/" } });
  };
  const c = createSmeadminClient({ baseUrl: "http://sme.test/gnuboard4", loginId: "bot", password: "pw", fetchImpl: fake });
  await c.login();
  await c.changeList({ result: "center" });
  await c.changeRecord(90001);
  assert.deepEqual(calls.map((x) => x[0]), ["POST", "GET", "GET"]);
  assert.ok(calls.every(([, u]) => !/delete|_ok\.php|confirm/.test(u)));
  assert.match(calls[2][1], /student_modify_change\.php\?mode=modify&modify_no=90001$/);
  await assert.rejects(() => c.changeRecord("1 OR 1"), /Invalid/);
});

test("currency and refund kind from real smeadmin wording", () => {
  assert.equal(amountCurrency("10,000P"), "PHP");
  assert.equal(amountCurrency("26,600p"), "PHP");
  assert.equal(amountCurrency("10000"), "PHP");
  assert.equal(amountCurrency("$ 1,134"), "USD");
  assert.equal(amountCurrency("2,400$"), "USD");
  assert.equal(amountCurrency("1,046RMB"), "RMB");
  assert.equal(refundKind("student allowance pay thru Alipay 1,046RMB"), "allowance");
  assert.equal(refundKind("student alloawance pay thru Alipay 456rmb"), "allowance");
  assert.equal(refundKind("12w-8w=4w shorten 60% tuition fee refund"), "other");
  assert.equal(refundKind("7,800 SSP+4,300 SSP I-card +1,200 airport pick-up"), "other");
});
