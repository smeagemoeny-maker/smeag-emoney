#!/bin/sh
# Start a LOCAL Supabase stand-in (Postgres + PostgREST) loaded with the smeagemoney dumps,
# so the API's DB_BACKEND=supabase code and the migrations/*.sql RPCs can be tested
# without touching the real Supabase project.
#   sh api/dev/load-local-supabase.sh ~/Desktop/smeag_sql
# Then:
#   node api/dev/rest-prefix-proxy.mjs &      # serves PostgREST (:3000) under /rest/v1 on :3001
#   DB_BACKEND=supabase SUPABASE_URL=http://127.0.0.1:3001 SUPABASE_SERVICE_KEY=<printed key> node api/src/server.mjs
set -e
DUMPS="${1:?usage: load-local-supabase.sh <dump folder>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
NET=smeag-supa-test
PG=smeag-pg-test
REST=smeag-postgrest-test
SECRET=local-test-jwt-secret-not-for-production-0123456789

docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
docker rm -f "$PG" "$REST" >/dev/null 2>&1 || true
docker run -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=localtest -e TZ=Asia/Manila \
  -p 127.0.0.1:5433:5432 postgres:16-alpine >/dev/null
until docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2

psql() { docker exec -i "$PG" psql -q -v ON_ERROR_STOP=1 -U postgres postgres "$@"; }
psql < "$HERE/schema.supabase-local.sql"
for table in mgperson person store_menus office_menus bank PusanmartPayments; do
  files=""
  for file in "$DUMPS/$table.sql" "$DUMPS/${table}"_part*.sql; do
    [ -f "$file" ] && files="$files $file"
  done
  [ -n "$files" ] || continue
  # Dump times are Philippine wall-clock; load them as Asia/Manila so timestamptz is correct.
  # Rows are inserted one by one; a bad row is reported and skipped (ON_ERROR_STOP off here).
  # shellcheck disable=SC2086
  { echo "SET TIME ZONE 'Asia/Manila'; BEGIN;"; python3 -I "$HERE/dump_rows.py" --pg $files; echo "COMMIT;"; } \
    | docker exec -i "$PG" psql -q -U postgres postgres 2>&1 | grep -c ERROR | sed "s/^/$table: rows rejected: /"
  echo "$table: $(docker exec "$PG" psql -tA -U postgres postgres -c "select count(*) from \"$table\"") rows"
done
# Identity columns were loaded with explicit ids: move the sequences past them.
psql <<'SQL'
do $$ declare t text; begin
  foreach t in array array['mgperson','person','store_menus','office_menus','bank','PusanmartPayments'] loop
    execute format('select setval(pg_get_serial_sequence(%L, ''id''), coalesce((select max(id) from %I), 1))', format('%I', t), t);
  end loop;
end $$;
SQL
for migration in "$HERE"/../migrations/*.sql; do psql < "$migration"; done

docker run -d --name "$REST" --network "$NET" -p 127.0.0.1:3000:3000 \
  -e PGRST_DB_URI="postgres://authenticator:localtest@$PG:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" \
  postgrest/postgrest:v12.2.3 >/dev/null

KEY=$(node -e '
const c=require("crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({role:"service_role",exp:Math.floor(Date.now()/1000)+86400*30});
console.log(h+"."+p+"."+c.createHmac("sha256",process.argv[1]).update(h+"."+p).digest("base64url"));' "$SECRET")
echo "PostgREST: http://127.0.0.1:3000  (serve it under /rest/v1 with dev/rest-prefix-proxy.mjs on :3001)"
echo "SUPABASE_SERVICE_KEY=$KEY"
