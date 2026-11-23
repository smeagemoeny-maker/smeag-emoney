// smeadmin.com (gnuboard4, PHP, no API) — READ-ONLY client and HTML parsers.
//
// Safety rules (smeadmin's DELETE is a plain GET link, and the change form re-posts every field):
// - Only the pages in ALLOWED can be requested. Nothing here follows links found in a page.
// - The only POST is the login form. Saves (student_modify_change_ok.php), confirm and delete pages are never called.
// - The passport number is returned to the caller only to be hashed (passportHash); it is never logged or stored.
//
// Page structure was checked on 2026-11-19/21 (see docs/SMEADMIN_REFUND.md). If smeadmin changes a page,
// the parsers throw SmeadminLayoutError and the office falls back to the manual flow.
import crypto from "node:crypto";

export class SmeadminLayoutError extends Error {
  constructor(message) {
    super(`smeadmin page layout changed: ${message}`);
    this.status = 502;
  }
}

// path -> required query values (null = any value allowed for that key)
const ALLOWED = {
  "adm/student_list_change.php": {},
  "adm/student_modify_change.php": { mode: "modify" },
  "adm/student_list.php": {},
  "adm/student_modify.php": { mode: "modify" },
  "bbs/logout.php": {},
};

// ---------- small HTML helpers ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export function decodeHtml(s) {
  return String(s ?? "").replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e) => {
    if (ENTITIES[e.toLowerCase()] !== undefined) return ENTITIES[e.toLowerCase()];
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}

export function cellText(html) {
  return decodeHtml(String(html).replace(/<!--.*?-->/gs, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeHtml(m[1] ?? m[2] ?? m[3] ?? "") : null;
}

// Form values the way the page shows them: inputs (text/hidden), textareas, and the *selected* option of selects
// (a select with no `selected` option gives null, not its first option: smeadmin's first option is a label).
export function parseFormValues(html) {
  const out = {};
  const put = (name, value) => { if (name && !(name in out)) out[name] = value; };
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const type = (attr(m[0], "type") || "text").toLowerCase();
    if (["button", "submit", "image", "reset", "file"].includes(type)) continue;
    if ((type === "checkbox" || type === "radio") && !/\bchecked\b/i.test(m[0])) continue;
    put(attr(m[0], "name"), attr(m[0], "value") ?? "");
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    put(attr(m[1], "name"), decodeHtml(m[2]).replace(/\r\n/g, "\n").trim());
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const sel = /<option\b([^>]*\bselected\b[^>]*)>/i.exec(m[2]);
    put(attr(m[1], "name"), sel ? attr(sel[1], "value") : null);
  }
  return out;
}

function tableRows(html, startMarker) {
  const from = startMarker ? html.indexOf(startMarker) : 0;
  if (from < 0) throw new SmeadminLayoutError(`marker "${startMarker}" not found`);
  const rows = [];
  for (const m of html.slice(from).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const id = /name=["']?checked_id\[\]["']?[^>]*\bvalue=["']?(\d+)/i.exec(m[1]) ||
      /\bvalue=["']?(\d+)["']?[^>]*name=["']?checked_id\[\]/i.exec(m[1]);
    if (!id) continue;
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    rows.push({ id: Number(id[1]), cells, html: m[1] });
  }
  return rows;
}

export function assertLoggedIn(html) {
  if (/로그인\s*하십시오|bbs\/login\.php\?url=/.test(html) && !/fboardlist|lesson_form|checked_id/.test(html)) {
    const e = new Error("smeadmin login failed or expired. Check SMEADMIN_LOGIN_ID / SMEADMIN_PASSWORD.");
    e.status = 502;
    throw e;
  }
}

// ---------- page parsers ----------

// student_list_change.php: [check, AGENCY, NAME, STUDENT, APPLY DATE, CENTER, CHANGE, ADD COURSE, ETC FEE,
//                           REFUND, HOLDING, MODIFY(status text), INVOICE, RESULT, COMPLETE DATE, DELETE]
export function parseChangeList(html) {
  assertLoggedIn(html);
  if (!/AGENCY[\s\S]{0,400}APPLY DATE[\s\S]{0,800}REFUND/i.test(html)) throw new SmeadminLayoutError("change list header");
  const rows = tableRows(html).map(({ id, cells }) => {
    if (cells.length < 14) throw new SmeadminLayoutError(`change list row ${id} has ${cells.length} cells`);
    const t = cells.map(cellText);
    return {
      changeNo: id, agency: t[1], name: t[2], student: t[3], appliedAt: t[4], campus: t[5],
      isRefund: /refund/i.test(t[9]), isHolding: t[10] !== "", statusText: t[11], resultText: t[13], completedAt: t[14] || "",
    };
  });
  const pages = [...html.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1]));
  return { rows, lastPage: pages.length ? Math.max(...pages) : 1 };
}

// student_modify_change.php?mode=modify&modify_no=N
export function parseChangeRecord(html, changeNo) {
  assertLoggedIn(html);
  if (!/name=["']?lesson_form/i.test(html)) throw new SmeadminLayoutError("change form not found");
  const v = parseFormValues(html);
  if (String(v.modify_no) !== String(changeNo)) throw new SmeadminLayoutError(`change form is for ${v.modify_no}, expected ${changeNo}`);
  const period = /^(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/.exec(v.origin_period || "");
  return {
    changeNo: Number(changeNo),
    agencyId: v.mb_id || "",
    nationality: v.nationality || "",
    name: (v.k_name || "").trim(),
    startDate: period ? period[1] : null,
    endDate: period ? period[2] : null,
    campus: v.apply_sme_campus || "",
    appliedAt: v.apply_date || "",
    amountText: (v.info_refund_amount || "").trim(),
    note: v.info_refund_note || "",
    process: v.info_process || null, // normal | cancel | waiting (null = never set)
    result: v.info_result || null,   // center | account | collection | refund | holding | cancel
  };
}

// student_list.php: [check(student no), AGENCY, NATION, NAME, ENGLISH, BIRTH, AGE, SEX, REGISTERED, DEPARTURE,
//                    START, PICKUP, END, PERIOD, STATUS, COURSE, ROOM, buttons...]
export function parseStudentList(html) {
  assertLoggedIn(html);
  return tableRows(html).map(({ id, cells }) => {
    if (cells.length < 15) throw new SmeadminLayoutError(`student row ${id} has ${cells.length} cells`);
    const t = cells.map(cellText);
    return { studentNo: id, agency: t[1], nationality: t[2], name: t[3], englishName: t[4], birthDate: t[5],
      registeredAt: t[8], startDate: t[10], endDate: t[12], status: t[14] };
  });
}

// student_modify.php?mode=modify&modify_no=N. The passport number is in the field named s_addr
// (label "PASSPORT NUMBER", required by the page's own check: "Passport Number Field Error!").
export function parseStudentDetail(html) {
  assertLoggedIn(html);
  if (!/Passport Number Field Error/i.test(html)) throw new SmeadminLayoutError("passport check not found on student page");
  const v = parseFormValues(html);
  return { passport: v.s_addr || "", birthDate: v.s_jumin || "", name: (v.k_name || "").trim(), englishName: (v.e_name || "").trim() };
}

// ---------- amounts ----------

function num(s) {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// "10,000P" / "10,000p" / "4,500 P" / "10000" -> 10000
export function parseAmount(text) {
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(String(text || ""));
  return m ? num(m[1]) : null;
}

// Currency written in the amount box: smeadmin mixes "10,000P", "$ 1,134", "2,400$". Only pesos can be paid
// from an e-money card. A bare number counts as pesos (the form's fee boxes are "ONLY PESO").
export function amountCurrency(text) {
  const s = String(text || "");
  if (/\$|usd|dollar/i.test(s)) return "USD";
  if (/rmb|cny|元|yuan/i.test(s)) return "RMB";
  if (/₩|krw|원/i.test(s)) return "KRW";
  if (/¥|jpy|円/i.test(s)) return "JPY";
  return "PHP";
}

// Refunds paid out through the e-money card (student allowance sent by Alipay/WeChat etc.).
// Other refunds (course shortening, tuition, bills) are shown for information only.
export function refundKind(note) {
  return /allowance|alloawance|alipay|wechat|e-?money/i.test(String(note || "")) ? "allowance" : "other";
}

// "student allowance pay thru Alipay 1,046RMB\n1RMB=9.56P" -> { rmb: 1046, rate: 9.56 }
export function parseRmbNote(note) {
  const s = String(note || "");
  const rateM = /1\s*rmb\s*=\s*(\d+(?:\.\d+)?)\s*p/i.exec(s);
  const rest = rateM ? s.replace(rateM[0], " ") : s;
  const rmbM = /(\d[\d,]*(?:\.\d+)?)\s*rmb/i.exec(rest);
  return { rmb: rmbM ? num(rmbM[1]) : null, rate: rateM ? num(rateM[1]) : null };
}

// rmb * rate - amount, rounded to centavos (null when the note has no RMB/rate)
export function checkDiff(amount, rmb, rate) {
  if (amount == null || rmb == null || rate == null) return null;
  return Math.round((rmb * rate - amount) * 100) / 100;
}

// ---------- passport ----------

export function normalizePassport(value) {
  const p = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{6,12}$/.test(p) ? p : null;
}

export function passportHash(normalized, secret) {
  if (!secret || String(secret).length < 16) {
    const e = new Error("PASSPORT_HMAC_SECRET is not set (16+ characters).");
    e.status = 501;
    throw e;
  }
  return crypto.createHmac("sha256", String(secret)).update(`passport:${normalized}`).digest("hex");
}

// Same person in smeadmin and e-money? Compare names ignoring case, spaces, punctuation and word order.
export function sameName(a, b) {
  const key = (s) => String(s || "").toUpperCase().replace(/\(.*?\)/g, " ").replace(/[^A-ZÀ-ɏ가-힣一-鿿]+/g, " ")
    .trim().split(" ").filter(Boolean).sort().join(" ");
  return key(a) !== "" && key(a) === key(b);
}

// ---------- HTTP client ----------

export function createSmeadminClient({ baseUrl, loginId, password, fetchImpl = fetch, timeoutMs = 15000 }) {
  const base = String(baseUrl || "http://www.smeadmin.com/gnuboard4").replace(/\/+$/, "");
  if (!loginId || !password) {
    const e = new Error("smeadmin sync is not configured (SMEADMIN_LOGIN_ID / SMEADMIN_PASSWORD).");
    e.status = 501;
    throw e;
  }
  const cookies = new Map();

  function cookieHeader() {
    return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  function keepCookies(res) {
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    for (const c of list) {
      const m = /^([^=;\s]+)=([^;]*)/.exec(c);
      if (m) cookies.set(m[1], m[2]);
    }
  }
  async function send(url, init) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, redirect: "manual", signal: ctrl.signal,
        headers: { ...(init.headers || {}), cookie: cookieHeader(), "user-agent": "smeag-office-sync/1.0" } });
      keepCookies(res);
      const buf = await res.arrayBuffer();
      return new TextDecoder("utf-8").decode(buf);
    } catch (e) {
      const err = new Error(e.name === "AbortError" ? "smeadmin did not answer in time." : `smeadmin request failed: ${e.message}`);
      err.status = 502;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function get(path, params = {}) {
    const rule = ALLOWED[path];
    if (!rule) throw new Error(`smeadmin path not allowed: ${path}`);
    for (const [k, v] of Object.entries(rule)) {
      if (params[k] !== v) throw new Error(`smeadmin ${path} needs ${k}=${v}`);
    }
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
    return send(`${base}/${path}${qs ? `?${qs}` : ""}`, { method: "GET" });
  }

  return {
    async login() {
      const body = new URLSearchParams({ mb_id: loginId, mb_password: password, url: "/gnuboard4/adm/index.php" });
      const html = await send(`${base}/bbs/login_check.php`, {
        method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
      if (/alert\(/.test(html) && !/location\.replace\(['"][^'"]*adm\/index\.php/.test(html)) {
        const e = new Error("smeadmin rejected the login. Check SMEADMIN_LOGIN_ID / SMEADMIN_PASSWORD.");
        e.status = 502;
        throw e;
      }
    },
    // result: 'center' | 'account' | undefined (all)
    async changeList({ page = 1, result } = {}) {
      return parseChangeList(await get("adm/student_list_change.php", { info_amount: "info_refund_amount", info_result: result, page }));
    },
    async changeRecord(changeNo) {
      const no = Number(changeNo);
      if (!Number.isInteger(no) || no <= 0) throw new Error("Invalid change no.");
      return parseChangeRecord(await get("adm/student_modify_change.php", { mode: "modify", modify_no: String(no) }), no);
    },
    async searchStudents(name) {
      return parseStudentList(await get("adm/student_list.php", { sfl: "name", stx: String(name || "").trim() }));
    },
    async studentDetail(studentNo) {
      const no = Number(studentNo);
      if (!Number.isInteger(no) || no <= 0) throw new Error("Invalid student no.");
      return parseStudentDetail(await get("adm/student_modify.php", { mode: "modify", modify_no: String(no) }));
    },
    async logout() {
      try { await get("bbs/logout.php"); } catch { /* ignore */ }
    },
  };
}
