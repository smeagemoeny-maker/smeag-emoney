-- PusanMart daily cost: one row per day with the "Cost Exp." from the PusanMart POS
-- Daily Sales Report (R1:SUMMARY). Sales come from PusanmartPayments; net = sales - cost.
-- Paste into the Supabase SQL Editor (project nbph...) and run once. Safe to run again.
--
-- Written/read by api/src/backofficeSupabase.mjs (service key, so RLS does not apply to it):
--   GET /api/pusanmart/daily?from&to     PUT /api/pusanmart/daily/:date {cost, note}
-- RLS is on with no policies: the anon/public key cannot read or change it.

create table if not exists public.pusanmart_daily_cost (
  day         date primary key,                 -- Philippine calendar day
  cost        numeric(12,2) not null check (cost >= 0),
  note        text,
  updated_by  text,                             -- mgperson.login_id from the session
  updated_at  timestamptz not null default now()
);

alter table public.pusanmart_daily_cost enable row level security;
revoke all on public.pusanmart_daily_cost from anon, authenticated;
