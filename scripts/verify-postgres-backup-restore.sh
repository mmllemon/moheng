#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DB="moheng_test"
RESTORE_DB="moheng_restore"
: "$DATABASE_URL"
: "$PGHOST"
: "$PGPORT"
: "$PGUSER"
: "$PGPASSWORD"

# Hard guard: this rehearsal is only allowed against the disposable local CI database.
node --input-type=module <<'NODE'
const url = new URL(process.env.DATABASE_URL);
const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
const safeHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (!safeHosts.has(url.hostname) ||
    database !== 'moheng_test' ||
    url.username !== 'postgres' ||
    Number(url.port || 5432) !== 5432 ||
    process.env.PGHOST !== '127.0.0.1' ||
    process.env.PGUSER !== 'postgres' ||
    process.env.PGPORT !== '5432') {
  throw new Error('Refusing backup/restore rehearsal outside the disposable loopback moheng_test database.');
}
console.log('PASS database safety guard: disposable loopback database only');
NODE

for command in pg_dump pg_restore psql createdb dropdb sha256sum; do
  command -v "$command" >/dev/null || { echo "Missing required PostgreSQL utility: $command" >&2; exit 1; }
done

REPORT_PATH="$BACKUP_RESTORE_REPORT_PATH"
mkdir -p "$(dirname "$REPORT_PATH")"
TEMP_DIR="$(mktemp -d)"
cleanup() {
  dropdb --if-exists "$RESTORE_DB" >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

TABLE_LIST_SQL="SELECT format('%I.%I', table_schema, table_name) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"

assert_fixture() {
  local database_name="$1"
  local description="$2"
  local sql="$3"
  local actual
  actual="$(psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --dbname="$database_name" --command="$sql")"
  if [[ "$actual" != "t" ]]; then
    printf 'FAIL fixture assertion (%s) in %s; got=%s\n' "$description" "$database_name" "$actual" >&2
    return 1
  fi
  printf 'PASS fixture assertion (%s) in %s\n' "$description" "$database_name"
}

table_manifest() {
  local database_name="$1"
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --dbname="$database_name" --command="$TABLE_LIST_SQL" | sed '/^[[:space:]]*$/d'
}

table_content_hash() {
  local database_name="$1"
  local qualified_table="$2"
  local sql
  sql="SELECT md5(COALESCE(string_agg(row_data, E'\n' ORDER BY row_data), '')) FROM (SELECT to_jsonb(t)::text AS row_data FROM $qualified_table AS t) AS backup_rows"
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --dbname="$database_name" --command="$sql" | tr -d '[:space:]'
}

assert_fixture "$SOURCE_DB" "demo project exists" \
  "SELECT (SELECT count(*) FROM \"Project\" WHERE code = 'DEMO-001') = 1"
assert_fixture "$SOURCE_DB" "main contract exists" \
  "SELECT (SELECT count(*) FROM \"MainContract\" c JOIN \"Project\" p ON p.id = c.\"projectId\" WHERE p.code = 'DEMO-001' AND c.amount::text LIKE '12580000%') = 1"
assert_fixture "$SOURCE_DB" "six budget items exist" \
  "SELECT (SELECT count(*) FROM \"BudgetItem\" b JOIN \"Project\" p ON p.id = b.\"projectId\" WHERE p.code = 'DEMO-001') >= 6"
assert_fixture "$SOURCE_DB" "material and labor cost entries exist" \
  "SELECT (SELECT count(*) FROM \"CostEntry\" c JOIN \"Project\" p ON p.id = c.\"projectId\" WHERE p.code = 'DEMO-001') >= 2"
assert_fixture "$SOURCE_DB" "progress bill exists" \
  "SELECT (SELECT count(*) FROM \"ProgressBill\" b JOIN \"Project\" p ON p.id = b.\"projectId\" WHERE p.code = 'DEMO-001') = 1"
assert_fixture "$SOURCE_DB" "change record exists" \
  "SELECT (SELECT count(*) FROM \"Change\" c JOIN \"Project\" p ON p.id = c.\"projectId\" WHERE p.code = 'DEMO-001') = 1"

# A PostgreSQL custom-format logical dump is restorable and does not depend on the live source DB afterward.
pg_dump --format=custom --no-owner --no-acl --file="$TEMP_DIR/moheng.dump" --dbname="$SOURCE_DB"
pg_restore --list "$TEMP_DIR/moheng.dump" > "$TEMP_DIR/archive.list"
test -s "$TEMP_DIR/archive.list"
DUMP_SHA256="$(sha256sum "$TEMP_DIR/moheng.dump" | awk '{print $1}')"

dropdb --if-exists "$RESTORE_DB"
createdb "$RESTORE_DB"
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$RESTORE_DB" "$TEMP_DIR/moheng.dump"

source_tables="$(table_manifest "$SOURCE_DB")"
restored_tables="$(table_manifest "$RESTORE_DB")"
if [[ "$source_tables" != "$restored_tables" ]]; then
  echo "FAIL public table manifest differs after restore" >&2
  diff -u <(printf '%s\n' "$source_tables") <(printf '%s\n' "$restored_tables") || true
  exit 1
fi

table_count="$(printf '%s\n' "$source_tables" | wc -l | tr -d ' ')"
while IFS= read -r table_name; do
  [[ -n "$table_name" ]] || continue
  source_hash="$(table_content_hash "$SOURCE_DB" "$table_name")"
  restored_hash="$(table_content_hash "$RESTORE_DB" "$table_name")"
  if [[ "$source_hash" != "$restored_hash" ]]; then
    printf 'FAIL row-content hash mismatch for %s\n' "$table_name" >&2
    exit 1
  fi
done <<< "$source_tables"
printf 'PASS logical restore preserved all %s public base tables and their canonical row-content hashes\n' "$table_count"

assert_fixture "$RESTORE_DB" "demo project survives restore" \
  "SELECT (SELECT count(*) FROM \"Project\" WHERE code = 'DEMO-001') = 1"
assert_fixture "$RESTORE_DB" "main contract survives restore" \
  "SELECT (SELECT count(*) FROM \"MainContract\" c JOIN \"Project\" p ON p.id = c.\"projectId\" WHERE p.code = 'DEMO-001' AND c.amount::text LIKE '12580000%') = 1"
assert_fixture "$RESTORE_DB" "budget items survive restore" \
  "SELECT (SELECT count(*) FROM \"BudgetItem\" b JOIN \"Project\" p ON p.id = b.\"projectId\" WHERE p.code = 'DEMO-001') >= 6"
assert_fixture "$RESTORE_DB" "cost entries survive restore" \
  "SELECT (SELECT count(*) FROM \"CostEntry\" c JOIN \"Project\" p ON p.id = c.\"projectId\" WHERE p.code = 'DEMO-001') >= 2"
assert_fixture "$RESTORE_DB" "progress bill survives restore" \
  "SELECT (SELECT count(*) FROM \"ProgressBill\" b JOIN \"Project\" p ON p.id = b.\"projectId\" WHERE p.code = 'DEMO-001') = 1"
assert_fixture "$RESTORE_DB" "change record survives restore" \
  "SELECT (SELECT count(*) FROM \"Change\" c JOIN \"Project\" p ON p.id = c.\"projectId\" WHERE p.code = 'DEMO-001') = 1"
assert_fixture "$RESTORE_DB" "successful Prisma migration ledger survives restore" \
  "SELECT count(*) > 0 FROM public.\"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"

{
  printf 'gate=POSTGRES_LOGICAL_BACKUP_RESTORE\n'
  printf 'result=PASS\n'
  printf 'source_database=%s\n' "$SOURCE_DB"
  printf 'restore_database=%s\n' "$RESTORE_DB"
  printf 'public_base_tables_verified=%s\n' "$table_count"
  printf 'row_content_validation=canonical-jsonb-md5-per-table\n'
  printf 'demo_fixture=project,main-contract,budget,cost,progress-bill,change\n'
  printf 'migration_ledger=present\n'
  printf 'dump_sha256=%s\n' "$DUMP_SHA256"
  printf 'scope=isolated-postgresql-16-ci-fixture-not-production-restore\n'
} | tee "$REPORT_PATH"

echo "PASS PostgreSQL backup/restore rehearsal"
