-- SMEAG OFFICE (OFFICE MENU tab) transaction function for the Supabase project (nbph…).
-- Paste the whole file into Supabase Dashboard → SQL Editor → Run. Safe to re-run.
-- Run supabase_pos_functions.sql as well; this file only adds pos_office_transaction.
--
-- One call = one office transaction: every line becomes one bank row, and the balance is
-- updated in the same database transaction with the person row locked (FOR UPDATE).
-- Row shapes match the office program's existing bank rows:
--   INCREASE  -> transaction_type 'increase',  remark 'R', balance + amount
--   DECREASE  -> transaction_type 'decrease',  remark 'N', balance - amount (never below 0)
--   EXCEPTION -> transaction_type 'exception', remark 'E', recorded only, balance unchanged
-- transaction_source = 'office', "order" = staff login_id. Errors use PTxxx -> HTTP xxx.

create or replace function public.pos_office_transaction(
    p_uid      text,
    p_lines    jsonb,
    p_staff_id text
)
returns jsonb
language plpgsql
-- Supabase installs citext in the "extensions" schema; keep it resolvable for p_uid::citext.
set search_path = public, extensions
as $$
declare
    v_person  public.person%rowtype;
    v_line    jsonb;
    v_kind    text;
    v_type    text;
    v_remark  text;
    v_sign    integer;
    v_price   numeric(14, 2);
    v_qty     integer;
    v_amount  numeric(14, 2);
    v_before  numeric(14, 2);
    v_balance numeric(14, 2);
    v_start   numeric(14, 2);
    v_id      bigint;
    v_ids     bigint[] := '{}';
begin
    if coalesce(p_staff_id, '') = '' then
        raise sqlstate 'PT401' using message = 'Staff login is required.';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
        raise sqlstate 'PT400' using message = 'Add at least one line.';
    end if;
    if jsonb_array_length(p_lines) > 50 then
        raise sqlstate 'PT400' using message = 'Too many lines.';
    end if;

    -- Duplicate uids exist in the legacy data: lock them all, use the oldest row, update all.
    perform 1 from public.person where uid = p_uid::citext for update;
    select * into v_person from public.person where uid = p_uid::citext order by id limit 1;
    if not found then
        raise sqlstate 'PT404' using message = 'Student not found.';
    end if;

    v_start   := coalesce(v_person.totalmoney, 0);
    v_balance := v_start;

    for v_line in select * from jsonb_array_elements(p_lines) loop
        v_kind  := upper(coalesce(v_line ->> 'type', ''));
        v_price := (v_line ->> 'unitPrice')::numeric;
        v_qty   := (v_line ->> 'qty')::integer;

        if v_kind = 'INCREASE' then
            v_type := 'increase';  v_remark := 'R'; v_sign := 1;
        elsif v_kind = 'DECREASE' then
            v_type := 'decrease';  v_remark := 'N'; v_sign := -1;
        elsif v_kind = 'EXCEPTION' then
            v_type := 'exception'; v_remark := 'E'; v_sign := 0;
        else
            raise sqlstate 'PT400' using message = 'Invalid line type.';
        end if;
        if coalesce(trim(v_line ->> 'mMenu'), '') = '' or coalesce(trim(v_line ->> 'sMenu'), '') = '' then
            raise sqlstate 'PT400' using message = 'Category and item are required.';
        end if;
        if v_price is null or v_price <= 0 or v_price <> round(v_price, 2) then
            raise sqlstate 'PT400' using message = 'Price must be greater than 0.';
        end if;
        if v_qty is null or v_qty < 1 or v_qty > 999 then
            raise sqlstate 'PT400' using message = 'Qty must be 1-999.';
        end if;

        v_amount  := round(v_price * v_qty, 2);
        v_before  := v_balance;
        v_balance := v_balance + v_sign * v_amount;
        -- Only a DECREASE may be refused for overdraft (same rule as the screen).
        if v_sign < 0 and v_balance < 0 then
            raise sqlstate 'PT409' using message = 'Insufficient balance.';
        end if;

        insert into public.bank (uid, studentid, name, campus, beforeamount, category, subcategory,
                                 transaction_type, payment, totalmoney, quantity,
                                 remark, transaction_source, "order")
        values (v_person.uid, coalesce(v_person.studentid, ''), coalesce(v_person.name, ''),
                coalesce(v_person.campus, ''), v_before, trim(v_line ->> 'mMenu'), trim(v_line ->> 'sMenu'),
                v_type, v_amount, v_balance, v_qty, v_remark, 'office', p_staff_id)
        returning id into v_id;
        v_ids := v_ids || v_id;
    end loop;

    update public.person set totalmoney = v_balance where uid = p_uid::citext;

    return jsonb_build_object(
        'id', v_id,
        'bankIds', to_jsonb(v_ids),
        'balanceBefore', v_start,
        'balanceAfter', v_balance,
        'netChange', v_balance - v_start
    );
end;
$$;

-- Only the API (service_role key) may call it.
revoke execute on function public.pos_office_transaction(text, jsonb, text) from public, anon, authenticated;
grant  execute on function public.pos_office_transaction(text, jsonb, text) to service_role;

notify pgrst, 'reload schema';
