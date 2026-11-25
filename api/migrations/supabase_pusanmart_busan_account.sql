-- Login account busan: runs BOTH Pusan Marts (Capital 'Pusan Mart' + Encanto 'Pusan Mart Encanto'),
-- i.e. products / stock / sales / reports of each, plus Pusan Pay / Pay List. No cafe, no office program.
-- The rights come from PUSAN_MART_ALL_ACCOUNTS in api/src/access.mjs (login_id 'busan').
-- ALREADY APPLIED on 2026-11-25 via the service key. Kept as the record; do not run again.
insert into public.mgperson (id, name, position, campus, login_id)
values (28, 'Pusan Mart (All)', 'Manager', 'Pusan Mart', 'busan');
