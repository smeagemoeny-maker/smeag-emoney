-- PUSAN MART ENCANTO: second Pusan Mart, Encanto campus, opens 2026-11-25.
-- ALREADY APPLIED on 2026-11-24 (via the service key, same rows as below). Kept as the record; do not run again
-- (the store_menus_campus_item_code_uq index would refuse the duplicate item codes anyway).
--
-- 1. Every Capital Pusan Mart product (store_menus Campus 'PUSAN MART', 540 rows) copied to Campus 'PUSAN MART ENCANTO'
--    with the same name / category / barcode / item code / unit / cost / selling price / reorder level,
--    stock = 0 and sales_number = 0 (new store). From now on the two stores are separate rows:
--    a price or stock change in one never touches the other.
-- 2. Login account ps-encanto (mgperson campus 'Pusan Mart Encanto', Manager): mart screen of the Encanto
--    Pusan Mart only (api/src/access.mjs). No Pusan Pay / Pay List (those are the Capital Pusan Mart's).
--    Sales are written to bank with campus 'Pusan Mart Encanto', category 'Pusan Mart Encanto Mart'.

insert into public.store_menus (m_menu, s_menu, payment, "Campus", image_path, stock, sales_number, min_stock,
                                manager, barcode, item_code, cost, unit, sub_category)
select m_menu, s_menu, payment, 'PUSAN MART ENCANTO', image_path, 0, 0, min_stock,
       'Copied from Capital Pusan Mart 2026-11-24 (stock 0)', barcode, item_code, cost, unit, sub_category
  from public.store_menus
 where "Campus" = 'PUSAN MART';

insert into public.mgperson (id, name, position, campus, login_id)
values (27, 'Pusan Mart Encanto', 'Manager', 'Pusan Mart Encanto', 'ps-encanto');
