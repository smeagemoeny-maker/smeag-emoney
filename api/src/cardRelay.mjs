// Phone as the PC's card reader: a PC (with a barcode scanner, no NFC reader) pairs with an Android phone,
// and every card tapped on the phone shows up on the PC as if it was tapped there.
//
//   create(by, campus)        PC: new pairing -> { code (4 digits, shown on the PC), key (PC's secret) }
//   poll(code, key, after)    PC: long-poll (up to ~25 s) until tap_seq > after or the phone joins/leaves
//   join(code, by)            phone: attach to the pairing (logged-in staff only)
//   tap(code, uid, by)        phone: a card was read -> tap_seq + 1
//   close(code, key)          PC: end the pairing
//   createKiosk()             My Purchases screen (student/, no login): same pairing, created_by KIOSK_BY
//
// Table: api/migrations/supabase_card_relay.sql. The phone side (join / tap) always needs a staff login
// (app.mjs). The PC side needs one too, except on the My Purchases screen: there the pc_key alone opens
// poll / close, and the card UID it receives is what that screen already takes from any card reader.
import crypto from "node:crypto";
import { httpError } from "./repository.mjs";
import { rest } from "./supabaseRepository.mjs";
import { normalizeUid } from "./db.mjs";

const enc = encodeURIComponent;
const TTL_MS = 12 * 3600 * 1000;       // a pairing lasts one working day
const POLL_MS = 25 * 1000;             // one PC request waits at most this long
const POLL_STEP_MS = 350;
const PHONE_ALIVE_MS = 70 * 1000;      // the phone pings every 30 s while it is on the reader screen
const COLS = "code,pc_key,created_by,campus,expires_at,phone_by,phone_seen_at,tap_seq,tap_uid,tap_at";

async function db(path, opts) {
  try {
    return await rest(path, opts);
  } catch (e) {
    const m = String(e.message);
    if (/card_relay/.test(m) && /does not exist|Could not find|schema cache/i.test(m)) {
      throw httpError(501, "Run api/migrations/supabase_card_relay.sql in the Supabase SQL Editor first.");
    }
    throw e;
  }
}

function cleanCode(code) {
  const c = String(code ?? "").trim();
  if (!/^\d{4}$/.test(c)) throw httpError(400, "The pairing code is 4 digits.");
  return c;
}

async function load(code) {
  const rows = await db(`card_relay?code=eq.${enc(code)}&select=${COLS}`);
  const r = rows?.[0];
  if (!r || new Date(r.expires_at).getTime() < Date.now()) throw httpError(404, `Pairing code ${code} is not open. Check the code on the PC.`);
  return r;
}

function sameKey(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function phoneAlive(r) {
  return !!(r.phone_by && r.phone_seen_at && Date.now() - new Date(r.phone_seen_at).getTime() < PHONE_ALIVE_MS);
}

function view(r) {
  return { seq: r.tap_seq, uid: r.tap_uid, tapAt: r.tap_at, phone: phoneAlive(r) ? r.phone_by : null, expiresAt: r.expires_at };
}

export async function create(by, campus) {
  await db(`card_relay?expires_at=lt.${enc(new Date().toISOString())}`, { method: "DELETE" });
  const key = crypto.randomBytes(24).toString("base64url");
  for (let i = 0; i < 8; i++) {
    const code = String(crypto.randomInt(0, 10000)).padStart(4, "0");
    try {
      await db("card_relay", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: { code, pc_key: key, created_by: by || null, campus: campus || null, expires_at: new Date(Date.now() + TTL_MS).toISOString() },
      });
      return { code, key, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
    } catch (e) {
      if (!/duplicate key|card_relay_pkey/i.test(String(e.message))) throw e;   // code in use: try another
    }
  }
  throw httpError(503, "No free pairing code. Try again.");
}

// My Purchases (student kiosk, no staff login on that PC). Capped so an anonymous caller cannot use up
// the 4-digit codes the staff screens need.
export const KIOSK_BY = "My Purchases";
const KIOSK_MAX_OPEN = 30;
export async function createKiosk() {
  const open = await db(`card_relay?created_by=eq.${enc(KIOSK_BY)}&expires_at=gt.${enc(new Date().toISOString())}&select=code`);
  if ((open?.length || 0) >= KIOSK_MAX_OPEN) throw httpError(429, "Too many My Purchases screens are paired right now. Try again later.");
  return create(KIOSK_BY, KIOSK_BY);
}

// Returns as soon as there is a tap newer than `after`, the phone joined/left, or after ~25 s.
export async function poll(code, key, after, phoneWas) {
  code = cleanCode(code);
  const since = Number.isInteger(Number(after)) ? Number(after) : 0;
  const deadline = Date.now() + POLL_MS;
  for (;;) {
    const r = await load(code);
    if (!sameKey(r.pc_key, key)) throw httpError(403, "This pairing belongs to another PC.");
    const v = view(r);
    if (v.seq > since || (phoneWas != null && (v.phone || "") !== phoneWas) || Date.now() >= deadline) return v;
    await new Promise((ok) => setTimeout(ok, POLL_STEP_MS));
  }
}

export async function join(code, by) {
  code = cleanCode(code);
  const r = await load(code);
  await db(`card_relay?code=eq.${enc(code)}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: { phone_by: by || "phone", phone_seen_at: new Date().toISOString() },
  });
  return { code, campus: r.campus, pcBy: r.created_by, expiresAt: r.expires_at };
}

export async function tap(code, uid, by) {
  code = cleanCode(code);
  const u = normalizeUid(uid);
  if (!u || !/^[0-9a-f]{4,32}$/.test(u)) throw httpError(400, "Invalid card UID.");
  // tap_seq + 1 with a check on the old value, so two quick taps never share a number.
  for (let i = 0; i < 5; i++) {
    const r = await load(code);
    const rows = await db(`card_relay?code=eq.${enc(code)}&tap_seq=eq.${r.tap_seq}`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: { tap_seq: r.tap_seq + 1, tap_uid: u, tap_at: new Date().toISOString(), phone_by: by || r.phone_by, phone_seen_at: new Date().toISOString() },
    });
    if (rows?.length) return { ok: true, seq: r.tap_seq + 1, pcBy: r.created_by };
  }
  throw httpError(409, "Too many taps at once. Tap again.");
}

export async function close(code, key) {
  code = cleanCode(code);
  const rows = await db(`card_relay?code=eq.${enc(code)}&select=pc_key`);
  if (!rows?.[0]) return { ok: true };
  if (!sameKey(rows[0].pc_key, key)) throw httpError(403, "This pairing belongs to another PC.");
  await db(`card_relay?code=eq.${enc(code)}`, { method: "DELETE" });
  return { ok: true };
}
