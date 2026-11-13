#!/bin/sh
# Load a LOCAL MySQL test container with the smeagemoney dumps. Never point this at the live server.
#   docker run -d --name smeag-mysql-test -e MYSQL_ROOT_PASSWORD=localtest -e MYSQL_DATABASE=smeagemoney \
#     -p 127.0.0.1:3307:3306 mysql:8.0 --character-set-server=utf8mb4
#   sh api/dev/load-local-db.sh ~/Desktop/smeag_sql
set -e
DUMPS="${1:?usage: load-local-db.sh <dump folder>}"
CONTAINER="${CONTAINER:-smeag-mysql-test}"
HERE="$(cd "$(dirname "$0")" && pwd)"

run() { docker exec -i -e MYSQL_PWD=localtest "$CONTAINER" mysql -uroot --default-character-set=utf8mb4 smeagemoney "$@"; }

run < "$HERE/schema.mysql.sql"
for table in mgperson person store_menus office_menus bank PusanmartPayments; do
  run -e "TRUNCATE TABLE \`$table\`"
  files=""
  for file in "$DUMPS/$table.sql" "$DUMPS/${table}"_part*.sql; do
    [ -f "$file" ] && files="$files $file"
  done
  [ -n "$files" ] || continue
  # The dumps are PostgreSQL-flavoured and contain a few cut-off rows: convert to one
  # INSERT per row so broken rows are skipped instead of failing the whole table.
  # shellcheck disable=SC2086
  { echo "SET NAMES utf8mb4; SET autocommit=0;"; python3 -I "$HERE/dump_rows.py" $files; echo "COMMIT;"; } | run
  echo "$table: $(run -N -e "SELECT COUNT(*) FROM \`$table\`") rows"
done
