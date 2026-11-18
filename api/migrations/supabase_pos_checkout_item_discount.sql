-- POS checkout: per-item discount (2026-11-18).
-- Run AFTER supabase_pos_checkout_capital_staff30.sql. Paste into the Supabase SQL Editor (project nbph...) and run once.
-- Safe to run again (same signature and grants, so callers do not change).
--
-- A cart line may now carry its own discount, which REPLACES the cart-wide discount for that line:
--   { "productId": 1, "quantity": 2, "discountRate": 0.2 }    -- 20% off this line (0 = no discount on this line)
--   { "productId": 1, "quantity": 2, "discountAmount": 10 }   -- ₱10 off this line's total
-- Lines without either key keep using p_discount_rate exactly as before.
-- The bank row of a line with its own discount gets remark 'Item 20%' / 'Item -₱10.00' instead of the cart label.

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
    v_gross    numeric(14, 2);
    v_line     numeric(14, 2);
    v_total    numeric(14, 2) := 0;
    v_order    text := gen_random_uuid()::text;
    v_category text;
    v_line_category text;
    v_item_rate   numeric;
    v_item_amount numeric;
    v_remark   text;
begin
    -- 0 / 10% / 15% everywhere; Staff 30% only at the Capital Cafe.
    if not (coalesce(p_discount_rate, 0) in (0, 0.1, 0.15)
            or (p_discount_rate = 0.3 and p_store = 'cafe' and upper(trim(p_campus)) = 'CAPITAL')) then
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

        v_item_rate   := nullif(v_item ->> 'discountRate', '')::numeric;
        v_item_amount := nullif(v_item ->> 'discountAmount', '')::numeric;
        if v_item_rate is not null and v_item_amount is not null then
            raise sqlstate 'PT400' using message = 'Use either an item discount rate or an amount, not both.';
        end if;
        if v_item_rate is not null and (v_item_rate < 0 or v_item_rate > 1) then
            raise sqlstate 'PT400' using message = 'Invalid item discount rate.';
        end if;
        if v_item_amount is not null and v_item_amount < 0 then
            raise sqlstate 'PT400' using message = 'Invalid item discount amount.';
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

        v_gross := coalesce(v_product.payment, 0) * v_qty;
        if v_item_amount is not null then
            v_item_amount := round(least(v_item_amount, v_gross), 2);
            v_line   := v_gross - v_item_amount;
            v_remark := 'Item -₱' || to_char(v_item_amount, 'FM999,999,990.00');
        elsif v_item_rate is not null then
            v_line   := round(v_gross * (1 - v_item_rate), 2);
            v_remark := case when v_item_rate = 0 then 'No Discount'
                             else 'Item ' || trim_scale(round(v_item_rate * 100, 2))::text || '%' end;
        else
            v_line   := round(v_gross * (1 - coalesce(p_discount_rate, 0)), 2);
            v_remark := coalesce(p_discount_label, 'No Discount');
        end if;

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
                'PWA POS', v_remark, v_order);
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

notify pgrst, 'reload schema';
