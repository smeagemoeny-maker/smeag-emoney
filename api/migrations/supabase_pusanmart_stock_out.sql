-- Product Stock-Out (Pull Out / Transfer / Return to supplier), modelled on the Bizmatech "Product Stock-Out" screen:
--   one document = kind + ref no + consignee + approved by + several product lines; every line lowers stock.
-- Run AFTER supabase_pusanmart_stock_moves.sql. Paste into the Supabase SQL Editor (project nbph...) and run once.
-- Safe to run again.
--
-- Written/read by api/src/backofficeSupabase.mjs (service key):
--   POST /api/stock-out {campus, kind: 'pullout'|'transfer'|'return', consignee, approvedBy?, note?,
--                        lines: [{productId, quantity, charges?}]}
--   GET  /api/stock-moves?from&to&campus   (stock-out lines come back with refNo / consignee / approvedBy / charges)

alter table public.pusanmart_stock_moves add column if not exists ref_no      text;
alter table public.pusanmart_stock_moves add column if not exists consignee   text;   -- branch / stock room / supplier / customer
alter table public.pusanmart_stock_moves add column if not exists approved_by text;
alter table public.pusanmart_stock_moves add column if not exists charges     numeric(12,2);  -- service / other expense on this line

alter table public.pusanmart_stock_moves drop constraint if exists pusanmart_stock_moves_kind_check;
alter table public.pusanmart_stock_moves add constraint pusanmart_stock_moves_kind_check
  check (kind in ('in', 'expired', 'pullout', 'transfer', 'return'));

create index if not exists pusanmart_stock_moves_ref_idx on public.pusanmart_stock_moves (ref_no) where ref_no is not null;

create sequence if not exists public.pusanmart_stock_out_seq start 1;

-- One stock-out document in one transaction: locks every product (in id order), checks stock, lowers it and
-- writes one log row per line, all with the same ref_no ('SO00001'...). Any error rolls the whole document back.
create or replace function public.pos_stock_out(
    p_campus      text,
    p_kind        text,
    p_lines       jsonb,
    p_consignee   text,
    p_approved_by text default null,
    p_note        text default null,
    p_staff       text default null
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
    v_ref     text;
    v_line    jsonb;
    v_pid     bigint;
    v_qty     integer;
    v_charges numeric;
    v_product public.store_menus%rowtype;
    v_before  integer;
    v_move    public.pusanmart_stock_moves%rowtype;
    v_moves   jsonb := '[]'::jsonb;
    v_note    text := nullif(left(trim(coalesce(p_note, '')), 200), '');
    v_cons    text := nullif(left(trim(coalesce(p_consignee, '')), 120), '');
    v_appr    text := nullif(left(trim(coalesce(p_approved_by, '')), 60), '');
begin
    if p_kind not in ('pullout', 'transfer', 'return') then
        raise sqlstate 'PT400' using message = 'kind must be pullout, transfer or return.';
    end if;
    if v_cons is null then
        raise sqlstate 'PT400' using message = 'Consignee (branch / stock room / supplier) is required.';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
        raise sqlstate 'PT400' using message = 'Add at least one product.';
    end if;
    if jsonb_array_length(p_lines) > 300 then
        raise sqlstate 'PT400' using message = 'Too many lines (max 300).';
    end if;
    if (select count(distinct (l ->> 'product_id')) from jsonb_array_elements(p_lines) l) <> jsonb_array_length(p_lines) then
        raise sqlstate 'PT400' using message = 'The same product is listed twice: combine the quantities into one line.';
    end if;

    -- lock all products first, in id order (no deadlock with checkout / other stock moves)
    perform 1 from public.store_menus
     where id in (select (l ->> 'product_id')::bigint from jsonb_array_elements(p_lines) l)
     order by id for update;

    v_ref := 'SO' || lpad(nextval('public.pusanmart_stock_out_seq')::text, 5, '0');

    for v_line in select * from jsonb_array_elements(p_lines) loop
        v_pid     := (v_line ->> 'product_id')::bigint;
        v_qty     := (v_line ->> 'quantity')::integer;
        v_charges := nullif(v_line ->> 'charges', '')::numeric;
        if v_qty is null or v_qty <= 0 or v_qty > 100000 then
            raise sqlstate 'PT400' using message = 'Quantity must be 1 or more (product ' || v_pid || ').';
        end if;
        if v_charges is not null and (v_charges < 0 or v_charges > 10000000) then
            raise sqlstate 'PT400' using message = 'Charges must be 0 or more (product ' || v_pid || ').';
        end if;

        select * into v_product from public.store_menus where id = v_pid;
        if not found then
            raise sqlstate 'PT404' using message = 'Product ' || v_pid || ' not found.';
        end if;
        if upper(coalesce(v_product."Campus", '')) <> upper(coalesce(p_campus, '')) then
            raise sqlstate 'PT400' using message = '"' || coalesce(v_product.s_menu, '') || '" is not a ' || coalesce(p_campus, '') || ' product.';
        end if;
        v_before := coalesce(v_product.stock, 0);
        if v_qty > v_before then
            raise sqlstate 'PT409' using message = '"' || coalesce(v_product.s_menu, '') || '": cannot take out ' || v_qty || ', only ' || v_before || ' in stock.';
        end if;

        update public.store_menus set stock = v_before - v_qty where id = v_pid;

        insert into public.pusanmart_stock_moves (product_id, campus, category, product_name, barcode, kind, quantity,
                                                  unit_cost, note, stock_before, stock_after, staff,
                                                  ref_no, consignee, approved_by, charges)
        values (v_pid, v_product."Campus", v_product.m_menu, v_product.s_menu,
                nullif(to_jsonb(v_product) ->> 'barcode', ''), p_kind, v_qty,
                nullif(to_jsonb(v_product) ->> 'cost', '')::numeric, v_note, v_before, v_before - v_qty, p_staff,
                v_ref, v_cons, v_appr, v_charges)
        returning * into v_move;
        v_moves := v_moves || to_jsonb(v_move);
    end loop;

    return jsonb_build_object('refNo', v_ref, 'moves', v_moves);
end;
$$;

revoke execute on function public.pos_stock_out(text, text, jsonb, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.pos_stock_out(text, text, jsonb, text, text, text, text) to service_role;
grant  usage, select on sequence public.pusanmart_stock_out_seq to service_role;
grant  update on public.store_menus to service_role;
