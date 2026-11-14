-- Staff activity log: one row per API request made from the POS / Mart / Cafe / Office screens.
-- Paste into the Supabase SQL Editor (project nbph...) and run once. Safe to run again.
--
-- Written by api/src/activityLog.mjs (service key, so RLS does not apply to it).
-- Read by GET /api/office/activity-log (Office > LOG tab, Admin accounts only).
-- RLS is on with no policies: the anon/public key cannot read or change the log.

create table if not exists public.staff_activity_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  login_id    text,          -- mgperson.login_id from the session token (or the ID typed at login)
  staff_name  text,
  position    text,
  campus      text,          -- account campus (mgperson.campus)
  action      text not null, -- readable label, e.g. 'Login', 'Checkout', 'Delete bank row'
  method      text not null,
  path        text not null,
  status      integer not null,
  ok          boolean not null,
  error       text,
  detail      jsonb,         -- query parameters / request body (photos and secrets removed, long text cut)
  ip          text,
  user_agent  text,
  duration_ms integer
);

create index if not exists staff_activity_log_created_at_idx on public.staff_activity_log (created_at desc);
create index if not exists staff_activity_log_login_id_idx on public.staff_activity_log (login_id, created_at desc);

alter table public.staff_activity_log enable row level security;
revoke all on public.staff_activity_log from anon, authenticated;
