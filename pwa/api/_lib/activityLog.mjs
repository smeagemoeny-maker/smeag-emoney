// Staff activity log: who did what, when, from where (one row per API request).
// - Supabase table public.staff_activity_log (migrations/supabase_activity_log.sql). On Vercel this is the only
//   copy, because a serverless function has no lasting disk.
// - Local Node server (not on Vercel): every entry is also appended to api/logs/activity-YYYY-MM-DD.log (JSON lines).
// Logging never breaks a request: write errors are printed and dropped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { httpError } from "./repository.mjs";
import { escapeLike, rest } from "./supabaseRepository.mjs";

const TABLE = "staff_activity_log";
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const WRITE_TIMEOUT_MS = 1500;
const MAX_DETAIL_CHARS = 4000;
const SECRET_KEYS = /pass(word)?|token|secret|dataurl|image(data)?$|photo(data)?$/i;

const dbBackend = process.env.USE_MOCK_DB === "true" ? "mock" : (process.env.DB_BACKEND || "supabase").toLowerCase();
const logDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../logs");
const writeFile = !process.env.VERCEL && process.env.ACTIVITY_LOG_FILE !== "off";

// [method, path pattern, label]. First match wins; anything else is logged as "METHOD path".
const ACTIONS = [
  ["POST", /^\/api\/auth\/login$/, "Login"],
  ["POST", /^\/api\/auth\/logout$/, "Logout"],
  ["GET", /^\/api\/products$/, "View products"],
  ["POST", /^\/api\/products$/, "Add product"],
  ["PATCH", /^\/api\/products\/\d+$/, "Edit product"],
  ["DELETE", /^\/api\/products\/\d+$/, "Delete product"],
  ["GET", /^\/api\/people\/by-nfc\//, "Card lookup"],
  ["POST", /^\/api\/checkouts$/, "Checkout (sale)"],
  ["POST", /^\/api\/charges$/, "Charge e-money"],
  ["POST", /^\/api\/pusanmart\/payments$/, "PusanMart payment"],
  ["GET", /^\/api\/pusanmart\/payments$/, "View PusanMart payments"],
  ["GET", /^\/api\/pusanmart\/daily$/, "View PusanMart daily summary"],
  ["PUT", /^\/api\/pusanmart\/daily\/[^/]+$/, "Save PusanMart daily cost"],
  ["GET", /^\/api\/sales$/, "View sales history"],
  ["GET", /^\/api\/reports\/sales$/, "View sales report"],
  ["GET", /^\/api\/people$/, "Search buyers"],
  ["PATCH", /^\/api\/people\/\d+$/, "Edit buyer"],
  ["GET", /^\/api\/office\/menus$/, "Office: load menus"],
  ["POST", /^\/api\/office\/transactions$/, "Office: confirm transaction"],
  ["GET", /^\/api\/office\/people$/, "Office: search people"],
  ["POST", /^\/api\/office\/people$/, "Office: register people"],
  ["GET", /^\/api\/office\/people\/for-default$/, "Office: default lookup"],
  ["PATCH", /^\/api\/office\/people\/\d+$/, "Office: modify person"],
  ["POST", /^\/api\/office\/people\/\d+\/default$/, "Office: default card"],
  ["POST", /^\/api\/office\/photos$/, "Office: upload photo"],
  ["POST", /^\/api\/office\/graduates\/backup$/, "Office: graduate backup"],
  ["GET", /^\/api\/office\/menu-list$/, "Office: view menu list"],
  ["POST", /^\/api\/office\/menu-list$/, "Office: add menu"],
  ["PATCH", /^\/api\/office\/menu-list\/\d+$/, "Office: edit menu"],
  ["DELETE", /^\/api\/office\/menu-list\/\d+$/, "Office: delete menu"],
  ["GET", /^\/api\/office\/bank$/, "Office: view bank list"],
  ["PATCH", /^\/api\/office\/bank\/\d+$/, "Office: edit bank row"],
  ["DELETE", /^\/api\/office\/bank\/\d+$/, "Office: delete bank row"],
  ["GET", /^\/api\/office\/bank-categories$/, "Office: bank categories"],
  ["GET", /^\/api\/office\/recharge-cashout$/, "Office: recharge/cashout"],
  ["GET", /^\/api\/office\/payments$/, "Office: payment inquiry"],
  ["GET", /^\/api\/office\/transdata$/, "Office: view TransData"],
  ["POST", /^\/api\/office\/transdata$/, "Office: move TransData"],
  ["GET", /^\/api\/office\/report$/, "Office: view report"],
  ["PUT", /^\/api\/office\/report$/, "Office: save report"],
  ["GET", /^\/api\/office\/activity-log$/, "Office: view activity log"],
  ["GET", /^\/api\/admin\/activity-log$/, "Admin: view activity log"],
  ["GET", /^\/api\/purchases$/, "View store purchases"],
  ["POST", /^\/api\/student\/purchases$/, "Student: view own purchases"],
  ["GET", /^\/api\/campus-admin\/requests$/, "Campus app: view requests"],
  ["POST", /^\/api\/campus-admin\/requests\/\d+$/, "Campus app: decide request"],
  ["POST", /^\/api\/campus-admin\/(notices|catalog|faq)$/, "Campus app: add item"],
  ["PATCH", /^\/api\/campus-admin\/(notices|catalog|faq)\/\d+$/, "Campus app: edit item"],
  ["DELETE", /^\/api\/campus-admin\/(notices|catalog|faq)\/\d+$/, "Campus app: delete item"],
  ["GET", /^\/api\/campus-admin\/students$/, "Campus app: search students"],
  ["POST", /^\/api\/campus-admin\/students\/\d+\/activation$/, "Campus app: issue sign-in code"],
  ["POST", /^\/api\/campus-admin\/students\/\d+\/unfreeze$/, "Campus app: unfreeze card"],
  ["POST", /^\/api\/campus-admin\/scores$/, "Campus app: import scores"],
];

export function shouldLog(method, pathname) {
  // Student app calls (/api/campus/...) are not staff activity, and their bodies carry PINs: never logged here.
  return method !== "OPTIONS" && method !== "HEAD" && pathname !== "/api/health" && !pathname.startsWith("/api/campus/");
}

function actionFor(method, pathname, result, status) {
  const hit = ACTIONS.find(([m, re]) => m === method && re.test(pathname));
  const label = hit ? hit[2] : `${method} ${pathname}`;
  if (label === "Login" && (status !== 200 || !result?.manager)) return "Login failed";
  return label;
}

// Copy of the request body/query that is safe and small enough to keep.
function scrub(value, depth = 0) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}… (${value.length} chars)` : value;
  if (depth > 4) return "…";
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((v) => scrub(v, depth + 1));
    if (value.length > 50) items.push(`… ${value.length - 50} more`);
    return items;
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[removed]" : scrub(v, depth + 1);
    return out;
  }
  return String(value);
}

function detailFor(method, url, body) {
  const query = Object.fromEntries([...url.searchParams].filter(([k]) => k !== "__path"));
  const detail = {};
  if (Object.keys(query).length) detail.query = scrub(query);
  if (method !== "GET" && body && Object.keys(body).length) detail.body = scrub(body);
  if (!Object.keys(detail).length) return null;
  const text = JSON.stringify(detail);
  return text.length > MAX_DETAIL_CHARS ? { truncated: text.slice(0, MAX_DETAIL_CHARS) } : detail;
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.headers["x-real-ip"] || req.socket?.remoteAddress || null;
}

// actor: { loginId, name, position, campus } from the session token, or null.
export async function recordActivity({ req, url, method, pathname, body, actor, result, status, error, startedAt }) {
  const loginBody = pathname === "/api/auth/login";
  const manager = loginBody ? result?.manager : null;
  const row = {
    login_id: manager?.login_id || actor?.loginId || (loginBody ? String(body?.loginId || "").trim() || null : null),
    staff_name: manager?.name || actor?.name || null,
    position: manager?.position || actor?.position || null,
    campus: manager?.campus || actor?.campus || null,
    action: actionFor(method, pathname, result, status),
    method,
    path: pathname,
    status,
    ok: status < 400 && !(loginBody && !manager),
    error: error ? String(error).slice(0, 500) : null,
    detail: detailFor(method, url, body),
    ip: clientIp(req),
    user_agent: String(req.headers["user-agent"] || "").slice(0, 300) || null,
    duration_ms: Date.now() - startedAt,
  };

  if (writeFile) appendFile(row);
  if (dbBackend !== "supabase") return;
  try {
    await Promise.race([
      rest(TABLE, { method: "POST", body: row, headers: { prefer: "return=minimal" } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), WRITE_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.error(`activity log write failed (${row.action}): ${err.message}`);
  }
}

function appendFile(row) {
  try {
    const now = new Date();
    const day = new Date(now.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, `activity-${day}.log`), `${JSON.stringify({ at: now.toISOString(), ...row })}\n`);
  } catch (err) {
    console.error(`activity log file write failed: ${err.message}`);
  }
}

// ---------- reading (Office > LOG tab) ----------

function isoDay(value, name) {
  const s = String(value || "");
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN;
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) throw httpError(400, `${name} must be a real date (YYYY-MM-DD).`);
  return s;
}

const MAX_LIST = 5000;

// f: { from, to, loginId, action, campus, onlyWrites, onlyAuth (login/logout rows only) }. campus (account campus) is forced for campus-only admins by the route.
export async function listActivity({ from, to, loginId, action, campus, onlyWrites, onlyAuth }) {
  const enc = encodeURIComponent;
  const filters = [
    `created_at=gte.${enc(`${isoDay(from, "from")}T00:00:00+08:00`)}`,
    `created_at=lte.${enc(`${isoDay(to, "to")}T23:59:59.999+08:00`)}`,
  ];
  const id = String(loginId || "").trim();
  if (id) filters.push(`login_id=ilike.${enc(`*${escapeLike(id)}*`)}`);
  const act = String(action || "").trim();
  if (act) filters.push(`action=ilike.${enc(`*${escapeLike(act)}*`)}`);
  if (campus) filters.push(`campus=ilike.${enc(escapeLike(campus))}`);
  if (onlyWrites) filters.push("method=neq.GET");
  if (onlyAuth) filters.push(`path=in.(${enc("/api/auth/login,/api/auth/logout")})`);

  const select = "id,created_at,login_id,staff_name,position,campus,action,method,path,status,ok,error,detail,ip,user_agent,duration_ms";
  const rows = [];
  for (let offset = 0; offset < MAX_LIST; offset += 1000) {
    const page = await rest(`${TABLE}?select=${select}&${filters.join("&")}&order=id.desc&offset=${offset}&limit=1000`).catch((err) => {
      if (/staff_activity_log/.test(err.message)) {
        throw httpError(503, "The activity log table is missing. Run api/migrations/supabase_activity_log.sql in the Supabase SQL Editor.");
      }
      throw err;
    });
    rows.push(...page);
    if (page.length < 1000) return { rows: rows.map(mapRow), truncated: false };
  }
  return { rows: rows.map(mapRow), truncated: true };
}

function mapRow(r) {
  return {
    id: r.id,
    time: new Date(new Date(r.created_at).getTime() + PH_OFFSET_MS).toISOString().slice(0, 19).replace("T", " "),
    loginId: r.login_id,
    name: r.staff_name,
    position: r.position,
    campus: r.campus,
    action: r.action,
    result: r.ok ? "OK" : `FAIL ${r.status}`,
    error: r.error,
    detail: r.detail ? JSON.stringify(r.detail) : "",
    ip: r.ip,
    device: r.user_agent,
    ms: r.duration_ms,
  };
}
