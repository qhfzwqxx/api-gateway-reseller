#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

log() {
  printf '\n\033[1;32m==>\033[0m %s\n' "$1"
}

warn() {
  printf '\033[1;33mWarning:\033[0m %s\n' "$1"
}

die() {
  printf '\033[1;31mError:\033[0m %s\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

if [ ! -f .env ]; then
  die ".env not found. Run deploy.sh first or create .env before predeploy checks."
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

log "Checking Node.js and npm"
command_exists node || die "Node.js 20+ is required."
command_exists npm || die "npm is required."
node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$node_major" -lt 20 ]; then
  die "Node.js 20+ is required. Current version: $(node -v)"
fi

log "Checking required environment"
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is missing."
[ -n "${REDIS_URL:-}" ] || die "REDIS_URL is missing."
[ -n "${JWT_SECRET:-}" ] || die "JWT_SECRET is missing."

if [ -z "${UPSTREAM_KEY_ENCRYPTION_SECRET:-}" ]; then
  warn "UPSTREAM_KEY_ENCRYPTION_SECRET is not set. Existing encrypted upstream keys may be unreadable after key encryption is enabled."
fi

log "Checking database migration status"
set +e
migration_status="$(npx prisma migrate status --schema packages/db/prisma/schema.prisma 2>&1)"
migration_status_code=$?
set -e
printf '%s\n' "$migration_status"
if [ "$migration_status_code" -ne 0 ]; then
  if grep -q "have not yet been applied" <<<"$migration_status" && ! grep -qiE "failed to apply|failed migration" <<<"$migration_status"; then
    warn "Pending migrations detected; deployment will apply them before generating Prisma Client or building artifacts."
  else
    die "Database migration status check failed. Resolve the migration state before deployment."
  fi
fi

if grep -qiE "failed to apply|failed migration|rolled back migration|database schema is not in sync" <<<"$migration_status"; then
  die "Database has a failed or inconsistent migration state. Deployment is blocked."
fi

log "Validating Prisma schema"
npx prisma validate --schema packages/db/prisma/schema.prisma

log "Checking pending migrations for backward compatibility"
node scripts/check-pending-migration-safety.mjs

log "Checking Redis connectivity"
node --input-type=module <<'NODE'
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
});

try {
  await redis.connect();
  const pong = await redis.ping();
  if (pong !== "PONG") {
    throw new Error(`Unexpected Redis ping response: ${pong}`);
  }
} finally {
  redis.disconnect();
}
NODE

log "Predeploy checks passed"
