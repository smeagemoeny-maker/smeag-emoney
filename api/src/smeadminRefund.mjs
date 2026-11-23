// Office "SME REFUND" tab: smeadmin refund requests -> e-money refund, matched by passport.
//
//   sync()      reads pending refunds from smeadmin (read-only, smeadmin.mjs) into smeadmin_refund,
//               looks up each student's passport on smeadmin and keeps only its HMAC hash + last 4.
//   list()      refunds with the linked e-money card (student_identity.person_id -> person).
//   pay()       one office transaction: DECREASE  Refund / <SMEADMIN_REFUND_ITEM>  amount,
//               client_key smeadmin-refund-<change_no> so the same request can never be paid twice.
//   findByPassport()  staff type a passport -> hash -> card + refunds.
//
// smeadmin itself is NOT updated: staff still set "환급완료(Refunded)" there by hand (phase 5 decides automation).
// Tables: api/migrations/supabase_smeadmin_refund.sql.
import { httpError } from "./repository.mjs";
import { rest } from "./supabaseRepository.mjs";
import { createOfficeTransaction } from "./backofficeSupabase.mjs";
import { normalizeUid } from "./db.mjs";
import {
  amountCurrency, checkDiff, createSmeadminClient, normalizePassport, parseAmount, parseRmbNote, passportHash, refundKind, sameName,
} from "./smeadmin.mjs";

const enc = encodeURIComponent;
const MAX_LIST_PAGES = 10;     // 15 rows per page on smeadmin
const MAX_RECHECK = 40;        // already-known open rows re-read per sync
const CONCURRENCY = 4;
const OPEN_RESULTS = new Set(["center", "account"]); // "센터/계좌 수납미처리": still to be paid out

function settings() {
  const tolerance = Number(process.env.SMEADMIN_TOLERANCE_PHP ?? 2);
  return {
    baseUrl: process.env.SMEADMIN_BASE_URL || "http://www.smeadmin.com/gnuboard4",
    loginId: process.env.SMEADMIN_LOGIN_ID,
    password: process.env.SMEADMIN_PASSWORD,
    secret: process.env.PASSPORT_HMAC_SECRET,
    tolerance: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 2,
    item: process.env.SMEADMIN_REFUND_ITEM || "Student allowance",
    // smeadmin still lists ~200 open refunds back to 2013: only requests applied in the last N days are read.
    days: Math.min(Math.max(Number(process.env.SMEADMIN_SYNC_DAYS || 45) || 45, 1), 365),
  };
}

// A missing table means the migration has not been run yet: say so instead of a bare 500.
async function db(path, opts) {
  try {
    return await rest(path, opts);
  } catch (e) {
    if (/smeadmin_|student_identity/.test(String(e.message)) && /does not exist|Could not find|schema cache/i.test(String(e.message))) {
      throw httpError(501, "Run api/migrations/supabase_smeadmin_refund.sql in the Supabase SQL Editor first.");
    }
    throw e;
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { ok: true, value: await fn(items[i]) }; } catch (error) { out[i] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

function last4(p) { return p.slice(-4); }
// "2026-11-19(14:53:12)" -> "2026-11-19" ("" when smeadmin shows something else, so it is skipped)
function appliedDay(s) { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || "").trim()); return m ? m[1] : ""; }

// Local status from what smeadmin says + what we already did.
export function nextStatus(prev, rec, diff, tolerance) {
  const paid = prev && (prev.status === "paid" || prev.status === "paid_then_cancelled");
  const cancelled = rec.process === "cancel" || rec.result === "cancel";
  if (paid) return cancelled ? "paid_then_cancelled" : "paid";
  if (cancelled) return "cancelled";
  if (rec.result && !OPEN_RESULTS.has(rec.result)) return "closed";   // completed in smeadmin without this screen
  if (refundKind(rec.note) !== "allowance") return "other";             // not paid from the e-money card
  if (amountCurrency(rec.amountText) !== "PHP") return "mismatch";
  if (parseAmount(rec.amountText) == null) return "mismatch";
  if (diff != null && Math.abs(diff) > tolerance) return "mismatch";
  return "pending";
}

// ---------- sync ----------

async function findPassport(client, rec, cache) {
  const key = `${rec.name}|${rec.startDate}`;
  if (cache.has(key)) return cache.get(key);
  let found = null;
  const students = await client.searchStudents(rec.name);
  const same = students.filter((s) => sameName(s.name, rec.name) || sameName(s.englishName, rec.name));
  // The change form shows the period of the registration it belongs to: pick that registration.
  const exact = same.filter((s) => rec.startDate && s.startDate === rec.startDate);
  const pick = exact.length === 1 ? exact[0] : same.length === 1 ? same[0] : null;
  if (pick) {
    const d = await client.studentDetail(pick.studentNo);
    const norm = normalizePassport(d.passport);
    if (norm) found = { studentNo: pick.studentNo, passport: norm, birthDate: /^\d{4}-\d{2}-\d{2}$/.test(d.birthDate) ? d.birthDate : null };
  }
  cache.set(key, found);
  return found;
}

export async function sync(staffLoginId) {
  const cfg = settings();
  const client = createSmeadminClient(cfg);
  const startedAt = new Date().toISOString();
  const report = { listed: 0, read: 0, created: 0, updated: 0, noPassport: 0, errors: [] };
  try {
    await client.login();

    // 1) recent refund requests smeadmin still shows as not paid out (center / account)
    const cutoff = new Date(Date.now() + 8 * 3600000 - cfg.days * 86400000).toISOString().slice(0, 10);
    const listed = new Map();
    for (const result of ["center", "account"]) {
      for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const { rows, lastPage } = await client.changeList({ result, page });
        for (const r of rows) if (r.isRefund && appliedDay(r.appliedAt) >= cutoff) listed.set(r.changeNo, r);
        // smeadmin lists newest first: once a whole page is older than the window, the rest is too.
        if (page >= lastPage || !rows.length || rows.every((r) => appliedDay(r.appliedAt) < cutoff)) break;
      }
    }
    report.listed = listed.size;

    // 2) rows we already know that are still open on our side (they may have been cancelled/completed since)
    // (paid rows are watched for a later cancel for twice the window, then left alone)
    const watchFrom = new Date(Date.now() - cfg.days * 2 * 86400000).toISOString();
    const known = await db(`smeadmin_refund?select=*&status=in.(pending,mismatch,paid)&first_seen_at=gte.${enc(watchFrom)}&order=change_no.desc&limit=500`);
    const knownBy = new Map(known.map((r) => [Number(r.change_no), r]));
    const all = await db(`smeadmin_refund?select=change_no,status,passport_hash,sme_student_no&change_no=in.(${[...listed.keys(), 0].join(",")})`);
    for (const r of all) knownBy.set(Number(r.change_no), { ...knownBy.get(Number(r.change_no)), ...r });

    const todo = [...listed.keys()];
    const recheck = known.map((r) => Number(r.change_no)).filter((n) => !listed.has(n)).slice(0, MAX_RECHECK);
    const numbers = [...new Set([...todo, ...recheck])];

    // 3) read each request (amount, note, status) and find the passport for new ones
    const passportCache = new Map();
    const results = await pool(numbers, CONCURRENCY, async (no) => {
      const rec = await client.changeRecord(no);
      const prev = knownBy.get(no);
      const amount = parseAmount(rec.amountText);
      const { rmb, rate } = parseRmbNote(rec.note);
      const diff = checkDiff(amount, rmb, rate);
      const row = {
        change_no: no, name_en: rec.name, agency: listed.get(no)?.agency || prev?.agency || rec.agencyId, campus: rec.campus,
        applied_at: rec.appliedAt, amount_text: rec.amountText, amount_php: amount, note: rec.note, rmb, rate, check_diff: diff,
        kind: refundKind(rec.note), currency: amountCurrency(rec.amountText),
        sme_process: rec.process, sme_result: rec.result, status: nextStatus(prev, rec, diff, cfg.tolerance),
        synced_at: new Date().toISOString(),
      };
      // Passport lookup (2 more smeadmin pages) only for requests that can still be paid here.
      if (!prev?.passport_hash && (row.status === "pending" || row.status === "mismatch")) {
        const found = await findPassport(client, rec, passportCache);
        if (found) {
          const hash = passportHash(found.passport, cfg.secret);
          row.passport_hash = hash;
          row.passport_last4 = last4(found.passport);
          row.sme_student_no = found.studentNo;
          await db("student_identity?on_conflict=passport_hash", {
            method: "POST",
            headers: { prefer: "resolution=ignore-duplicates" },
            body: { passport_hash: hash, passport_last4: last4(found.passport), name_en: rec.name, birth_date: found.birthDate },
          });
        } else {
          report.noPassport++;
        }
      }
      return { row, isNew: !prev };
    });

    const rows = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.ok) { report.errors.push(`#${numbers[i]}: ${r.error.message}`); continue; }
      rows.push(r.value.row);
      if (r.value.isNew) report.created++; else report.updated++;
    }
    report.read = rows.length;
    // Upsert only the smeadmin-side columns (paid_* are never sent from here). Group by column set:
    // PostgREST bulk upserts need the same keys on every row.
    const groups = new Map();
    for (const row of rows) {
      const k = Object.keys(row).sort().join(",");
      groups.set(k, [...(groups.get(k) || []), row]);
    }
    for (const group of groups.values()) {
      await db("smeadmin_refund?on_conflict=change_no", {
        method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: group });
    }

    await saveState({ last_run_at: startedAt, last_ok_at: new Date().toISOString(),
      last_error: report.errors.length ? report.errors.slice(0, 5).join(" | ") : null, last_count: rows.length });
    return { ...report, by: staffLoginId };
  } catch (e) {
    await saveState({ last_run_at: startedAt, last_error: String(e.message).slice(0, 500) }).catch(() => {});
    throw e;
  } finally {
    await client.logout();
  }
}

async function saveState(patch) {
  await db("smeadmin_sync_state?id=eq.1", { method: "PATCH", body: patch });
}

// ---------- read ----------

function campusAllowed(access, campus) {
  if (!access || access.cafeCampuses.length >= 3) return true; // Admin with every campus
  return access.cafeCampuses.some((c) => c.toUpperCase() === String(campus || "").toUpperCase());
}

async function attachCards(rows) {
  const hashes = [...new Set(rows.map((r) => r.passport_hash).filter(Boolean))];
  const ids = hashes.length
    ? await db(`student_identity?select=passport_hash,person_id,linked_by,linked_at&passport_hash=in.(${hashes.join(",")})`)
    : [];
  const personIds = [...new Set(ids.map((i) => i.person_id).filter(Boolean))];
  const people = personIds.length
    ? await rest(`person?select=id,uid,name,campus,totalmoney,s_date,e_date&id=in.(${personIds.join(",")})`)
    : [];
  const personById = new Map(people.map((p) => [p.id, p]));
  const identityBy = new Map(ids.map((i) => [i.passport_hash, i]));
  return rows.map((r) => {
    const ident = r.passport_hash ? identityBy.get(r.passport_hash) : null;
    const p = ident?.person_id ? personById.get(ident.person_id) : null;
    return {
      changeNo: r.change_no, studentNo: r.sme_student_no, name: r.name_en, agency: r.agency, campus: r.campus,
      appliedAt: r.applied_at, amountText: r.amount_text, amount: r.amount_php == null ? null : Number(r.amount_php),
      note: r.note, rmb: r.rmb == null ? null : Number(r.rmb), rate: r.rate == null ? null : Number(r.rate),
      checkDiff: r.check_diff == null ? null : Number(r.check_diff), smeProcess: r.sme_process, smeResult: r.sme_result,
      kind: r.kind, currency: r.currency,
      status: r.status, passportLast4: r.passport_last4 || null, hasPassport: !!r.passport_hash,
      paidAt: r.paid_at, paidBy: r.paid_by, paidUid: r.paid_uid,
      card: p ? { personId: p.id, uid: p.uid, name: p.name, campus: p.campus, balance: Number(p.totalmoney || 0),
        startDate: p.s_date, endDate: p.e_date, nameMatches: sameName(p.name, r.name_en) } : null,
    };
  });
}

export async function list({ status, days } = {}, access) {
  const filters = ["select=*", "order=change_no.desc", "limit=500"];
  if (status && status !== "all") {
    const allowed = ["pending", "mismatch", "paid", "cancelled", "paid_then_cancelled", "closed", "other"];
    const wanted = String(status).split(",").filter((s) => allowed.includes(s));
    if (!wanted.length) throw httpError(400, "Unknown status.");
    filters.push(`status=in.(${wanted.join(",")})`);
  }
  const d = Number(days || 60);
  filters.push(`first_seen_at=gte.${enc(new Date(Date.now() - Math.min(Math.max(d, 1), 400) * 86400000).toISOString())}`);
  const rows = (await db(`smeadmin_refund?${filters.join("&")}`)).filter((r) => campusAllowed(access, r.campus));
  const state = (await db("smeadmin_sync_state?select=*&id=eq.1"))[0] || null;
  return {
    refunds: await attachCards(rows),
    sync: state ? { lastRunAt: state.last_run_at, lastOkAt: state.last_ok_at, lastError: state.last_error, lastCount: state.last_count } : null,
    tolerance: settings().tolerance,
    item: settings().item,
  };
}

export async function findByPassport(passport, access) {
  const norm = normalizePassport(passport);
  if (!norm) throw httpError(400, "Passport number: 6-12 letters or digits.");
  const hash = passportHash(norm, settings().secret);
  const rows = (await db(`smeadmin_refund?select=*&passport_hash=eq.${hash}&order=change_no.desc&limit=50`))
    .filter((r) => campusAllowed(access, r.campus));
  const ident = (await db(`student_identity?select=*&passport_hash=eq.${hash}`))[0] || null;
  let card = null;
  if (ident?.person_id) {
    const p = (await rest(`person?select=id,uid,name,campus,totalmoney,s_date,e_date&id=eq.${ident.person_id}`))[0];
    if (p) card = { personId: p.id, uid: p.uid, name: p.name, campus: p.campus, balance: Number(p.totalmoney || 0), startDate: p.s_date, endDate: p.e_date };
  }
  return { known: !!ident, passportLast4: last4(norm), name: ident?.name_en || null, card, refunds: await attachCards(rows) };
}

// ---------- write ----------

async function personByUid(uid) {
  const u = normalizeUid(uid);
  if (!u) throw httpError(400, "Tap the student's card (UID).");
  const p = (await rest(`person?select=id,uid,name,campus,totalmoney&uid=eq.${enc(u)}&limit=1`))[0];
  if (!p) throw httpError(404, "No e-money card with this UID.");
  if (/^g/i.test(p.uid)) throw httpError(409, "This card was released (Default). Use the student's current card.");
  return p;
}

async function loadRefund(changeNo, access) {
  const no = Number(changeNo);
  if (!Number.isInteger(no) || no <= 0) throw httpError(400, "Invalid request no.");
  const r = (await db(`smeadmin_refund?select=*&change_no=eq.${no}`))[0];
  if (!r) throw httpError(404, "Refund request not found. Press SYNC first.");
  if (!campusAllowed(access, r.campus)) throw httpError(403, `This account cannot handle ${r.campus} refunds.`);
  return r;
}

// Link the passport of a refund request to an e-money card. A different name needs confirmName: true.
export async function linkCard(changeNo, { uid, confirmName } = {}, staffLoginId, access) {
  const r = await loadRefund(changeNo, access);
  if (!r.passport_hash) throw httpError(409, "smeadmin has no passport for this student yet, so the card cannot be linked. Check the student's PASSPORT NUMBER in smeadmin, then SYNC.");
  const p = await personByUid(uid);
  if (!sameName(p.name, r.name_en) && confirmName !== true) {
    throw httpError(409, `NAME_MISMATCH: card owner "${p.name}" vs smeadmin "${r.name_en}".`);
  }
  const ident = (await db(`student_identity?select=passport_hash,person_id&passport_hash=eq.${r.passport_hash}`))[0];
  if (ident?.person_id && ident.person_id !== p.id && confirmName !== true) {
    throw httpError(409, "CARD_CHANGE: this passport is already linked to another card.");
  }
  await db(`student_identity?passport_hash=eq.${r.passport_hash}`, {
    method: "PATCH", body: { person_id: p.id, linked_by: staffLoginId, linked_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
  return (await attachCards([r]))[0];
}

export async function pay(changeNo, { uid } = {}, staffLoginId, access) {
  const cfg = settings();
  const r = await loadRefund(changeNo, access);
  if (r.status === "paid" || r.status === "paid_then_cancelled") throw httpError(409, `Already paid on ${r.paid_at} by ${r.paid_by}.`);
  if (r.status === "mismatch") throw httpError(409, r.currency && r.currency !== "PHP"
    ? `The amount is in ${r.currency}, not pesos. Fix it in smeadmin, then SYNC.`
    : "The amount does not match the RMB note. Fix it in smeadmin, then SYNC.");
  if (r.status === "other") throw httpError(409, "This refund is not a student allowance; it is not paid from the e-money card.");
  if (r.status !== "pending") throw httpError(409, `This request is ${r.status} in smeadmin.`);
  const amount = Number(r.amount_php);
  if (!(amount > 0)) throw httpError(409, "No refund amount.");
  if (!r.passport_hash) throw httpError(409, "No passport for this student: link the card first.");
  const ident = (await db(`student_identity?select=person_id&passport_hash=eq.${r.passport_hash}`))[0];
  if (!ident?.person_id) throw httpError(409, "Link the student's card first (tap the card).");
  const p = (await rest(`person?select=id,uid,name&id=eq.${ident.person_id}`))[0];
  if (!p) throw httpError(409, "The linked card no longer exists. Link the card again.");
  // The tapped card must be the linked one: protects against paying from the wrong student's card.
  if (uid && normalizeUid(uid) !== normalizeUid(p.uid)) throw httpError(409, "The tapped card is not this student's linked card.");

  const txn = await createOfficeTransaction({
    uid: p.uid,
    lines: [{ type: "DECREASE", mMenu: "Refund", sMenu: cfg.item, unitPrice: amount, qty: 1 }],
    clientKey: `smeadmin-refund-${r.change_no}`,
  }, staffLoginId);

  await db(`smeadmin_refund?change_no=eq.${r.change_no}`, {
    method: "PATCH",
    body: { status: "paid", paid_txn_id: txn.id, paid_uid: p.uid, paid_by: staffLoginId, paid_at: new Date().toISOString() },
  });
  return { transaction: txn, refund: (await attachCards([{ ...r, status: "paid", paid_uid: p.uid, paid_by: staffLoginId }]))[0] };
}
