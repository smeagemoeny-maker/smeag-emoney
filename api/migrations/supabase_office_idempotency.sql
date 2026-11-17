-- SMEAG OFFICE (OFFICE MENU tab): CONFIRM TRANSACTION must never charge twice.
-- Paste into the Supabase SQL Editor (project nbph...) and run once. Safe to run again.
--
-- The office screen now sends a client_key with each cart. If the first request already went
-- through (e.g. the screen showed an error or the staff pressed Confirm again), the second call with
-- the same key does NOT create bank rows again: it returns the first result with "repeated": true.
-- Calls without a key (old screen) work exactly as before.

create table if not exists public.office_txn_keys (
    client_key text primary key,
    uid        text not null,
    staff      text,
    result     jsonb not null,
    created_at timestamptz not null default now()
);
alter table public.office_txn_keys enable row level security;   -- service_role only

-- Wrap the existing function: rename it once, then the new pos_office_transaction calls it.
do $$
begin
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'pos_office_transaction'
                 and pg_get_function_identity_arguments(p.oid) = 'p_uid text, p_lines jsonb, p_staff_id text')
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'pos_office_transaction_once') then
        alter function public.pos_office_transaction(text, jsonb, text) rename to pos_office_transaction_once;
    elsif exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'pos_office_transaction'
                 and pg_get_function_identity_arguments(p.oid) = 'p_uid text, p_lines jsonb, p_staff_id text') then
        -- supabase_backoffice_functions.sql was run again after this file: keep the newer body.
        drop function public.pos_office_transaction_once(text, jsonb, text);
        alter function public.pos_office_transaction(text, jsonb, text) rename to pos_office_transaction_once;
    end if;
end;
$$;
revoke execute on function public.pos_office_transaction_once(text, jsonb, text) from public, anon, authenticated;

create or replace function public.pos_office_transaction(
    p_uid        text,
    p_lines      jsonb,
    p_staff_id   text,
    p_client_key text default null
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
    v_key    text := nullif(trim(coalesce(p_client_key, '')), '');
    v_prev   jsonb;
    v_result jsonb;
begin
    if v_key is not null then
        -- Same lock the real function takes, so two requests with one key run one after the other.
        perform 1 from public.person where uid = p_uid::citext for update;
        select result into v_prev from public.office_txn_keys where client_key = v_key;
        if found then
            return v_prev || jsonb_build_object('repeated', true);
        end if;
    end if;

    v_result := public.pos_office_transaction_once(p_uid, p_lines, p_staff_id);

    if v_key is not null then
        insert into public.office_txn_keys (client_key, uid, staff, result)
        values (v_key, p_uid, p_staff_id, v_result);
    end if;
    return v_result || jsonb_build_object('repeated', false);
end;
$$;

revoke execute on function public.pos_office_transaction(text, jsonb, text, text) from public, anon, authenticated;
grant  execute on function public.pos_office_transaction(text, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
