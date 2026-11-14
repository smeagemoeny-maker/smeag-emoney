-- POS checkout: bank.category per cart line (2026-11-15).
-- Sales are split by the PRODUCT's store, not the screen it was sold on: a Capital Mart item sold
-- at the Capital Cafe counter is recorded as "Capital Mart". The API (api/src/supabaseRepository.mjs)
-- puts {"category": ...} on each cart item; lines without it fall back to p_category as before.
-- Paste into the Supabase SQL Editor (project nbph...) and run once. Safe to run again.
-- Only pos_checkout changes; same signature and grants as supabase_pos_functions.sql.

create or replace function public.pos_checkout(
    p_uid            text,
    p_store          text,
    p_campus         text,
    p_cart           jsonb,
    p_discount_label text    default 'No Discount',
    p_discount_rate  numeric default 0,
    p_category       text    default null
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
    v_person   public.person%rowtype;
    v_product  public.store_menus%rowtype;
    v_item     jsonb;
    v_qty      integer;
    v_pid      bigint;
    v_balance  numeric(14, 2);
    v_before   numeric(14, 2);
    v_line     numeric(14, 2);
    v_total    numeric(14, 2) := 0;
    v_order    text := gen_random_uuid()::text;
    v_category text;
    v_line_category text;
begin
    if coalesce(p_discount_rate, 0) not in (0, 0.1, 0.15) then
        raise sqlstate 'PT400' using message = 'Invalid discount rate.';
    end if;
    if p_store is not null and p_store not in ('cafe', 'mart') then
        raise sqlstate 'PT400' using message = 'Store must be ''cafe'' or ''mart''.';
    end if;
    if p_cart is null or jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
        raise sqlstate 'PT400' using message = 'Cart is empty.';
    end if;

    -- Duplicate uids exist in the legacy data: lock them all, use the oldest row
    -- (MySQL picked by primary key) and update all of them, as the MySQL code did.
    perform 1 from public.person where uid = p_uid::citext for update;
    select * into v_person from public.person where uid = p_uid::citext order by id limit 1;
    if not found then
        raise sqlstate 'PT404' using message = 'This NFC card is not registered.';
    end if;

    v_balance  := coalesce(v_person.totalmoney, 0);
    v_category := coalesce(nullif(trim(p_category), ''),
                           case when p_store = 'cafe' then p_campus || ' Cafe' else p_campus || ' Mart' end);

    for v_item in select * from jsonb_array_elements(p_cart) loop
        v_pid := (v_item ->> 'productId')::bigint;
        v_qty := (v_item ->> 'quantity')::integer;
        if v_pid is null or v_qty is null or v_qty <= 0 then
            raise sqlstate 'PT400' using message = 'Invalid cart item.';
        end if;

        select * into v_product from public.store_menus where id = v_pid for update;
        if not found then
            raise sqlstate 'PT404' using message = 'Product not found: ' || v_pid;
        end if;
        if coalesce(v_product.stock, 0) < v_qty then
            raise sqlstate 'PT409' using message = 'Insufficient stock: ' || coalesce(v_product.s_menu, '');
        end if;

        -- bank.category of this line: the product's own store (set by the API), else the selling store.
        v_line_category := coalesce(nullif(trim(v_item ->> 'category'), ''), v_category);

        v_line := round(coalesce(v_product.payment, 0) * v_qty * (1 - coalesce(p_discount_rate, 0)), 2);
        v_total := v_total + v_line;
        if v_balance < v_line then
            raise sqlstate 'PT409' using message = 'Insufficient balance.';
        end if;

        v_before  := v_balance;
        v_balance := v_balance - v_line;

        update public.store_menus
           set stock = coalesce(stock, 0) - v_qty,
               sales_number = coalesce(sales_number, 0) + v_qty
         where id = v_pid;

        insert into public.bank (uid, studentid, name, campus, beforeamount, category, subcategory,
                                 transaction_type, payment, totalmoney, quantity,
                                 transaction_source, remark, "order")
        values (v_person.uid, coalesce(v_person.studentid, ''), coalesce(v_person.name, ''), p_campus,
                v_before, v_line_category, v_product.s_menu, 'decrease', v_line, v_balance, v_qty,
                'PWA POS', coalesce(p_discount_label, 'No Discount'), v_order);
    end loop;

    update public.person set totalmoney = v_balance where uid = p_uid::citext;

    return jsonb_build_object(
        'orderId', v_order,
        'finalTotal', v_total,
        'remainingBalance', v_balance,
        'buyerName', v_person.name
    );
end;
$$;

revoke execute on function public.pos_checkout(text, text, text, jsonb, text, numeric, text) from public, anon, authenticated;
grant  execute on function public.pos_checkout(text, text, text, jsonb, text, numeric, text) to service_role;
