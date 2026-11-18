-- Pusan Pay memo (PWA mart > Pusan Pay: optional "Memo" field).
-- Run AFTER supabase_pusanmart_pay.sql. Paste into the Supabase SQL Editor (project nbph...) and run once. Safe to run again.
--
-- The memo is stored in PusanmartPayments.memo and also appended to the bank row's remark
-- ("<discount label> · <memo>") so it shows in the student's wallet / purchase history.

alter table public."PusanmartPayments" add column if not exists memo text;

-- Replace the 5-argument version so PostgREST has exactly one pos_pusanmart_pay to call.
drop function if exists public.pos_pusanmart_pay(text, numeric, text, text, text);

create or replace function public.pos_pusanmart_pay(
    p_uid            text,
    p_amount         numeric,
    p_discount_label text default 'No Discount',
    p_staff          text default null,
    p_client_key     text default null,
    p_memo           text default null
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
    v_person   public.person%rowtype;
    v_amount   numeric(14, 2) := round(coalesce(p_amount, 0), 2);
    v_before   numeric(14, 2);
    v_after    numeric(14, 2);
    v_order    text := gen_random_uuid()::text;
    v_pay_id   bigint;
    v_existing record;
    v_memo     text := nullif(left(trim(coalesce(p_memo, '')), 200), '');
    v_label    text := coalesce(nullif(trim(p_discount_label), ''), 'No Discount');
begin
    if v_amount <= 0 then
        raise sqlstate 'PT400' using message = 'Total amount must be greater than 0.';
    end if;
    if v_amount > 100000 then
        raise sqlstate 'PT400' using message = 'Total amount is too large.';
    end if;

    -- Same as pos_checkout: lock every row with this uid, pay from the oldest, keep them all in step.
    perform 1 from public.person where uid = p_uid::citext for update;
    select * into v_person from public.person where uid = p_uid::citext order by id limit 1;
    if not found then
        raise sqlstate 'PT404' using message = 'This NFC card is not registered.';
    end if;

    if coalesce(p_client_key, '') <> '' then
        select id, bank_order, allpayments into v_existing from public."PusanmartPayments" where client_key = p_client_key;
        if found then
            return jsonb_build_object('id', v_existing.id, 'orderId', v_existing.bank_order, 'amount', v_existing.allpayments,
                                      'name', v_person.name, 'studentId', v_person.studentid,
                                      'remainingBalance', coalesce(v_person.totalmoney, 0), 'repeated', true);
        end if;
    end if;

    v_before := coalesce(v_person.totalmoney, 0);
    if v_before < v_amount then
        raise sqlstate 'PT409' using message = format('Insufficient balance. Balance: %s, needed: %s.',
            to_char(v_before, 'FM999,999,990.00'), to_char(v_amount, 'FM999,999,990.00'));
    end if;
    v_after := v_before - v_amount;

    insert into public.bank (uid, studentid, name, campus, beforeamount, category, subcategory,
                             transaction_type, payment, totalmoney, quantity,
                             transaction_source, remark, "order")
    values (v_person.uid, coalesce(v_person.studentid, ''), coalesce(v_person.name, ''), 'Pusan Mart',
            v_before, 'Pusan Mart', 'Pusan Mart purchase', 'decrease', v_amount, v_after, 1,
            'PWA POS', case when v_memo is null then v_label else v_label || ' · ' || v_memo end, v_order);

    update public.person set totalmoney = v_after where uid = p_uid::citext;

    insert into public."PusanmartPayments" (nfcid, center, name, allpayments, stock, register_days, bank_order, client_key, staff, memo)
    values (lower(p_uid), 'PusanMart', coalesce(v_person.name, ''), v_amount, 0, now(), v_order,
            nullif(p_client_key, ''), p_staff, v_memo)
    returning id into v_pay_id;

    return jsonb_build_object('id', v_pay_id, 'orderId', v_order, 'amount', v_amount,
                              'name', v_person.name, 'studentId', v_person.studentid, 'memo', v_memo,
                              'balanceBefore', v_before, 'remainingBalance', v_after, 'repeated', false);
end;
$$;

revoke execute on function public.pos_pusanmart_pay(text, numeric, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.pos_pusanmart_pay(text, numeric, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
