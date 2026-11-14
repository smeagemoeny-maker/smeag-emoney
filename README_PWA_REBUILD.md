# PUSAN MART Rebuild

## Current status

- `smeag_mart/`: existing Android Kotlin/Jetpack Compose app. Keep this as the parity reference.
- `api/`: new Node API skeleton that moves DB access and checkout transactions off the device.
- `pwa/`: new installable PWA shell with NFC event handling.
- `docs/PWA_NFC_REBUILD_PLAN.md`: BMAD + LangGraph-style architecture plan.

## Verified test status

- PWA screens render from `file://` without a build step.
- API `/api/health` works.
- Live MySQL connection currently times out from this machine/network.
- Supabase mode: health, products, NFC lookup and login queries tested against the live project.
- Mock API mode works from the local SQL dumps in `DBSQL/`.
- Mock login, product list, buyer lookup, checkout, and PusanMart payment endpoints have been smoke-tested.

## Sales screens (PWA)

| Tab | Campus | Products shown |
|---|---|---|
| SMEAG Cafe | Capital / Encanto / Tarlac (selectable) | `store_menus` rows whose `m_menu` contains "Cafe" or "Americano" for that campus |
| PUSAN Mart | Pusan Mart (fixed) | `store_menus` rows with `Campus = 'PUSAN MART'` |

- Each tab has its own cart, discount, category filter and search.
- Sold-out items are listed last and cannot be added; quantity cannot exceed stock.
- Checkout sends `store: "cafe" | "mart"`; `bank.category` is saved as `<Campus> Cafe` or `<Campus> Mart`.
- NFC UIDs are normalized to lowercase hex without separators (Web NFC `04:D0:...` → `04d0...`).
- `index.html` loads `src/api.js`, `src/nfcService.js`, `src/main.js` (plain scripts, no build step).

## NFC payment / charge

| Screen | Card input | Actions |
|---|---|---|
| PUSAN Mart | Phone NFC (Android app bridge or Chrome Web NFC, **HTTPS only**) | E-money payment |
| SMEAG Cafe | Phone NFC **or** USB/Bluetooth NFC reader (keyboard mode) | Payment + e-money charge (`결제` / `이머니 충전` toggle) |

- Charge: `POST /api/charges {uid, campus, amount, staffLoginId}` → one `bank` row with
  `transaction_type='increase'`, `remark='R'`, `category='<Campus> Cafe'`, `subcategory='Charge'`,
  `` `order` `` = staff login_id (same as the office program), and `person.totalmoney` is updated in one transaction.
  Max per charge: `MAX_CHARGE` env (default 10000).
- USB readers: a burst of ≥6 hex/digit keys (<60 ms apart) ending in Enter is treated as a card tap, only while waiting for a tap.
  If a reader types a 10-digit decimal UID, it is converted to hex (Settings → 리더기 UID 형식: auto / hex / decimal reversed / decimal).
  Verify with a real card on the 구매자 screen that the UID matches `person.uid`.
- Android WebView wrapper: call `PusanMartNfcBridge(activity, webView).attach()` to expose `window.PusanMartNfc`.

## Account access (locked by mgperson position/campus)

E-money is charged only in the Office program (`office/`, OFFICE MENU → + INCREASE → `/api/office/transactions`).
`POST /api/charges` (old POS charge) is refused for every account; the cafe "Top up" button only shows that notice.
The site root (`index.html`) links to the three legacy screens; the earlier mobile POS moved to `pos.html`.

Defined in `api/src/access.mjs`, enforced by the API and mirrored in the PWA nav.

| Account | Screens | Cafe campus | Charge |
|---|---|---|---|
| Admin / Manager @ Pusan Mart (e.g. psmart) | PUSAN Mart, 구매자, 부산페이 | - | No |
| Admin @ Capital/Encanto/Talrac (e.g. ceo) | All | All (selectable) | Office only |
| Manager @ Capital / Encanto / Talrac | SMEAG Cafe, 구매자, Office | Own campus only (Talrac → Tarlac) | Office only |
| Baydream Manager, Security, StoreOrder | Login refused | - | - |

- Login returns an HMAC-signed token (12h). All endpoints except `/api/health` and login need `Authorization: Bearer <token>`.
- Set `TOKEN_SECRET` in `api/.env`; without it a random secret is used and everyone must log in again after an API restart.
- Charge's `bank.order` (staff id) is taken from the token, not from the request body.

## Database: Supabase (default)

The API uses the Supabase project that holds the full copy of the legacy MySQL `smeagemoney` DB
(the same DB as the Emoney app). Set in `api/.env`:

```text
USE_MOCK_DB=false
DB_BACKEND=supabase          # or mysql = legacy server (fallback during cutover)
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...     # service_role key, server-side only
```

One-time setup: paste `api/migrations/supabase_pos_functions.sql` into Supabase → SQL Editor → Run.
It creates `pos_checkout` / `pos_charge`, which do the balance + stock + `bank` writes in one transaction.

- Login: `mgperson.password` is stored as SHA-256 hex in Supabase; the API hashes the typed password.
- `uid` / `login_id` are `citext` (case-insensitive, like MySQL).
- Data written to MySQL after the copy is not in Supabase: re-run the Emoney
  `backend/scripts/sync_from_mysql.py` right before switching the stores over.

## Run with mock data

Set `USE_MOCK_DB=true` in `api/.env`, then run:

```bash
cd api
npm install
npm run start
```

Serve the PWA (any static server) and open it:

```bash
cd pwa
python3 -m http.server 4173   # or: npm install && npm run dev
```

```text
http://localhost:4173/index.html
http://localhost:4173/index.html?demo=1#/cafe   # demo mode, no API needed
```

Mock mode keeps checkout/stock/balance changes in memory only; they reset when the API restarts.

Mock API mode is the recommended local UI test path until the live MySQL server allows this machine's IP/port access.

## Run with live DB

Set `USE_MOCK_DB=false` in `api/.env`, then run the API server. If API requests return `connect ETIMEDOUT`, the app code is running but the MySQL server is unreachable from the current network. Check server firewall, MySQL bind address, cloud/network ACLs, and allowed client IPs.

## Next implementation order

1. Configure `api/.env` from `api/.env.example`.
2. Run `api` and test login/products/buyer lookup against a safe database.
3. Run `pwa` and test manual UID flows.
4. Add Capacitor or custom Android WebView wrapper for native NFC.
5. Validate real card UID equality with the old Android app.

## Important security note

Do not put DB or SFTP credentials in the PWA or Android wrapper. All credentialed work belongs in `api/`.

## SMEAG Campus (student app + staff requests + SMEAG Bot)

`pwa/campus/` (students: e-money, requests, scores, notices, SMEAG Bot) and `pwa/campus-admin/` (staff queue).
Setup, money rule and API: `docs/CAMPUS_APP.md`. Run `api/migrations/supabase_campus_app.sql` once in Supabase first.
