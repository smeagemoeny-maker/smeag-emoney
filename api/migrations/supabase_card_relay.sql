-- Phone as the PC's card reader (api/src/cardRelay.mjs).
-- Paste into the Supabase SQL Editor (project nbph...) and run once. Safe to run again.
--
-- The PC Sales screen opens a pairing: a 4-digit code (shown on the PC) + a secret key (kept by the PC).
-- A logged-in phone joins with the code; each card tap on the phone writes tap_uid and bumps tap_seq.
-- The PC long-polls the row (with its key) and takes every new tap_seq as a card tap.
-- One row per pairing; expired rows are deleted when a new pairing is made.

create table if not exists public.card_relay (
    code           text primary key check (code ~ '^[0-9]{4}$'),
    pc_key         text not null,
    created_by     text,
    campus         text,
    created_at     timestamptz not null default now(),
    expires_at     timestamptz not null,
    phone_by       text,
    phone_seen_at  timestamptz,
    tap_seq        integer not null default 0,
    tap_uid        text,
    tap_at         timestamptz
);
create index if not exists card_relay_expires on public.card_relay (expires_at);
alter table public.card_relay enable row level security;   -- service_role only

notify pgrst, 'reload schema';
