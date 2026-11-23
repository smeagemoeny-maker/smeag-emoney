-- Stock moves: "Add Stock" (stock in, with an optional expiry date) and "Expired" (stock removed because it expired).
-- PWA mart > Products > Edit: Add Stock / Expired boxes;  Report > Stock: daily stock in / expired report (printable).
-- Paste into the Supabase SQL Editor (project nbph...) and run once. Safe to run again.
--
-- Written/read by api/src/backofficeSupabase.mjs (service key, so RLS does not apply to it):
--   POST /api/products/:id/stock-moves {kind: 'in'|'expired', quantity, expiryDate?, note?}
--   GET  /api/stock-moves?from&to&campus
-- RLS is on with no policies: the anon/public key cannot read or change it.

create table if not exists public.pusanmart_stock_moves (
  id            bigserial primary key,
  product_id    bigint not null,
  campus        text,
  category      text,                               -- store_menus.m_menu at the time
  product_name  text,                               -- store_menus.s_menu at the time
  barcode       text,
  kind          text not null check (kind in ('in', 'expired')),
  quantity      integer not null check (quantity > 0),
  unit_cost     numeric(12,2),                      -- store_menus.cost at the time (null = not set)
  expiry_date   date,                               -- stock in: expiry of this batch; expired: expiry of the removed batch
  note          text,
  stock_before  integer not null,
  stock_after   integer not null,
  staff         text,                               -- mgperson.login_id from the session
  created_at    timestamptz not null default now()
);

create index if not exists pusanmart_stock_moves_created_idx on public.pusanmart_stock_moves (created_at);
create index if not exists pusanmart_stock_moves_product_idx on public.pusanmart_stock_moves (product_id, created_at);
create index if not exists pusanmart_stock_moves_expiry_idx on public.pusanmart_stock_moves (expiry_date) where kind = 'in';

alter table public.pusanmart_stock_moves enable row level security;
revoke all on public.pusanmart_stock_moves from anon, authenticated;

-- Changes store_menus.stock and writes the log row in one transaction (row lock, like pos_checkout).
create or replace function public.pos_stock_move(
    p_product_id  bigint,
    p_kind        text,
    p_quantity    integer,
    p_expiry_date date default null,
    p_note        text default null,
    p_staff       text default null
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
    v_product public.store_menus%rowtype;
    v_before  integer;
    v_after   integer;
    v_cost    numeric;
    v_barcode text;
    v_move    public.pusanmart_stock_moves%rowtype;
begin
    if p_kind not in ('in', 'expired') then
        raise sqlstate 'PT400' using message = 'kind must be ''in'' or ''expired''.';
    end if;
    if p_quantity is null or p_quantity <= 0 then
        raise sqlstate 'PT400' using message = 'Quantity must be 1 or more.';
    end if;
    if p_quantity > 100000 then
        raise sqlstate 'PT400' using message = 'Quantity is too large.';
    end if;

    select * into v_product from public.store_menus where id = p_product_id for update;
    if not found then
        raise sqlstate 'PT404' using message = 'Product not found.';
    end if;

    v_before := coalesce(v_product.stock, 0);
    if p_kind = 'in' then
        v_after := v_before + p_quantity;
    else
        if p_quantity > v_before then
            raise sqlstate 'PT409' using message = 'Cannot remove ' || p_quantity || ': only ' || v_before || ' in stock.';
        end if;
        v_after := v_before - p_quantity;
    end if;

    update public.store_menus set stock = v_after where id = p_product_id;

    -- barcode / cost exist only after supabase_pusanmart_products_import.sql; read them dynamically.
    v_cost    := nullif(to_jsonb(v_product) ->> 'cost', '')::numeric;
    v_barcode := nullif(to_jsonb(v_product) ->> 'barcode', '');

    insert into public.pusanmart_stock_moves (product_id, campus, category, product_name, barcode, kind, quantity,
                                              unit_cost, expiry_date, note, stock_before, stock_after, staff)
    values (p_product_id, v_product."Campus", v_product.m_menu, v_product.s_menu, v_barcode, p_kind, p_quantity,
            v_cost, p_expiry_date, nullif(left(trim(coalesce(p_note, '')), 200), ''), v_before, v_after, p_staff)
    returning * into v_move;

    return jsonb_build_object('move', to_jsonb(v_move), 'stock', v_after);
end;
$$;

revoke execute on function public.pos_stock_move(bigint, text, integer, date, text, text) from public, anon, authenticated;
grant  execute on function public.pos_stock_move(bigint, text, integer, date, text, text) to service_role;
grant  select, insert on public.pusanmart_stock_moves to service_role;
grant  usage on sequence public.pusanmart_stock_moves_id_seq to service_role;
