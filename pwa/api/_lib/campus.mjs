// SMEAG Campus app API: student login, wallet, requests, notices, scores, and the staff side of them.
// Tables and RPCs: migrations/supabase_campus_app.sql. Supabase only.
//
// Students sign in with their student ID + a 4-6 digit PIN. The first time, they set the PIN after proving
// who they are with their card (Android: tap it; otherwise type the UID) or a one-time code from the office.
// Student tokens are signed with a key derived from TOKEN_SECRET that staff tokens never use, so a student
// token can never pass access.mjs verifyRequest and a staff token can never pass verifyStudent.
//
// Request types and their form fields are defined once below (REQUEST_TYPES). The app draws its forms from
// GET /api/campus/config, and the same definitions validate every submission here. Fees always come from
// campus_catalog on the server, never from the client.
import crypto from "node:crypto";
import "./env.mjs";
import { normalizeUid } from "./db.mjs";
import { httpError } from "./repository.mjs";
import { q, rest } from "./supabaseRepository.mjs";

const enc = encodeURIComponent;
const PH_MS = 8 * 3600e3;
const TOKEN_TTL_MS = 30 * 24 * 3600e3;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60e3;
const ACTIVATION_TTL_MS = 3 * 24 * 3600e3;

// ---------- small helpers ----------

export const phToday = () => new Date(Date.now() + PH_MS).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const clean = (v, max = 500) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const campusKey = (c) => {
  const u = String(c || "").trim().toUpperCase();
  return u === "TALRAC" ? "TARLAC" : u;
};

function phDateTime(value) {
  if (!value) return null;
  return new Date(new Date(value).getTime() + PH_MS).toISOString().slice(0, 16).replace("T", " ");
}

function isDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// ---------- student session token ----------

const baseSecret = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const studentKey = crypto.createHmac("sha256", baseSecret).update("smeag-campus-student-v1").digest();
const signStudent = (data) => crypto.createHmac("sha256", studentKey).update(data).digest("base64url");

function issueStudentToken(personId, tokenVersion) {
  const data = Buffer.from(JSON.stringify({ t: "student", pid: personId, tv: tokenVersion, exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
  return `${data}.${signStudent(data)}`;
}

function readStudentToken(req) {
  const header = String(req.headers.authorization || "");
  const [data, sig] = (header.startsWith("Bearer ") ? header.slice(7) : "").split(".");
  if (!data || !sig) throw httpError(401, "Please sign in.");
  const expected = signStudent(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw httpError(401, "Your session is not valid. Please sign in again.");
  }
  const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  if (payload.t !== "student" || !(payload.exp > Date.now())) throw httpError(401, "Your session expired. Please sign in again.");
  return payload;
}

// Loads the signed-in student's account + person row. Throws 401 when the PIN changed since the token was issued.
export async function verifyStudent(req) {
  const tok = readStudentToken(req);
  const [account] = await rest(`campus_accounts?select=*&person_id=eq.${tok.pid}&limit=1`);
  if (!account || !account.pin_hash || account.token_version !== tok.tv) throw httpError(401, "Please sign in again.");
  const person = await personById(tok.pid);
  if (!person) throw httpError(401, "Your student record was not found. Please ask the office.");
  return { account, person };
}

// ---------- PIN hashing (scrypt) ----------

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function checkPin(pin, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = crypto.scryptSync(String(pin), Buffer.from(salt, "base64url"), want.length);
  return crypto.timingSafeEqual(want, got);
}

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

function validPin(pin) {
  const p = String(pin ?? "");
  if (!/^\d{4,6}$/.test(p)) throw httpError(400, "The PIN must be 4 to 6 digits.");
  if (/^(\d)\1+$/.test(p) || "0123456789".includes(p) || "9876543210".includes(p)) {
    throw httpError(400, "Choose a PIN that is harder to guess (not 1111 or 1234).");
  }
  return p;
}

// ---------- person lookup ----------

const PERSON_COLS = "id,uid,studentid,name,age,gender,campus,s_date,e_date,totalmoney,photo";

async function personById(id) {
  const [row] = await rest(`person?select=${PERSON_COLS}&id=eq.${Number(id)}&limit=1`);
  return row || null;
}

// The current record for a student ID: not a released card (G prefix), latest course end first.
async function peopleByStudentId(studentId) {
  const sid = clean(studentId, 40);
  if (!sid) throw httpError(400, "Enter your student ID.");
  const rows = await rest(`person?select=${PERSON_COLS}&studentid=eq.${enc(sid)}&order=e_date.desc,id.desc&limit=10`);
  return rows.sort((a, b) => Number(isReleased(a)) - Number(isReleased(b)));
}
const isReleased = (p) => /^g/i.test(String(p.uid || ""));

async function accountsFor(personIds) {
  if (!personIds.length) return [];
  return rest(`campus_accounts?select=*&person_id=in.(${personIds.map(Number).join(",")})`);
}

async function patchAccount(personId, fields) {
  const [row] = await rest(`campus_accounts?person_id=eq.${Number(personId)}`, {
    method: "PATCH", body: fields, headers: { Prefer: "return=representation" },
  });
  return row;
}

async function upsertAccount(row) {
  const [saved] = await rest("campus_accounts?on_conflict=person_id", {
    method: "POST", body: row, headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });
  return saved;
}

async function guardLock(account) {
  if (account?.locked_until && Date.parse(account.locked_until) > Date.now()) {
    const mins = Math.ceil((Date.parse(account.locked_until) - Date.now()) / 60e3);
    throw httpError(429, `Too many wrong tries. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
}

async function recordFailure(account) {
  if (!account) return;
  const failed = (account.failed_count || 0) + 1;
  await patchAccount(account.person_id, failed >= MAX_FAILED
    ? { failed_count: 0, locked_until: new Date(Date.now() + LOCK_MS).toISOString() }
    : { failed_count: failed });
}

function sessionResult(person, account) {
  return { token: issueStudentToken(person.id, account.token_version), lang: account.lang };
}

// ---------- activation and login ----------

// First sign-in (or after the office reset the PIN): student ID + (card UID or office code) + new PIN.
export async function activate({ studentId, uid, code, pin }) {
  const newPin = validPin(pin);
  const people = await peopleByStudentId(studentId);
  const accounts = await accountsFor(people.map((p) => p.id));
  for (const a of accounts) await guardLock(a);

  let person = null;
  const cardUid = normalizeUid(uid);
  if (cardUid) {
    person = people.find((p) => normalizeUid(p.uid) === cardUid) || null;
    if (person && isReleased(person)) throw httpError(403, "This card was released. Use your current card or ask the office.");
  } else if (clean(code)) {
    const hash = sha256(clean(code).replace(/\s/g, ""));
    const hit = accounts.find((a) => a.activation_hash && a.activation_hash === hash && Date.parse(a.activation_expires) > Date.now());
    person = hit ? people.find((p) => p.id === hit.person_id) || null : null;
  } else {
    throw httpError(400, "Tap your card or enter the code from the office.");
  }

  if (!person) {
    // Count the miss against the student's current account (if any) so the code cannot be guessed.
    await recordFailure(accounts.find((a) => a.person_id === people[0]?.id) || accounts[0]);
    throw httpError(401, "The student ID and card (or code) do not match. Check them or ask the office.");
  }

  const existing = accounts.find((a) => a.person_id === person.id);
  const account = await upsertAccount({
    person_id: person.id,
    pin_hash: hashPin(newPin),
    activation_hash: null,
    activation_expires: null,
    failed_count: 0,
    locked_until: null,
    token_version: (existing?.token_version || 0) + 1,
    last_login_at: new Date().toISOString(),
  });
  return sessionResult(person, account);
}

export async function login({ studentId, pin }) {
  const people = await peopleByStudentId(studentId);
  const accounts = await accountsFor(people.map((p) => p.id));
  const withPin = accounts.filter((a) => a.pin_hash);
  if (!withPin.length) throw httpError(404, "This student ID has no app account yet. Choose \"First time here\" to set a PIN.");
  for (const a of withPin) await guardLock(a);

  const account = withPin.find((a) => checkPin(String(pin ?? ""), a.pin_hash));
  if (!account) {
    await recordFailure(withPin[0]);
    throw httpError(401, "Wrong student ID or PIN.");
  }

  // Re-issued card: the office made a new person row. Move the account to the current record.
  let person = people.find((p) => p.id === account.person_id);
  const current = people.find((p) => !isReleased(p));
  let saved = account;
  if (current && person && current.id !== person.id && !accounts.some((a) => a.person_id === current.id)) {
    await rest(`campus_accounts?person_id=eq.${account.person_id}`, { method: "DELETE" });
    saved = await upsertAccount({ ...account, person_id: current.id, failed_count: 0, locked_until: null, last_login_at: new Date().toISOString() });
    person = current;
  } else {
    saved = await patchAccount(account.person_id, { failed_count: 0, locked_until: null, last_login_at: new Date().toISOString() });
  }
  return sessionResult(person, saved);
}

export async function changePin({ account }, { oldPin, newPin }) {
  if (!checkPin(String(oldPin ?? ""), account.pin_hash)) {
    await recordFailure(account);
    throw httpError(401, "Your current PIN is wrong.");
  }
  const pin = validPin(newPin);
  const saved = await patchAccount(account.person_id, { pin_hash: hashPin(pin), token_version: account.token_version + 1, failed_count: 0 });
  return { token: issueStudentToken(account.person_id, saved.token_version) };
}

export async function setLang({ account }, { lang }) {
  if (lang !== "en" && lang !== "ko") throw httpError(400, "lang must be 'en' or 'ko'.");
  await patchAccount(account.person_id, { lang });
  return { lang };
}

// ---------- profile, balance ----------

async function pendingFees(personId) {
  const rows = await rest(`campus_requests?select=fee&person_id=eq.${personId}&status=in.(submitted,reviewing)&charge_bank_id=is.null&fee=gt.0`);
  return round2(rows.reduce((s, r) => s + Number(r.fee), 0));
}

export async function me({ account, person }) {
  const held = await pendingFees(person.id);
  const balance = round2(person.totalmoney || 0);
  const today = phToday();
  return {
    person: {
      id: person.id,
      name: person.name,
      studentId: person.studentid,
      campus: person.campus,
      startDate: person.s_date,
      endDate: person.e_date,
      daysLeft: person.e_date ? Math.round((Date.parse(person.e_date) - Date.parse(today)) / 86400e3) : null,
      photo: person.photo || null,
    },
    wallet: { balance, held, available: round2(balance - held), cardFrozen: account.card_frozen, frozenAt: account.frozen_at },
    lang: account.lang,
  };
}

// ---------- wallet history (bank = last ~month, beforebank = older; ids share one sequence) ----------

const BANK_COLS = "id,category,subcategory,transaction_type,payment,totalmoney,quantity,remark,transaction_source,transaction_date";

function walletRow(r) {
  const inc = String(r.transaction_type).toLowerCase() === "increase";
  return {
    id: r.id,
    date: phDateTime(r.transaction_date),
    kind: inc ? "in" : "out",
    title: clean(r.subcategory || r.category, 120) || (inc ? "Top-up" : "Payment"),
    place: clean(r.category, 60),
    amount: round2((inc ? 1 : -1) * Number(r.payment || 0)),
    balanceAfter: num(r.totalmoney),
    quantity: r.quantity,
    source: r.transaction_source,
  };
}

export async function wallet({ person }, { kind, before }) {
  const uid = normalizeUid(person.uid);
  const filters = [`uid=eq.${enc(uid)}`];
  if (kind === "in") filters.push("transaction_type=eq.increase");
  if (kind === "out") filters.push("transaction_type=eq.decrease");
  if (before && /^\d+$/.test(String(before))) filters.push(`id=lt.${before}`);
  const where = filters.join("&");
  const LIMIT = 40;
  const [recent, older] = await Promise.all([
    rest(`bank?select=${BANK_COLS}&${where}&order=id.desc&limit=${LIMIT}`),
    rest(`beforebank?select=${BANK_COLS}&${where}&order=id.desc&limit=${LIMIT}`),
  ]);
  const seen = new Set();
  const rows = [...recent, ...older]
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => b.id - a.id)
    .slice(0, LIMIT);

  // 30-day totals (bank holds about a month).
  let summary = null;
  if (!before) {
    const from = new Date(Date.parse(`${addDays(phToday(), -29)}T00:00:00+08:00`)).toISOString();
    const month = await rest(`bank?select=transaction_type,payment&uid=eq.${enc(uid)}&transaction_date=gte.${enc(from)}&limit=5000`);
    summary = month.reduce((s, r) => {
      if (String(r.transaction_type).toLowerCase() === "increase") s.topUps = round2(s.topUps + Number(r.payment || 0));
      else s.spent = round2(s.spent + Number(r.payment || 0));
      return s;
    }, { days: 30, topUps: 0, spent: 0 });
  }
  return { rows: rows.map(walletRow), next: rows.length === LIMIT ? rows[rows.length - 1].id : null, summary };
}

export async function setFrozen({ account }, { frozen }) {
  const value = frozen === true;
  const saved = await patchAccount(account.person_id, { card_frozen: value, frozen_at: value ? new Date().toISOString() : null });
  return { cardFrozen: saved.card_frozen, frozenAt: saved.frozen_at };
}

// Store terminals (PWA POS) call this before charging a card. A frozen card cannot pay.
// If the lookup itself fails (e.g. the campus migration has not been run yet) the sale goes ahead:
// a broken freeze check must never stop every store from selling.
export async function assertCardUsable(uid) {
  const u = normalizeUid(uid);
  if (!u) return;
  let frozen = [];
  try {
    const people = await rest(`person?select=id&uid=eq.${enc(u)}&limit=5`);
    if (!people.length) return;
    frozen = await rest(`campus_accounts?select=person_id&card_frozen=is.true&person_id=in.(${people.map((p) => p.id).join(",")})&limit=1`);
  } catch (error) {
    console.warn("Card freeze check skipped:", error.message);
    return;
  }
  if (frozen.length) throw httpError(423, "This card is frozen by the student (lost card). It cannot pay. Ask the student to unfreeze it in the SMEAG app or visit the office.");
}

// ---------- notices ----------

function noticeFilter(campus) {
  const now = q(new Date().toISOString());
  const parts = [`or(expires_at.is.null,expires_at.gt.${now})`, `published_at.lte.${now}`];
  if (campus) parts.unshift(`or(campus.is.null,campus.ilike.${q(campus)})`);
  return `and=${enc(`(${parts.join(",")})`)}`;
}

export async function notices({ person }) {
  const rows = await rest(`campus_notices?select=id,campus,title_en,title_ko,body_en,body_ko,pinned,published_at&${noticeFilter(person.campus)}&order=pinned.desc,published_at.desc&limit=30`);
  return { notices: rows.map((n) => ({ ...n, published: phDateTime(n.published_at) })) };
}

// ---------- catalog ----------

async function catalogItems(kind, campus) {
  const filters = ["active=is.true"];
  if (kind) filters.push(`kind=eq.${enc(kind)}`);
  if (campus) filters.push(`or=(campus.is.null,campus.ilike.${enc(q(campus))})`);
  return rest(`campus_catalog?select=*&${filters.join("&")}&order=kind.asc,sort.asc,starts_at.asc.nullslast,id.asc&limit=200`);
}

export async function catalog({ person }, { kind }) {
  const rows = await catalogItems(kind, person.campus);
  const now = Date.now();
  return { items: rows.filter((r) => !r.starts_at || Date.parse(r.starts_at) > now).map(catalogView) };
}

const catalogView = (r) => ({
  id: r.id, kind: r.kind, title_en: r.title_en, title_ko: r.title_ko, detail_en: r.detail_en, detail_ko: r.detail_ko,
  fee: num(r.fee), feeUnit: r.fee_unit, startsAt: phDateTime(r.starts_at), capacity: r.capacity,
});

// ---------- request types (the one engine) ----------

const opt = (value, en, ko) => ({ value, en, ko });
const f = (name, kind, en, ko, extra = {}) => ({ name, kind, en, ko, required: true, ...extra });
const optional = { required: false };

export const REQUEST_TYPES = {
  activity: {
    group: "life", en: "Activity sign-up", ko: "액티비티 신청", catalog: "activity",
    fields: [f("note", "textarea", "Anything we should know?", "전달할 내용", optional)],
  },
  room_change: {
    group: "life", en: "Room change", ko: "방 이동 신청",
    fields: [
      f("currentRoom", "text", "Current room", "현재 방 번호", { max: 20 }),
      f("roomType", "select", "Room type you want", "원하는 방 타입", {
        options: [opt("single", "Single", "1인실"), opt("double", "Double", "2인실"), opt("triple", "Triple", "3인실"), opt("quad", "Quad", "4인실")],
      }),
      f("moveDate", "date", "Move date", "이동 희망일", { min: "today" }),
      f("reason", "textarea", "Reason", "사유", { max: 500 }),
    ],
  },
  cleaning: {
    group: "life", en: "Room cleaning", ko: "방청소 신청",
    fields: [
      f("room", "text", "Room", "방 번호", { max: 20 }),
      f("date", "date", "Date", "날짜", { min: "today" }),
      f("slot", "select", "Time", "시간대", { options: [opt("morning", "Morning (9-12)", "오전 (9-12시)"), opt("afternoon", "Afternoon (1-5)", "오후 (1-5시)")] }),
      f("note", "textarea", "Note for the cleaner", "요청 사항", optional),
    ],
  },
  clinic: {
    group: "life", en: "Clinic class", ko: "클리닉 신청",
    fields: [
      f("subject", "select", "Subject", "과목", {
        options: [opt("speaking", "Speaking", "스피킹"), opt("writing", "Writing", "라이팅"), opt("listening", "Listening", "리스닝"),
          opt("reading", "Reading", "리딩"), opt("grammar", "Grammar", "문법"), opt("ielts", "IELTS", "IELTS"), opt("toefl", "TOEFL", "TOEFL")],
      }),
      f("date", "date", "Preferred date", "희망 날짜", { min: "today" }),
      f("slot", "select", "Preferred time", "희망 시간대", {
        options: [opt("morning", "Morning", "오전"), opt("afternoon", "Afternoon", "오후"), opt("evening", "Evening", "저녁")],
      }),
      f("note", "textarea", "What do you want to work on?", "보충하고 싶은 내용", optional),
    ],
  },
  overnight: {
    group: "life", en: "Overnight leave", ko: "외박 신청서",
    fields: [
      f("destination", "text", "Where are you staying?", "숙박 장소", { max: 120 }),
      f("leaveDate", "date", "Leave date", "외박 시작일", { min: "today" }),
      f("returnDate", "date", "Return date", "복귀일", { min: "today" }),
      f("contact", "tel", "Phone number while away", "외박 중 연락처", { max: 30 }),
      f("companion", "text", "Going with (names)", "동행자", { ...optional, max: 120 }),
      f("note", "textarea", "Note", "메모", optional),
    ],
  },
  graduation: {
    group: "departure", en: "Graduation check", ko: "졸업 확인", once: true,
    fields: [
      f("endDate", "date", "Last class day", "마지막 수업일", { prefill: "endDate" }),
      f("note", "textarea", "Certificate name or other notes", "수료증 이름 등 메모", optional),
    ],
  },
  checkout: {
    group: "departure", en: "Checkout time", ko: "퇴실 시간 신청", once: true, needs: "graduation",
    fields: [
      f("date", "date", "Checkout date", "퇴실 날짜", { min: "today", prefill: "endDate" }),
      f("time", "time", "Checkout time", "퇴실 시간"),
      f("flight", "text", "Flight number", "항공편", { ...optional, max: 20 }),
      f("note", "textarea", "Note", "메모", optional),
    ],
  },
  pickup: {
    group: "departure", en: "Airport pickup", ko: "픽업 요청", catalog: "pickup",
    fields: [
      f("date", "date", "Pickup date", "픽업 날짜", { min: "today" }),
      f("time", "time", "Pickup time", "픽업 시간"),
      f("flight", "text", "Flight number", "항공편", { max: 20 }),
      f("passengers", "number", "Passengers", "인원", { min: 1, max: 10, prefillValue: 1 }),
      f("luggage", "number", "Bags", "짐 개수", { min: 0, max: 20, prefillValue: 1 }),
      f("note", "textarea", "Note", "메모", optional),
    ],
  },
  car_rental: {
    group: "departure", en: "Car rental", ko: "차량 렌탈 신청", catalog: "car",
    fields: [
      f("startDate", "date", "From", "시작일", { min: "today" }),
      f("endDate", "date", "To", "종료일", { min: "today" }),
      f("destination", "text", "Where to", "목적지", { max: 120 }),
      f("passengers", "number", "Passengers", "인원", { min: 1, max: 15, prefillValue: 1 }),
      f("note", "textarea", "Note", "메모", optional),
    ],
  },
  refund: {
    group: "departure", en: "Balance refund", ko: "잔액 환불 신청", once: true,
    fields: [
      f("date", "date", "When will you pick up the cash?", "환불 수령 희망일", { min: "today", prefill: "endDate" }),
      f("note", "textarea", "Note", "메모", optional),
    ],
  },
  course_change: {
    group: "academic", en: "Course change & payment", ko: "교육과정 변경·결제", catalog: "course",
    fields: [
      f("startDate", "date", "Start date", "변경 시작일", { min: "today" }),
      f("weeks", "number", "Weeks", "기간(주)", { min: 1, max: 24, prefillValue: 1, onlyWhenUnit: "week" }),
      f("reason", "textarea", "Reason", "사유", { max: 500 }),
    ],
  },
};

export function config() {
  return {
    groups: [
      { key: "life", en: "Campus life", ko: "생활" },
      { key: "departure", en: "Departure", ko: "퇴실" },
      { key: "academic", en: "Academics", ko: "학업" },
    ],
    types: Object.entries(REQUEST_TYPES).map(([key, t]) => ({ key, ...t })),
    statuses: {
      submitted: { en: "Sent", ko: "접수" }, reviewing: { en: "Reviewing", ko: "검토중" }, approved: { en: "Approved", ko: "승인" },
      rejected: { en: "Rejected", ko: "반려" }, cancelled: { en: "Cancelled", ko: "취소" }, done: { en: "Done", ko: "완료" },
    },
  };
}

function validatePayload(type, input, ctx) {
  const def = REQUEST_TYPES[type];
  const out = {};
  const today = phToday();
  for (const field of def.fields) {
    if (field.onlyWhenUnit && ctx.item?.fee_unit !== field.onlyWhenUnit) continue;
    const raw = input?.[field.name];
    const empty = raw === undefined || raw === null || String(raw).trim() === "";
    if (empty) {
      if (field.required) throw httpError(400, `${field.en} is required.`);
      continue;
    }
    let v;
    switch (field.kind) {
      case "date":
        v = String(raw);
        if (!isDay(v)) throw httpError(400, `${field.en} must be a real date.`);
        if (field.min === "today" && v < today) throw httpError(400, `${field.en} cannot be in the past.`);
        if (v > addDays(today, 400)) throw httpError(400, `${field.en} is too far ahead.`);
        break;
      case "time":
        v = String(raw);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw httpError(400, `${field.en} must be a time like 14:30.`);
        break;
      case "number":
        v = Number(raw);
        if (!Number.isInteger(v) || v < (field.min ?? 0) || v > (field.max ?? 1000)) {
          throw httpError(400, `${field.en} must be a whole number from ${field.min ?? 0} to ${field.max ?? 1000}.`);
        }
        break;
      case "select":
        v = String(raw);
        if (!field.options.some((o) => o.value === v)) throw httpError(400, `Choose a valid ${field.en.toLowerCase()}.`);
        break;
      case "tel":
        v = clean(raw, field.max || 30);
        if (!/^[+\d][\d\s()-]{5,}$/.test(v)) throw httpError(400, `${field.en} does not look like a phone number.`);
        break;
      default:
        v = clean(raw, field.max || (field.kind === "textarea" ? 1000 : 200));
    }
    out[field.name] = v;
  }
  // Cross-field rules.
  if (type === "overnight" && out.returnDate < out.leaveDate) throw httpError(400, "The return date must be on or after the leave date.");
  if (type === "car_rental" && out.endDate < out.startDate) throw httpError(400, "The end date must be on or after the start date.");
  return out;
}

function feeFor(type, item, payload) {
  if (!item) return 0;
  const fee = Number(item.fee || 0);
  if (item.fee_unit === "day" && type === "car_rental") {
    const days = Math.round((Date.parse(payload.endDate) - Date.parse(payload.startDate)) / 86400e3) + 1;
    return round2(fee * days);
  }
  if (item.fee_unit === "week" && payload.weeks) return round2(fee * payload.weeks);
  return round2(fee);
}

async function myRequests(personId, limit = 100) {
  return rest(`campus_requests?select=*&person_id=eq.${personId}&order=created_at.desc&limit=${limit}`);
}

export async function submitRequest({ person }, { type, catalogId, payload, clientKey }) {
  const def = REQUEST_TYPES[type];
  if (!def) throw httpError(400, "Unknown request type.");
  const key = clean(clientKey, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw httpError(400, "clientKey is missing.");

  let item = null;
  if (def.catalog) {
    if (!/^\d+$/.test(String(catalogId ?? ""))) throw httpError(400, "Choose an option first.");
    [item] = await rest(`campus_catalog?select=*&id=eq.${catalogId}&kind=eq.${def.catalog}&active=is.true&limit=1`);
    if (!item || (item.campus && campusKey(item.campus) !== campusKey(person.campus))) throw httpError(404, "That option is not available.");
    if (item.starts_at && Date.parse(item.starts_at) <= Date.now()) throw httpError(409, "This activity has already started.");
  }
  const data = validatePayload(type, payload, { item });

  const mine = await myRequests(person.id);
  const live = (t) => mine.filter((r) => r.type === t && ["submitted", "reviewing", "approved", "done"].includes(r.status));
  if (def.once && live(type).length && !mine.some((r) => r.client_key === key)) {
    throw httpError(409, `You already have a ${def.en.toLowerCase()} request. Cancel it first to send a new one.`);
  }
  if (def.needs && !mine.some((r) => r.type === def.needs && ["approved", "done"].includes(r.status))) {
    throw httpError(409, `First the office has to approve your ${REQUEST_TYPES[def.needs].en.toLowerCase()} request.`);
  }
  if (type === "activity") {
    if (mine.some((r) => r.catalog_id === item.id && ["submitted", "reviewing", "approved", "done"].includes(r.status) && r.client_key !== key)) {
      throw httpError(409, "You already signed up for this activity.");
    }
    if (item.capacity) {
      const taken = await rest(`campus_requests?select=id&catalog_id=eq.${item.id}&status=in.(submitted,reviewing,approved,done)&limit=${item.capacity + 1}`);
      if (taken.length >= item.capacity) throw httpError(409, "This activity is full.");
    }
  }
  if (type === "overnight") {
    const access = await rest(`student_access?select=perm_prohibited&student_uid=eq.${enc(String(person.uid || "").toUpperCase())}&limit=1`);
    if (access[0] && Number(access[0].perm_prohibited) === 1) {
      throw httpError(403, "Overnight leave is not allowed on your account right now. Please talk to the dormitory office.");
    }
  }
  if (item) {
    data.item = { id: item.id, title_en: item.title_en, title_ko: item.title_ko, fee: num(item.fee), feeUnit: item.fee_unit, startsAt: phDateTime(item.starts_at) };
  }

  const fee = feeFor(type, item, data);
  const row = await rest("rpc/campus_submit_request", {
    method: "POST",
    body: { p_person_id: person.id, p_type: type, p_catalog_id: item?.id ?? null, p_payload: data, p_fee: fee, p_client_key: key },
  });
  return { request: requestView(row) };
}

function requestView(r) {
  return {
    id: r.id, type: r.type, status: r.status, fee: num(r.fee), charged: r.charge_bank_id != null,
    payload: r.payload, staffNote: r.staff_note, created: phDateTime(r.created_at), updated: phDateTime(r.updated_at),
    handled: phDateTime(r.handled_at),
  };
}

export async function listRequests({ person }) {
  return { requests: (await myRequests(person.id, 200)).map(requestView) };
}

export async function cancelRequest({ person }, id) {
  const row = await rest("rpc/campus_cancel_request", { method: "POST", body: { p_id: Number(id), p_person_id: person.id } });
  return { request: requestView(row) };
}

// ---------- scores ----------

export async function scores({ person }) {
  const rows = await rest(`campus_scores?select=id,test,test_date,listening,reading,writing,speaking,overall,comment&studentid=eq.${enc(person.studentid)}&order=test_date.desc&limit=100`);
  return { scores: rows.map((r) => ({ ...r, listening: num(r.listening), reading: num(r.reading), writing: num(r.writing), speaking: num(r.speaking), overall: num(r.overall) })) };
}

// ======================================================================
// Staff side (routes wrap these with office login: access.mjs assertCanUseOffice)
// ======================================================================

// null = every campus; otherwise the campuses this account may handle.
// Admin accounts handle student requests of every campus (the CEO's account is an Admin @ Capital);
// campus Managers only their own campus. Office access itself is checked first (assertCanUseOffice).
export function staffCampuses(session, access) {
  if (session.position === "Admin") return null;
  return access.cafeCampuses.map(campusKey);
}

function assertStaffCampus(campuses, campus) {
  if (campuses && !campuses.includes(campusKey(campus))) throw httpError(403, "This request belongs to another campus.");
}

function campusInFilter(campuses) {
  if (!campuses) return [];
  const names = campuses.flatMap((c) => (c === "TARLAC" ? ["Tarlac", "Talrac", "TARLAC", "TALRAC"] : [c, c[0] + c.slice(1).toLowerCase()]));
  return [`campus=in.${enc(`(${[...new Set(names)].map((n) => q(n)).join(",")})`)}`];
}

export async function staffListRequests(campuses, { status, type, search, from, to }) {
  const filters = [...campusInFilter(campuses)];
  if (status === "open") filters.push("status=in.(submitted,reviewing,approved)");
  else if (status && status !== "all") filters.push(`status=eq.${enc(status)}`);
  if (type && REQUEST_TYPES[type]) filters.push(`type=eq.${type}`);
  if (search) {
    const s = clean(search, 60).replace(/[%*,()]/g, "");
    if (s) filters.push(`or=(name.ilike.*${enc(s)}*,studentid.ilike.*${enc(s)}*)`);
  }
  if (from && isDay(from)) filters.push(`created_at=gte.${enc(`${from}T00:00:00+08:00`)}`);
  if (to && isDay(to)) filters.push(`created_at=lte.${enc(`${to}T23:59:59+08:00`)}`);
  const rows = await rest(`campus_requests?select=*&${filters.join("&")}&order=created_at.desc&limit=500`);
  return { requests: rows.map((r) => ({ ...requestView(r), name: r.name, studentId: r.studentid, campus: r.campus, handledBy: r.handled_by })) };
}

export async function staffDecide(campuses, id, { status, note }, staffLoginId) {
  if (!["reviewing", "approved", "rejected", "done"].includes(status)) throw httpError(400, "Unknown status.");
  const [current] = await rest(`campus_requests?select=campus&id=eq.${Number(id)}&limit=1`);
  if (!current) throw httpError(404, "Request not found.");
  assertStaffCampus(campuses, current.campus);
  const row = await rest("rpc/campus_decide_request", {
    method: "POST", body: { p_id: Number(id), p_status: status, p_staff: staffLoginId, p_note: clean(note, 500) || null },
  });
  return { request: requestView(row) };
}

// ----- notices / catalog / bot FAQ: plain CRUD -----

const TABLES = {
  notices: { table: "campus_notices", fields: ["campus", "title_en", "title_ko", "body_en", "body_ko", "pinned", "published_at", "expires_at"], required: ["title_en", "body_en"], order: "pinned.desc,published_at.desc" },
  catalog: { table: "campus_catalog", fields: ["kind", "campus", "title_en", "title_ko", "detail_en", "detail_ko", "fee", "fee_unit", "starts_at", "capacity", "active", "sort"], required: ["kind", "title_en"], order: "kind.asc,sort.asc,id.asc" },
  faq: { table: "campus_bot_faq", fields: ["campus", "question", "answer", "keywords", "active", "sort"], required: ["question", "answer"], order: "sort.asc,id.asc" },
};

function pick(def, body, creating) {
  const row = {};
  for (const k of def.fields) {
    if (body[k] === undefined) continue;
    const v = body[k];
    row[k] = v === "" ? null : typeof v === "string" ? clean(v, 4000) : v;
  }
  if (creating) for (const k of def.required) if (!row[k]) throw httpError(400, `${k} is required.`);
  if (row.fee != null && !(Number(row.fee) >= 0)) throw httpError(400, "fee must be 0 or more.");
  return row;
}

export async function staffList(name, campuses) {
  const def = TABLES[name];
  const rows = await rest(`${def.table}?select=*&order=${def.order}&limit=500`);
  // Campus managers see items for every campus (null) and their own.
  return { rows: campuses ? rows.filter((r) => !r.campus || campuses.includes(campusKey(r.campus))) : rows };
}

export async function staffCreate(name, campuses, body, loginId) {
  const def = TABLES[name];
  const row = pick(def, body, true);
  if (campuses && !row.campus) row.campus = campuses[0][0] + campuses[0].slice(1).toLowerCase();
  if (row.campus) assertStaffCampus(campuses, row.campus);
  if (name === "notices") row.created_by = loginId;
  const [saved] = await rest(def.table, { method: "POST", body: row, headers: { Prefer: "return=representation" } });
  return { row: saved };
}

export async function staffUpdate(name, campuses, id, body) {
  const def = TABLES[name];
  const [current] = await rest(`${def.table}?select=campus&id=eq.${Number(id)}&limit=1`);
  if (!current) throw httpError(404, "Not found.");
  if (current.campus || campuses) assertStaffCampus(campuses, current.campus || "");
  const row = pick(def, body, false);
  if (row.campus) assertStaffCampus(campuses, row.campus);
  const [saved] = await rest(`${def.table}?id=eq.${Number(id)}`, { method: "PATCH", body: row, headers: { Prefer: "return=representation" } });
  return { row: saved };
}

export async function staffDelete(name, campuses, id) {
  const def = TABLES[name];
  const [current] = await rest(`${def.table}?select=campus&id=eq.${Number(id)}&limit=1`);
  if (!current) throw httpError(404, "Not found.");
  if (current.campus || campuses) assertStaffCampus(campuses, current.campus || "");
  await rest(`${def.table}?id=eq.${Number(id)}`, { method: "DELETE" });
  return { ok: true };
}

// ----- students: account status, one-time activation code, unfreeze -----

export async function staffStudents(campuses, { search }) {
  const s = clean(search, 60).replace(/[%*,()]/g, "");
  if (s.length < 2) throw httpError(400, "Type at least 2 letters of a name or student ID.");
  const filters = [`or=(name.ilike.*${enc(s)}*,studentid.ilike.*${enc(s)}*)`, ...campusInFilter(campuses)];
  const people = await rest(`person?select=${PERSON_COLS}&${filters.join("&")}&order=e_date.desc,id.desc&limit=40`);
  const accounts = await accountsFor(people.map((p) => p.id));
  const byId = new Map(accounts.map((a) => [a.person_id, a]));
  return {
    students: people.map((p) => {
      const a = byId.get(p.id);
      return {
        personId: p.id, name: p.name, studentId: p.studentid, campus: p.campus, endDate: p.e_date, released: isReleased(p),
        balance: num(p.totalmoney),
        account: a ? { hasPin: !!a.pin_hash, frozen: a.card_frozen, lastLogin: phDateTime(a.last_login_at), locked: !!(a.locked_until && Date.parse(a.locked_until) > Date.now()), codePending: !!(a.activation_hash && Date.parse(a.activation_expires) > Date.now()) } : null,
      };
    }),
  };
}

async function staffPerson(campuses, personId) {
  const person = await personById(personId);
  if (!person) throw httpError(404, "Student not found.");
  assertStaffCampus(campuses, person.campus);
  return person;
}

// Issues a one-time 6-digit code (valid 3 days) and clears the PIN: the student sets a new PIN with it.
export async function staffActivationCode(campuses, personId) {
  const person = await staffPerson(campuses, personId);
  if (isReleased(person)) throw httpError(409, "This card was released (graduated). Use the student's current record.");
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  const [existing] = await accountsFor([person.id]);
  await upsertAccount({
    person_id: person.id,
    pin_hash: null,
    activation_hash: sha256(code),
    activation_expires: new Date(Date.now() + ACTIVATION_TTL_MS).toISOString(),
    failed_count: 0,
    locked_until: null,
    token_version: (existing?.token_version || 0) + 1,
  });
  return { code, expires: phDateTime(new Date(Date.now() + ACTIVATION_TTL_MS).toISOString()), studentId: person.studentid, name: person.name };
}

export async function staffUnfreeze(campuses, personId) {
  const person = await staffPerson(campuses, personId);
  const [account] = await accountsFor([person.id]);
  if (!account) throw httpError(404, "This student has no app account.");
  await patchAccount(person.id, { card_frozen: false, frozen_at: null, failed_count: 0, locked_until: null });
  return { ok: true };
}

// ----- scores import: rows from a pasted CSV -----

export async function staffImportScores(rows, loginId) {
  if (!Array.isArray(rows) || !rows.length) throw httpError(400, "No rows to import.");
  if (rows.length > 2000) throw httpError(400, "Import at most 2,000 rows at a time.");
  const clean5 = (v) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 200) throw httpError(400, `Score "${v}" is not a number from 0 to 200.`);
    return Math.round(n * 10) / 10;
  };
  const out = rows.map((r, i) => {
    const test = String(r.test || "").trim().toUpperCase();
    const sid = clean(r.studentId ?? r.studentid, 40);
    const day = String(r.date ?? r.test_date ?? "").trim();
    if (!sid) throw httpError(400, `Row ${i + 1}: student ID is missing.`);
    if (test !== "IELTS" && test !== "TOEFL") throw httpError(400, `Row ${i + 1}: test must be IELTS or TOEFL.`);
    if (!isDay(day)) throw httpError(400, `Row ${i + 1}: date must be YYYY-MM-DD.`);
    return {
      studentid: sid, test, test_date: day,
      listening: clean5(r.listening), reading: clean5(r.reading), writing: clean5(r.writing), speaking: clean5(r.speaking), overall: clean5(r.overall),
      comment: clean(r.comment, 500) || null, created_by: loginId,
    };
  });
  const saved = await rest("campus_scores?on_conflict=studentid,test,test_date", {
    method: "POST", body: out, headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });
  const ids = [...new Set(out.map((r) => q(r.studentid)))].join(",");
  const known = await rest(`person?select=studentid&studentid=in.${enc(`(${ids})`)}`);
  const knownSet = new Set(known.map((p) => String(p.studentid).toUpperCase()));
  const unknown = [...new Set(out.filter((r) => !knownSet.has(r.studentid.toUpperCase())).map((r) => r.studentid))];
  return { saved: saved.length, unknownStudentIds: unknown };
}

export async function staffScores({ studentId }) {
  const sid = clean(studentId, 40);
  const filter = sid ? `&studentid=eq.${enc(sid)}` : "";
  return { scores: await rest(`campus_scores?select=*${filter}&order=test_date.desc,id.desc&limit=300`) };
}

// Used by the bot: a short summary of the student's own data.
export async function studentContext({ account, person }) {
  const [mine, sc, nt, held] = await Promise.all([
    myRequests(person.id, 15),
    rest(`campus_scores?select=test,test_date,overall&studentid=eq.${enc(person.studentid)}&order=test_date.desc&limit=3`),
    notices({ person }),
    pendingFees(person.id),
  ]);
  return {
    today: phToday(),
    name: person.name, campus: person.campus, courseEnd: person.e_date,
    balance: round2(person.totalmoney || 0), heldForPendingRequests: held, cardFrozen: account.card_frozen,
    requests: mine.map((r) => ({ id: r.id, type: REQUEST_TYPES[r.type]?.en || r.type, status: r.status, fee: num(r.fee), sent: phDateTime(r.created_at), staffNote: r.staff_note })),
    latestScores: sc,
    notices: nt.notices.slice(0, 8).map((n) => ({ title: n.title_en, body: n.body_en.slice(0, 600), published: n.published })),
  };
}
