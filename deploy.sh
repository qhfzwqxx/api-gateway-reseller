#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

MODE="install"
SKIP_DOCKER="false"
RUN_BACKUP="false"
PM2_BIN=""
DEPLOY_LOCK_FILE="/tmp/api-gateway-reseller.deploy.lock"
ARTIFACT_BACKUP_DIR=""
DEPLOY_ROLLBACK_ARMED="false"
PM2_SWITCH_ATTEMPTED="false"

for arg in "$@"; do
  case "$arg" in
    --update)
      MODE="update"
      ;;
    --skip-docker)
      SKIP_DOCKER="true"
      ;;
    --backup)
      RUN_BACKUP="true"
      ;;
    -h|--help)
      cat <<'USAGE'
Usage:
  bash deploy.sh            First deployment or idempotent redeploy
  bash deploy.sh --update   Pull-safe rebuild/migrate/restart flow without database backup
  bash deploy.sh --skip-docker  Do not start bundled Postgres/Redis
  bash deploy.sh --update --backup  Manually create a database backup before migrations
USAGE
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

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

acquire_deploy_lock() {
  if ! command_exists flock; then
    warn "flock is unavailable; concurrent deploy protection is disabled."
    return
  fi

  exec 9>"$DEPLOY_LOCK_FILE"
  flock -n 9 || die "Another deployment is already running. Refusing to overlap releases."
}

ensure_clean_release_tree() {
  if ! command_exists git || [ ! -d .git ]; then
    return
  fi

  local dirty
  dirty="$(git status --porcelain --untracked-files=normal -- \
    apps packages scripts deploy.sh ecosystem.config.cjs package.json package-lock.json tsconfig.base.json)"
  if [ -n "$dirty" ]; then
    printf '%s\n' "$dirty" >&2
    die "Deployment blocked: tracked runtime sources or migrations are uncommitted. Commit or discard them before release."
  fi
}

random_secret() {
  if command_exists openssl; then
    openssl rand -base64 32 | tr -d '\n'
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  fi
}

random_hex() {
  local bytes="${1:-16}"
  if command_exists openssl; then
    openssl rand -hex "$bytes" | tr -d '\n'
  else
    node -e "console.log(require('crypto').randomBytes(Number(process.argv[1])).toString('hex'))" "$bytes"
  fi
}

read_with_default() {
  local prompt="$1"
  local default_value="$2"
  local value

  read -r -p "$prompt [$default_value]: " value || true
  printf '%s' "${value:-$default_value}"
}

origin_from_url() {
  node - "$1" <<'NODE'
try {
  const url = new URL(process.argv[2]);
  console.log(url.origin);
} catch {
  process.exit(1);
}
NODE
}

frontend_origin_from_api_base() {
  local api_base="$1"
  local web_port="$2"

  node - "$api_base" "$web_port" <<'NODE'
try {
  const url = new URL(process.argv[2]);
  url.port = process.argv[3];
  console.log(url.origin);
} catch {
  process.exit(1);
}
NODE
}

detect_server_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "${ip:-SERVER_IP}"
}

resolve_pm2_bin() {
  local candidate npm_prefix npm_bin

  if command_exists pm2; then
    command -v pm2
    return
  fi

  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  if [ -n "$npm_prefix" ]; then
    candidate="${npm_prefix}/bin/pm2"
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  fi

  npm_bin="$(npm bin -g 2>/dev/null || true)"
  if [ -n "$npm_bin" ]; then
    candidate="${npm_bin}/pm2"
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  fi

  return 1
}

require_node() {
  command_exists node || die "Node.js 20+ is required. Install Node first, then rerun deploy.sh."
  command_exists npm || die "npm is required. Install npm first, then rerun deploy.sh."
  command_exists curl || die "curl is required for post-deploy API smoke tests."

  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if [ "$major" -lt 20 ]; then
    die "Node.js 20+ is required. Current version: $(node -v)"
  fi
}

require_docker() {
  if [ "$SKIP_DOCKER" = "true" ]; then
    return
  fi

  command_exists docker || die "Docker is required for bundled Postgres/Redis. Install Docker or use --skip-docker."
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is required. Install it or use --skip-docker."
}

ensure_pm2() {
  if PM2_BIN="$(resolve_pm2_bin)"; then
    log "Using PM2: $PM2_BIN"
    return
  fi

  log "Installing PM2"
  npm install -g pm2

  if PM2_BIN="$(resolve_pm2_bin)"; then
    log "Using PM2: $PM2_BIN"
    return
  fi

  die "PM2 was installed, but the pm2 binary was not found. Check npm global bin path: $(npm prefix -g 2>/dev/null || echo unknown)/bin"
}

write_env_file() {
  if [ -f .env ]; then
    log ".env already exists; keeping it"
    return
  fi

  log "Creating .env"
  local postgres_password jwt_secret admin_email admin_username admin_password api_port web_port server_host default_api_base api_base web_base security_skill_root frontend_origin cors_origins

  postgres_password="$(random_hex 16)"
  jwt_secret="$(random_secret)"

  admin_email="$(read_with_default "Admin email" "admin@example.com")"
  admin_username="$(read_with_default "Admin username" "admin")"
  admin_password="$(read_with_default "Admin password" "$(random_hex 8)")"
  api_port="$(read_with_default "API port" "4100")"
  web_port="$(read_with_default "Web port" "4101")"
  server_host="$(read_with_default "Server public IP or domain" "$(detect_server_ip)")"
  default_api_base="http://${server_host}:${api_port}"
  warn "For public access, use the server public IP/domain here, not 127.0.0.1."
  api_base="$(read_with_default "Public API base URL" "$default_api_base")"
  web_base="$api_base"
  security_skill_root="${api_base%/}/security-research/current"
  frontend_origin="$(frontend_origin_from_api_base "$api_base" "$web_port" || printf 'http://127.0.0.1:%s' "$web_port")"
  cors_origins="http://127.0.0.1:${web_port},http://localhost:${web_port},${frontend_origin}"

  cat > .env <<ENV
POSTGRES_PASSWORD="${postgres_password}"
DATABASE_URL="postgresql://gateway:${postgres_password}@127.0.0.1:55432/api_gateway?schema=public"
REDIS_URL="redis://127.0.0.1:56379"

API_PORT=${api_port}
API_HOST="0.0.0.0"
PUBLIC_API_BASE_URL="${api_base}"
SECURITY_RESEARCH_SKILL_PUBLIC_ROOT="${security_skill_root}"
CORS_ORIGINS="${cors_origins}"

WEB_PORT=${web_port}
NEXT_PUBLIC_API_BASE_URL="${web_base}"

JWT_SECRET="${jwt_secret}"
ADMIN_EMAIL="${admin_email}"
ADMIN_USERNAME="${admin_username}"
ADMIN_PASSWORD="${admin_password}"

UPSTREAM_BASE_URL="https://api.openai.com"
UPSTREAM_API_KEY=""
UPSTREAM_TIMEOUT_MS=120000
MODEL_POOL_HEALTH_INTERVAL_SECONDS=30
MODEL_POOL_PENALTY_SECONDS=60

DEFAULT_CURRENCY="USD"
ENV

  chmod 600 .env
  printf '\nAdmin login:\n  username: %s\n  email: %s\n  password: %s\n' "$admin_username" "$admin_email" "$admin_password"
}

load_env() {
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
}

warn_public_url_config() {
  local public_api_base_url="${PUBLIC_API_BASE_URL:-}"
  local next_public_api_base_url="${NEXT_PUBLIC_API_BASE_URL:-}"

  if [[ "$public_api_base_url" == *"127.0.0.1"* || "$public_api_base_url" == *"localhost"* ]]; then
    warn "PUBLIC_API_BASE_URL is local-only. For public access, set it to your server IP/domain, for example http://YOUR_SERVER_IP:${API_PORT:-4100}."
  fi

  if [[ "$next_public_api_base_url" == *"127.0.0.1"* || "$next_public_api_base_url" == *"localhost"* ]]; then
    warn "NEXT_PUBLIC_API_BASE_URL is local-only. Browsers on other machines need your public API URL."
  fi
}

start_infra() {
  if [ "$SKIP_DOCKER" = "true" ]; then
    warn "Skipping Docker services. Make sure DATABASE_URL and REDIS_URL point to running services."
    return
  fi

  log "Starting Postgres and Redis"
  docker compose --env-file .env up -d postgres redis
}

wait_for_postgres() {
  if [ "$SKIP_DOCKER" = "true" ]; then
    return
  fi

  log "Waiting for Postgres"
  for _ in $(seq 1 60); do
    if docker compose exec -T postgres pg_isready -U gateway -d api_gateway >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done

  die "Postgres did not become ready in time."
}

install_dependencies() {
  log "Installing npm dependencies"
  npm install
}

apply_database_migrations() {
  log "Applying database migrations before building or restarting services"
  npm run db:migrate:deploy

  log "Verifying database migration status"
  local migration_status
  if ! migration_status="$(npx prisma migrate status --schema packages/db/prisma/schema.prisma 2>&1)"; then
    printf '%s\n' "$migration_status" >&2
    die "Database migrations did not reach a healthy state. The running API was not restarted."
  fi
  printf '%s\n' "$migration_status"
}

snapshot_runtime_artifacts() {
  ARTIFACT_BACKUP_DIR="$(mktemp -d /tmp/api-gateway-reseller-release.XXXXXX)"
  log "Snapshotting current runtime artifacts"

  for artifact in apps/api/dist packages/db/dist apps/web/.next node_modules/.prisma/client node_modules/@prisma/client; do
    if [ -e "$artifact" ]; then
      mkdir -p "$ARTIFACT_BACKUP_DIR/$(dirname "$artifact")"
      cp -a "$artifact" "$ARTIFACT_BACKUP_DIR/$artifact"
    fi
  done
}

restore_runtime_artifacts() {
  if [ -z "$ARTIFACT_BACKUP_DIR" ]; then
    return
  fi

  warn "Restoring the previous runtime artifacts"
  for artifact in apps/api/dist packages/db/dist apps/web/.next node_modules/.prisma/client node_modules/@prisma/client; do
    rm -rf "$artifact"
    if [ -e "$ARTIFACT_BACKUP_DIR/$artifact" ]; then
      mkdir -p "$(dirname "$artifact")"
      cp -a "$ARTIFACT_BACKUP_DIR/$artifact" "$artifact"
    fi
  done
}

cleanup_runtime_snapshot() {
  if [ -n "$ARTIFACT_BACKUP_DIR" ]; then
    rm -rf "$ARTIFACT_BACKUP_DIR"
    ARTIFACT_BACKUP_DIR=""
  fi
}

handle_release_error() {
  local status="$1"
  trap - ERR

  if [ "$DEPLOY_ROLLBACK_ARMED" = "true" ]; then
    restore_runtime_artifacts
    if [ "$PM2_SWITCH_ATTEMPTED" = "true" ]; then
      PROJECT_ROOT="$PROJECT_ROOT" "$PM2_BIN" startOrReload ecosystem.config.cjs --update-env || true
    fi
    cleanup_runtime_snapshot
  fi

  exit "$status"
}

build_artifacts() {
  log "Generating Prisma client after migrations"
  SAFE_RELEASE_BUILD=1 npm run db:generate

  log "Syncing Security Research Skill mirror"
  npm run sync:security-research-skill
  npm run verify:security-research-skill

  log "Building API and web"
  SAFE_RELEASE_BUILD=1 npm run build
}

run_api_smoke_tests() {
  local base_url="$1"
  local health_code root_code auth_settings_code wallet_code models_code

  health_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$base_url/health")"
  root_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$base_url/")"
  auth_settings_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$base_url/auth/settings")"
  wallet_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$base_url/wallet")"
  models_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$base_url/v1/models")"

  if [ "$health_code" != "200" ] || [ "$root_code" != "200" ] || [ "$auth_settings_code" != "200" ] || [ "$wallet_code" != "401" ] || [ "$models_code" != "401" ]; then
    printf 'Smoke tests failed: health=%s root=%s auth_settings=%s wallet=%s models=%s\n' \
      "$health_code" "$root_code" "$auth_settings_code" "$wallet_code" "$models_code" >&2
    return 1
  fi
}

validate_candidate_api() {
  local candidate_port candidate_pid candidate_log ready
  candidate_port="$(( ${API_PORT:-4100} + 1000 ))"
  candidate_log="$(mktemp /tmp/api-gateway-candidate.XXXXXX.log)"
  ready="false"

  log "Starting candidate API on 127.0.0.1:${candidate_port}"
  DEPLOY_SMOKE_TEST="true" API_HOST="127.0.0.1" API_PORT="$candidate_port" \
    node apps/api/dist/server.js >"$candidate_log" 2>&1 &
  candidate_pid=$!

  for _ in $(seq 1 30); do
    if ! kill -0 "$candidate_pid" >/dev/null 2>&1; then
      break
    fi
    if curl -fsS --max-time 2 "http://127.0.0.1:${candidate_port}/health" >/dev/null 2>&1; then
      ready="true"
      break
    fi
    sleep 1
  done

  if [ "$ready" = "true" ]; then
    run_api_smoke_tests "http://127.0.0.1:${candidate_port}" || ready="false"
  fi

  kill "$candidate_pid" >/dev/null 2>&1 || true
  wait "$candidate_pid" >/dev/null 2>&1 || true

  if [ "$ready" != "true" ]; then
    cat "$candidate_log" >&2
    rm -f "$candidate_log"
    return 1
  fi

  rm -f "$candidate_log"
  log "Candidate API passed database compatibility and smoke tests"
}

run_predeploy_checks() {
  if [ "$MODE" != "update" ]; then
    return
  fi

  log "Running predeploy checks"
  bash scripts/predeploy-check.sh
}

backup_before_migrate() {
  if [ "$MODE" != "update" ]; then
    return
  fi

  if [ "$RUN_BACKUP" != "true" ]; then
    warn "Skipping migration backup by default. Pass --backup to create one."
    return
  fi

  log "Creating database backup before migrations"
  bash scripts/backup-db.sh
}

seed_data() {
  log "Seeding blank deployment data"
  npm run db:seed
}

start_pm2() {
  log "Starting PM2 apps"
  PM2_SWITCH_ATTEMPTED="true"
  PROJECT_ROOT="$PROJECT_ROOT" "$PM2_BIN" startOrReload ecosystem.config.cjs --update-env

  log "Waiting for API health"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT:-4100}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if ! curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT:-4100}/health" >/dev/null 2>&1; then
    printf 'API health check failed after release.\n' >&2
    return 1
  fi

  log "Running API smoke tests"
  run_api_smoke_tests "http://127.0.0.1:${API_PORT:-4100}"

  "$PM2_BIN" save
  DEPLOY_ROLLBACK_ARMED="false"
  PM2_SWITCH_ATTEMPTED="false"
  cleanup_runtime_snapshot
  trap - ERR
}

print_summary() {
  local web_port api_port admin_username admin_email
  web_port="${WEB_PORT:-4101}"
  api_port="${API_PORT:-4100}"
  admin_username="${ADMIN_USERNAME:-admin}"
  admin_email="${ADMIN_EMAIL:-admin@example.com}"

  cat <<SUMMARY

Deployment complete.

Web:
  http://SERVER_IP:${web_port}

API:
  http://SERVER_IP:${api_port}

Admin login:
  username: ${admin_username}
  email: ${admin_email}

Useful commands:
  ${PM2_BIN:-pm2} status
  ${PM2_BIN:-pm2} logs api-gateway-api
  ${PM2_BIN:-pm2} logs api-gateway-web
  bash deploy.sh --update

Next step:
  Log in to the admin panel, add upstream providers, add model prices, then create model pools.
SUMMARY
}

main() {
  log "Checking runtime"
  require_node
  require_docker
  acquire_deploy_lock
  ensure_pm2
  ensure_clean_release_tree

  write_env_file
  load_env
  warn_public_url_config
  start_infra
  wait_for_postgres
  install_dependencies
  run_predeploy_checks
  backup_before_migrate
  apply_database_migrations
  snapshot_runtime_artifacts
  DEPLOY_ROLLBACK_ARMED="true"
  trap 'handle_release_error $?' ERR
  build_artifacts
  seed_data
  validate_candidate_api
  start_pm2
  print_summary
}

main
