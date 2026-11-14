# SMEAG Campus app

Student web app (`/campus/`) and staff screen (`/campus-admin/`) on the same Vercel project and the same
Supabase database (nbph…) as the e-money POS and office program.

| Screen | Who | Sign-in |
|---|---|---|
| `/campus/` | Students | Student ID + 4–6 digit PIN (30-day session) |
| `/campus-admin/` | Admin (every campus), campus Managers (own campus) | Staff ID, same as the office program |

## What students can do

- **Wallet**: balance, available (balance minus fees of waiting requests), top-up and spending history
  (`bank` + `beforebank`), 30-day totals, freeze a lost card (store terminals then refuse it with HTTP 423).
- **Requests** (one engine, 11 types): activity, room change, room cleaning, clinic class, overnight leave,
  graduation check, checkout time, airport pickup, car rental, balance refund, course change & payment.
- **Scores**: TOEFL / IELTS mock test results the office imports.
- **Notices**: per campus or for every campus, pinned first.
- **SMEAG Bot**: answers questions from the FAQ, current notices and the student's own data.

## Money rule

Nothing is charged when a student sends a request. The fee comes from `campus_catalog` on the server (never
from the app) and is **held** in the app's "available" figure. It is charged once, when staff approve, by
`campus_decide_request`: one `bank` row (`category 'SMEAG App'`, `transaction_source 'CAMPUS APP'`, `remark 'N'`,
`order` = staff login_id) and `person.totalmoney` updated in the same transaction. If the student no longer has
enough e-money at approval time (they spent it at a store), approval is refused with a message. A rejected or
cancelled request is never charged. Refunds of an approved fee are done in the office program as usual.

Car rental is charged per day, a course per week when its fee unit says so; everything else once.

## Request rules

- Graduation check, checkout time and balance refund: one live request each. Checkout needs an approved
  graduation check.
- Activities: one sign-up per student, seats limited by `capacity`, closed once the activity starts.
- Overnight leave is refused when `student_access.perm_prohibited = 1` for the student's card.
- Every submission carries a client key, so a double tap creates one request.
- Status flow: sent → reviewing → approved → done, or rejected (reason required) / cancelled (by the student
  while still waiting).

## Student sign-in

1. **First time, Android**: *First time here* → tap the student card on the phone (Chrome Web NFC) → set a PIN.
2. **First time, iPhone, or forgotten PIN**: staff open `/campus-admin/` → Students → *Issue sign-in code*.
   The 6-digit code is valid 3 days; it clears the old PIN and signs the student out on every device.
3. Five wrong PINs lock sign-in for 15 minutes. Staff can unlock at once (Students → *Unfreeze / unlock*).
4. When the office issues a new card (new `person` row, old uid gets the `G` prefix) the account moves to the
   new record at the next sign-in.

Student requests are **not** written to the staff activity log (their bodies contain PINs).

## SMEAG Bot

- With `ANTHROPIC_API_KEY` set in Vercel, answers come from Claude (`claude-opus-5-5`, effort low, server-side
  refusal fallback on). Override the model with `CAMPUS_BOT_MODEL`.
- Without the key, or if the call fails, the bot matches the question against the FAQ (keywords in any
  language) and otherwise tells the student to ask the office.
- Limit: `BOT_HOURLY_LIMIT` questions per student per hour (default 30). Every question and answer is kept in
  `campus_bot_log`.
- Edit the FAQ in `/campus-admin/` → SMEAG Bot FAQ. Add Korean words to *Keywords* so Korean questions match
  without the AI.

## Setup

1. Supabase (nbph…) → SQL Editor → paste and run `api/migrations/supabase_campus_app.sql` (safe to run again).
2. Vercel project `pusan-mart-pwa` → Environment Variables (Production): add `ANTHROPIC_API_KEY` (optional,
   for AI answers). `TOKEN_SECRET` must already be set; student tokens are derived from it.
3. From `pwa/`: `npm run deploy`. The Vercel install step now runs `npm install --omit=dev` so the function
   gets `@anthropic-ai/sdk`.
4. In `/campus-admin/`: add pickup routes, rental cars, activities and courses with their fees (Prices &
   options), a first notice, and check the bot FAQ.

If the API is deployed before step 1, the student app shows errors but store sales keep working: the
frozen-card check is skipped when its table is missing.

## API

Students (student token): `GET /api/campus/config`, `POST /api/campus/activate`, `POST /api/campus/login`,
`GET /api/campus/me`, `POST /api/campus/pin`, `POST /api/campus/lang`, `GET /api/campus/wallet?kind&before`,
`POST /api/campus/card {frozen}`, `GET /api/campus/notices`, `GET /api/campus/catalog?kind`,
`GET|POST /api/campus/requests`, `POST /api/campus/requests/:id/cancel`, `GET /api/campus/scores`,
`POST /api/campus/bot {message, history}`.

Staff (office token): `GET /api/campus-admin/requests?status&type&search&from&to`,
`POST /api/campus-admin/requests/:id {status, note}`, CRUD on `/api/campus-admin/{notices|catalog|faq}`,
`GET /api/campus-admin/students?search`, `POST /api/campus-admin/students/:personId/activation`,
`POST /api/campus-admin/students/:personId/unfreeze`, `GET|POST /api/campus-admin/scores`.

Code: `api/src/campus.mjs`, `api/src/campusBot.mjs`, routes in `api/src/app.mjs`,
screens in `pwa/campus/` and `pwa/campus-admin/`.

## Tested

Against the local Postgres + PostgREST copy (`api/dev/load-local-supabase.sh`), never the live project:
63 API checks (sign-in, lockout, office code, PIN change, every request rule, fee hold and charge, campus
scoping, freeze blocking a POS checkout, score import, bot FAQ fallback), the Claude call against a stub server,
and the student and staff screens in headless Chrome (phone and desktop, light and dark, English and Korean).
Not yet tested: a real Claude answer (no API key on the test machine) and Web NFC on a real Android phone.
