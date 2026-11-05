#!/usr/bin/env bash
# Прогон на ЖИВОМ PostgreSQL: то, что обычно проверяется на встроенной PGlite.
#
# Зачем: PGlite — это тот же PostgreSQL внутри процесса, но не тот же протокол,
# не те же права, не тот же SSL. Ошибки в строке подключения, TLS и настоящих
# типах ловятся только здесь.
#
# Что делает скрипт:
#   1. поднимает встроенный PostgreSQL 18 (пакет embedded-postgres) на 55432;
#   2. создаёт ОТДЕЛЬНУЮ базу под каждый тест — тесты пишут данные и требуют
#      чистого состояния, поэтому общая база их ломает;
#   3. гоняет флоу, перезапуск, миграцию меток и production-сборку;
#   4. гасит сервер и удаляет временный каталог.
#
# Требования: Node 22+, установленный `embedded-postgres` и `pg` в репозитории.
# Может работать и против своего сервера: GIB_LIVE_URL=postgres://... ./scripts/postgres-live-check.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${GIB_LIVE_PORT:-55432}"
USER_NAME="${GIB_LIVE_USER:-gib}"
PASSWORD="${GIB_LIVE_PASSWORD:-gib}"
DATA_DIR="${GIB_LIVE_DIR:-$(mktemp -d)/pg}"
CREATED=()
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

admin_url() { echo "postgres://${USER_NAME}:${PASSWORD}@127.0.0.1:${PORT}/postgres"; }

create_db() {
  local name="$1"
  node -e '
    const pg = require("pg");
    (async () => {
      const client = new pg.Client({ connectionString: process.argv[1], ssl: false });
      await client.connect();
      // Каждый прогон получает ЧИСТУЮ базу: тесты пишут профили и на грязной
      // базе падают на повторной идентичности, а не на проверяемом поведении.
      try { await client.query("DROP DATABASE IF EXISTS " + process.argv[2] + " WITH (FORCE)"); } catch {}
      await client.query("CREATE DATABASE " + process.argv[2]);
      await client.end();
    })().catch((error) => { console.error("create failed:", error.message); process.exit(1); });
  ' "$(admin_url)" "$name"
  CREATED+=("$name")
}

if [ -n "${GIB_LIVE_URL:-}" ]; then
  echo "== используется внешний сервер: ${GIB_LIVE_URL%%\?*}"
  BASE_URL="${GIB_LIVE_URL}"
else
  echo "== поднимаю встроенный PostgreSQL в $DATA_DIR"
  mkdir -p "$(dirname "$DATA_DIR")"
  cat > "$DATA_DIR.config.mjs" <<'CONFIG'
import EmbeddedPostgres from 'embedded-postgres';
const [dir, user, password, port] = process.argv.slice(2);
const pg = new EmbeddedPostgres({ databaseDir: dir, user, password, port: Number(port), persistent: true });
await pg.initialise().catch(() => {});   // каталог мог остаться с прошлого запуска
await pg.start();
console.log('POSTGRES_READY');
process.on('SIGTERM', async () => { await pg.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
CONFIG
  node "$DATA_DIR.config.mjs" "$DATA_DIR" "$USER_NAME" "$PASSWORD" "$PORT" > "$DATA_DIR.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 60); do
    grep -q POSTGRES_READY "$DATA_DIR.log" 2>/dev/null && break
    sleep 1
  done
  grep -q POSTGRES_READY "$DATA_DIR.log" || { echo "сервер не поднялся"; tail -20 "$DATA_DIR.log"; exit 1; }
  BASE_URL="postgres://${USER_NAME}:${PASSWORD}@127.0.0.1:${PORT}"
fi

fail=0
run() {
  local title="$1"; shift
  echo
  echo "== $title"
  if "$@"; then echo "   OK"; else echo "   ПРОВАЛ"; fail=1; fi
}

# 1. Флоу и перезапуск: пишут профили, поэтому своя база на каждый.
create_db gib_live_store
run "флоу, перезапуск, идемпотентность схемы" \
  env GIB_POSTGRES_URL="$BASE_URL/gib_live_store" GIB_STORE=postgres \
  node_modules/.bin/tsx scripts/test-postgres-store.ts

# 2. Миграция меток. Схему сначала создаём так же, как приложение при первом
#    старте: проверяем, что миграция работает на реальной структуре, а не на
#    пустой базе.
create_db gib_live_cleanup
run "миграция меток в отдельную схему" \
  env GIB_POSTGRES_URL="$BASE_URL/gib_live_cleanup" \
  bash -c '
    set -e
    node_modules/.bin/tsx -e "
      import { openDetachedBridge, ensureSchemaSync } from \"./lib/postgres/state-backend.ts\";
      import { SCHEMA_V1, SCHEMA_V2 } from \"./lib/postgres/schema.ts\";
      const b = openDetachedBridge(process.env);
      ensureSchemaSync(b, { v1: SCHEMA_V1, v2: SCHEMA_V2 });
      b.close();
    "
    node_modules/.bin/tsx scripts/clean-story-quality.ts --dry-run --postgres > /dev/null
    node_modules/.bin/tsx scripts/clean-story-quality.ts --copy --postgres gib_cleaned > /dev/null
    node_modules/.bin/tsx -e "
      import { openDetachedBridge, readState } from \"./lib/postgres/state-backend.ts\";
      const b = openDetachedBridge(process.env);
      const copy = readState(b, \"gib_cleaned\");
      b.close();
      const keys = Object.keys(copy).length;
      if (keys !== 11) throw new Error(\"копия неполная: \" + keys);
      console.log(\"   копия читается, коллекций:\", keys);
    "
  '

# 3. Production-сборка: настоящий `next start` на живом сервере.
if [ -f .next/BUILD_ID ]; then
  create_db gib_live_prod
  run "production-сборка на живом PostgreSQL" \
    env GIB_POSTGRES_URL="$BASE_URL/gib_live_prod" GIB_POSTGRES_INSECURE_TEST=1 \
    node_modules/.bin/tsx scripts/test-postgres-prod.ts
else
  echo
  echo "== production-сборка пропущена: нет .next/BUILD_ID (сначала npm run build)"
fi

echo
echo "== базы, созданные прогоном: ${CREATED[*]:-нет}"
echo "   Это отдельный сервер, а не рабочая база: удалять его целиком безопасно."
if [ "$fail" -ne 0 ]; then
  echo "== ЕСТЬ ПРОВАЛЫ"
  exit 1
fi
echo "== все проверки на живом PostgreSQL пройдены"
