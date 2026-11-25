// Office OUTING tab: students going out (OUTING, same day) or staying out overnight (OVERNIGHT), and coming back.
//
//   byUid()        tapped card -> the student, the open outing (if out now) and the last few outings
//   list()         view "out" (everyone still out), "day" (one PH day + everyone still out) or "range"
//   checkOut()     new outing (one open outing per student; client_key = no double submit)
//   checkIn()      the student is back (returned_at)
//   undoReturn()   a return recorded by mistake (wrong card tapped) -> out again
//   voidOuting()   a wrong outing is voided, never deleted
//
// Times are timestamptz; "today" is the Philippine day (UTC+8). Table: api/migrations/supabase_student_outing.sql.
import { httpError } from "./repository.mjs";
import { rest } from "./supabaseRepository.mjs";
import { normalizeUid } from "./db.mjs";

const enc = encodeURIComponent;
const KINDS = ["OUTING", "OVERNIGHT"];
const COLS = "id,person_id,uid,student_id,student_name,campus,kind,destination,memo,out_at,expected_return_at,out_by,returned_at,returned_by,voided_at,voided_by,void_reason";
const PH_OFFSET_MS = 8 * 3600 * 1000;
const MAX_HOURS = 24 * 14; // an overnight stay longer than 2 weeks is a typo

async function db(path, opts) {
  try {
    return await rest(path, opts);
  } catch (e) {
    const m = String(e.message);
    if (/student_outing/.test(m) && /does not exist|Could not find|schema cache/i.test(m)) {
      throw httpError(501, "Run api/migrations/supabase_student_outing.sql in the Supabase SQL Editor first.");
    }
    if (/student_outing_one_open|duplicate key/i.test(m)) throw httpError(409, "This student is already out.");
    throw e;
  }
}

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

// "YYYY-MM-DD" (Philippine day) -> [start, end) as ISO strings
export function phDayRange(day) {
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : phToday();
  const start = new Date(`${d}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) throw httpError(400, "Date must be YYYY-MM-DD.");
  return { day: d, start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

export function phToday(now = Date.now()) {
  return new Date(now + PH_OFFSET_MS).toISOString().slice(0, 10);
}

function status(r, now = Date.now()) {
  if (r.voided_at) return "voided";
  if (r.returned_at) return Date.parse(r.returned_at) > Date.parse(r.expected_return_at) ? "returned_late" : "returned";
  return now > Date.parse(r.expected_return_at) ? "late" : "out";
}

// OVERNIGHT check points: 12:00 and 24:00 of the (Philippine) day after the student left.
export function overnightDeadlines(outAt) {
  const t = Date.parse(outAt);
  const nextDay = Date.parse(phDayRange(new Date(t + PH_OFFSET_MS).toISOString().slice(0, 10)).end);
  return { noon: new Date(nextDay + 12 * 3600000).toISOString(), midnight: new Date(nextDay + 24 * 3600000).toISOString() };
}

// 0 = fine, 1 = not back by next day 12:00, 2 = not back by next day 24:00 (by the return time, or now if still out)
function overnightStage(r, now) {
  if (r.kind !== "OVERNIGHT" || r.voided_at) return 0;
  const d = overnightDeadlines(r.out_at);
  const t = r.returned_at ? Date.parse(r.returned_at) : now;
  return t > Date.parse(d.midnight) ? 2 : t > Date.parse(d.noon) ? 1 : 0;
}

function map(r, now = Date.now()) {
  const st = status(r, now);
  const end = r.returned_at ? Date.parse(r.returned_at) : now;
  const lateMin = Math.max(0, Math.round((end - Date.parse(r.expected_return_at)) / 60000));
  const dl = r.kind === "OVERNIGHT" ? overnightDeadlines(r.out_at) : null;
  return {
    nextNoon: dl ? dl.noon : null, nextMidnight: dl ? dl.midnight : null, overnightStage: overnightStage(r, now),
    id: Number(r.id), personId: r.person_id, uid: r.uid, studentId: r.student_id, studentName: r.student_name, campus: r.campus,
    kind: r.kind, destination: r.destination, memo: r.memo, outAt: r.out_at, expectedReturnAt: r.expected_return_at, outBy: r.out_by,
    returnedAt: r.returned_at, returnedBy: r.returned_by, voidedAt: r.voided_at, voidedBy: r.voided_by, voidReason: r.void_reason,
    status: st, lateMinutes: st === "late" || st === "returned_late" ? lateMin : 0,
  };
}

async function loadOuting(id, access) {
  const r = (await db(`student_outing?select=${COLS}&id=eq.${toId(id)}`))[0];
  if (!r) throw httpError(404, "Outing record not found.");
  if (!campusAllowed(access, r.campus)) throw httpError(403, `This account cannot handle ${r.campus} students.`);
  return r;
}

async function openOutingOf(personId) {
  return (await db(`student_outing?select=${COLS}&person_id=eq.${personId}&returned_at=is.null&voided_at=is.null&order=id.desc&limit=1`))[0] || null;
}

async function personByUid(uid) {
  const u = normalizeUid(uid);
  if (!u) throw httpError(400, "Tap a card or type the UID.");
  const p = (await rest(`person?select=id,uid,studentid,name,campus,s_date,e_date&uid=eq.${enc(u)}&order=id.asc&limit=1`))[0];
  if (!p) throw httpError(404, `This card is not registered.\nUID: ${u}`);
  return p;
}

function mapPerson(p) {
  return { id: p.id, uid: p.uid, studentId: p.studentid, name: p.name, campus: p.campus, startDate: p.s_date, endDate: p.e_date };
}

// ---------- read ----------

export async function byUid(uid, access) {
  const p = await personByUid(uid);
  if (!campusAllowed(access, p.campus)) throw httpError(403, `${p.name} is a ${p.campus} student. This account cannot handle that campus.`);
  const recent = await db(`student_outing?select=${COLS}&person_id=eq.${p.id}&voided_at=is.null&order=id.desc&limit=10`);
  const open = recent.find((r) => !r.returned_at) || null;
  return { person: mapPerson(p), open: open ? map(open) : null, recent: recent.map((r) => map(r)) };
}

// view: out | out_outing | out_overnight | overnight_noon | overnight_midnight | day | range
export async function list({ view, day, from, to, campus } = {}, access) {
  const OPEN_VIEWS = ["out", "out_outing", "out_overnight", "overnight_noon", "overnight_midnight"];
  const now = Date.now();
  const f = [`select=${COLS}`, "voided_at=is.null", "limit=1000"];
  let range = null;
  if (view === "range") {
    const a = phDayRange(from), b = phDayRange(to || from);
    if (a.start > b.start) throw httpError(400, "From date is after To date.");
    f.push(`out_at=gte.${enc(a.start)}`, `out_at=lt.${enc(b.end)}`, "order=out_at.desc");
  } else if (OPEN_VIEWS.includes(view)) {
    f.push("returned_at=is.null", "order=out_at.asc");
    if (view === "out_outing") f.push("kind=eq.OUTING");
    else if (view !== "out") f.push("kind=eq.OVERNIGHT");
  } else {
    range = phDayRange(day);
    // left that day, came back that day, or still out now
    f.push(`or=(and(out_at.gte.${range.start},out_at.lt.${range.end}),and(returned_at.gte.${range.start},returned_at.lt.${range.end}),returned_at.is.null)`,
      "order=out_at.desc");
  }
  if (campus && campus !== "All") f.push(`campus=ilike.${enc(String(campus).replace(/[*,()]/g, ""))}`);
  const rows = (await db(`student_outing?${f.join("&")}`)).filter((r) => campusAllowed(access, r.campus)).map((r) => map(r, now))
    .filter((r) => view === "overnight_noon" ? r.overnightStage >= 1 : view === "overnight_midnight" ? r.overnightStage === 2 : true);

  // counters: always about "now" (+ today's PH day), whatever the list shows
  const today = phDayRange();
  const openRows = view === "out" ? rows : (await db(`student_outing?select=${COLS}&voided_at=is.null&returned_at=is.null&limit=1000`))
    .filter((r) => campusAllowed(access, r.campus) && (!campus || campus === "All" || String(r.campus).toUpperCase() === String(campus).toUpperCase()))
    .map((r) => map(r, now));
  const backToday = (await db(`student_outing?select=id,campus,returned_at&voided_at=is.null&returned_at=gte.${enc(today.start)}&returned_at=lt.${enc(today.end)}&limit=1000`))
    .filter((r) => campusAllowed(access, r.campus) && (!campus || campus === "All" || String(r.campus).toUpperCase() === String(campus).toUpperCase()));
  const summary = {
    outing: openRows.filter((r) => r.kind === "OUTING").length,
    overnight: openRows.filter((r) => r.kind === "OVERNIGHT").length,
    late: openRows.filter((r) => r.status === "late").length,
    outingLate: openRows.filter((r) => r.kind === "OUTING" && r.status === "late").length,
    overnightNoon: openRows.filter((r) => r.overnightStage >= 1).length,
    overnightMidnight: openRows.filter((r) => r.overnightStage === 2).length,
    returnedToday: backToday.length,
  };
  return { outings: rows, summary, day: range ? range.day : null, now: new Date(now).toISOString() };
}

// ---------- write ----------

export async function checkOut(body = {}, staffLoginId, access) {
  const clientKey = text(body.clientKey, 80);
  if (clientKey) {
    const dup = (await db(`student_outing?select=${COLS}&client_key=eq.${enc(clientKey)}`))[0];
    if (dup) return { outing: map(dup), repeated: true };
  }
  const p = body.personId
    ? (await rest(`person?select=id,uid,studentid,name,campus,s_date,e_date&id=eq.${toId(body.personId, "personId")}`))[0]
    : await personByUid(body.uid);
  if (!p) throw httpError(404, "Student not found.");
  if (!campusAllowed(access, p.campus)) throw httpError(403, `This account cannot handle ${p.campus} students.`);
  if (!KINDS.includes(body.kind)) throw httpError(400, "Choose OUTING or OVERNIGHT.");

  const now = Date.now();
  const expected = Date.parse(body.expectedReturnAt);
  if (!Number.isFinite(expected)) throw httpError(400, "Set the expected return time.");
  if (expected <= now) throw httpError(400, "The expected return time is already past.");
  if (expected - now > MAX_HOURS * 3600000) throw httpError(400, "The expected return is more than 14 days away. Check the date.");

  const open = await openOutingOf(p.id);
  if (open) throw httpError(409, `${p.name} is already out (${open.kind}) since ${open.out_at}. Record the return first.`);

  const [saved] = await db(`student_outing?select=${COLS}`, {
    method: "POST", headers: { prefer: "return=representation" },
    body: {
      person_id: p.id, uid: p.uid, student_id: p.studentid, student_name: p.name, campus: p.campus, kind: body.kind,
      destination: text(body.destination, 120), memo: text(body.memo, 300), out_at: new Date(now).toISOString(),
      expected_return_at: new Date(expected).toISOString(), out_by: staffLoginId, client_key: clientKey,
    },
  });
  return { outing: map(saved), repeated: false };
}

export async function checkIn(id, staffLoginId, access) {
  const r = await loadOuting(id, access);
  if (r.voided_at) throw httpError(409, "This outing was voided.");
  if (r.returned_at) return { outing: map(r), repeated: true };
  const [saved] = await db(`student_outing?id=eq.${r.id}&returned_at=is.null&select=${COLS}`, {
    method: "PATCH", headers: { prefer: "return=representation" },
    body: { returned_at: new Date().toISOString(), returned_by: staffLoginId },
  });
  return { outing: map(saved || (await loadOuting(r.id, access))), repeated: !saved };
}

export async function undoReturn(id, staffLoginId, access) {
  const r = await loadOuting(id, access);
  if (r.voided_at) throw httpError(409, "This outing was voided.");
  if (!r.returned_at) return { outing: map(r) };
  const open = await openOutingOf(r.person_id);
  if (open) throw httpError(409, "The student already has a newer open outing.");
  const memo = [r.memo, `return ${r.returned_at} by ${r.returned_by} undone by ${staffLoginId}`].filter(Boolean).join(" / ").slice(0, 300);
  await db(`student_outing?id=eq.${r.id}`, { method: "PATCH", body: { returned_at: null, returned_by: null, memo } });
  return { outing: map(await loadOuting(r.id, access)) };
}

export async function voidOuting(id, body = {}, staffLoginId, access) {
  const r = await loadOuting(id, access);
  if (r.voided_at) throw httpError(409, `Already voided by ${r.voided_by}.`);
  const reason = text(body.reason, 200);
  if (!reason) throw httpError(400, "Write why this record is voided.");
  await db(`student_outing?id=eq.${r.id}&voided_at=is.null`, {
    method: "PATCH", body: { voided_at: new Date().toISOString(), voided_by: staffLoginId, void_reason: reason },
  });
  return { outing: map(await loadOuting(r.id, access)) };
}
