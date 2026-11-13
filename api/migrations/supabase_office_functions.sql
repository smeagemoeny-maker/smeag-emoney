-- SMEAG OFFICE ONLINE PROGRAM: TransData (bank -> beforebank) in one transaction.
-- Paste into the Supabase SQL Editor (project nbph...) and run once. Safe to run again.
--
-- Called by api/src/office.mjs transDataMove() as POST /rest/v1/rpc/office_transdata_move {"p_ids":[...]}.
-- - All or nothing: any error rolls back the whole move.
-- - DELETE ... RETURNING locks the rows, so two concurrent requests for the same ids cannot copy a row
--   twice (the second one finds nothing left to delete and moves 0).
-- - beforebank gets NEW ids: bank and beforebank id ranges overlap (old bank ids already used in beforebank).
-- Returns the number of rows moved.

create or replace function public.office_transdata_move(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moved integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Select at least one row.' using errcode = 'PT400';
  end if;

  with moved as (
    delete from bank
    where id = any(p_ids)
    returning uid, studentid, name, campus, beforeamount, category, subcategory, transaction_type,
              payment, totalmoney, quantity, picture, transaction_date, remark, transaction_source, "order"
  )
  insert into beforebank (uid, studentid, name, campus, beforeamount, category, subcategory, transaction_type,
                          payment, totalmoney, quantity, picture, transaction_date, remark, transaction_source, "order")
  select uid, studentid, name, campus, beforeamount, category, subcategory, transaction_type,
         payment, totalmoney, quantity, picture, transaction_date, remark, transaction_source, "order"
  from moved;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

-- Only the API (service role) may call it.
revoke all on function public.office_transdata_move(bigint[]) from public, anon, authenticated;
grant execute on function public.office_transdata_move(bigint[]) to service_role;

-- Let the REST API (PostgREST) see the new function right away.
notify pgrst, 'reload schema';
