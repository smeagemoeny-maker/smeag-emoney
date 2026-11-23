# SME REFUND tab: smeadmin refunds paid from the e-money card

Office tab **SME REFUND** (`pwa/office/tabs/sme-refund.js`). It replaces the manual three-step flow:

1. smeadmin: search the student, open 변경, fill the refund box (e.g. "student allowance pay thru Alipay 1,046RMB / 1RMB=9.56P", 10,000P).
2. E-money office: Refund / Student allowance, 10,000P from the student's card.
3. smeadmin: Payment Method 환급완료(Refunded), Condition 정상, 확정.

Steps 1 and 3 stay in smeadmin. Step 2 now happens in this tab, using the data read from smeadmin.

## How it works

| Piece | File |
|---|---|
| smeadmin read-only client and page parsers | `api/src/smeadmin.mjs` |
| sync, list, link card, pay | `api/src/smeadminRefund.mjs` |
| routes `/api/office/sme-refunds…` | `api/src/app.mjs` |
| tables | `api/migrations/supabase_smeadmin_refund.sql` |
| tests (no network) | `api/test/*.test.mjs` (`cd api && npm test`) |

- **SYNC** logs in to smeadmin and reads two lists: 변경환불홀딩 filtered to Refund with result 센터수납미처리 or 계좌수납미처리. Only requests from the last `SMEADMIN_SYNC_DAYS` days (45 by default) are read; smeadmin still lists about 200 open refunds going back to 2013. Each request page gives the amount, note and status.
- Only **student allowance** refunds are paid from the card. A note containing allowance, Alipay, WeChat or e-money counts as one. Other refunds (course shortening, tuition, bills) show as "NOT E-MONEY".
- **Amount check**: the note's `RMB × rate` must be within `SMEADMIN_TOLERANCE_PHP` (default ±2P) of the amount. An amount in `$`, RMB or won is locked.
- **Passport**: smeadmin stores it in the student page field `s_addr` (labelled PASSPORT NUMBER). Sync picks the registration whose period matches the request and reads it there. Only `HMAC-SHA256(PASSPORT_HMAC_SECRET, number)` and the last 4 characters are stored. The full number never reaches Supabase or the activity log.
- **Card**: the first time, staff tap the student's card and press LINK TAPPED CARD. That stores `student_identity.person_id`. A different name needs a second confirmation.
- **Pay**: one office transaction, `DECREASE Refund / Student allowance <amount>`, through `pos_office_transaction` with client key `smeadmin-refund-<no>`. The same request can never be charged twice.
- If smeadmin cancels a request after it was paid here, the request shows **PAID → CANCELLED**.

## smeadmin safety

- Only these pages can be called (`ALLOWED` in `smeadmin.mjs`): `student_list_change.php`, `student_modify_change.php?mode=modify`, `student_list.php`, `student_modify.php?mode=modify`, plus login and logout.
- smeadmin's DELETE is a plain GET link (`student_delete2.php`), so the client never follows links.
- `student_modify_change_ok.php` (save) and the confirm page are never called. smeadmin is not changed.
- If a page layout changes, the parsers stop with "smeadmin page layout changed". Staff then use the manual flow.

## Setup

1. Run `api/migrations/supabase_smeadmin_refund.sql` in the Supabase SQL Editor (project nbph…). `api/migrations/supabase_office_idempotency.sql` must already be in place; it provides the client key.
2. In smeadmin `auth_list.php`, create a dedicated account that can only view the change list and the student pages. Do not use an admin account.
3. Set the Vercel production env vars `SMEADMIN_LOGIN_ID`, `SMEADMIN_PASSWORD` and `PASSPORT_HMAC_SECRET` (32+ random characters, never changed later). The optional vars are in `api/.env.example`.
4. Deploy with `npm run deploy` in `pwa/`.
5. Check that the office menu **Refund** has the item **Student allowance**, or set `SMEADMIN_REFUND_ITEM`.

## Later (phase 5, not built)

Setting 환급완료 in smeadmin automatically. Its save page re-posts every field of the form, so a wrong post could change the student's data. Ask the smeadmin developer for a small "mark refunded" endpoint instead.
