#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ ! -f .env ]; then
  echo ".env not found. Run deploy.sh first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

mkdir -p backups
timestamp="$(date +%Y%m%d-%H%M%S)"
output="backups/api-gateway-${timestamp}.dump"

database_url_for_pg_dump() {
  node - "$DATABASE_URL" <<'NODE'
const url = new URL(process.argv[2]);
url.searchParams.delete("schema");
process.stdout.write(url.toString());
NODE
}

docker_postgres_running() {
  command -v docker >/dev/null 2>&1 &&
    docker compose ps --status running postgres >/dev/null 2>&1
}

if docker_postgres_running; then
  docker compose exec -T postgres pg_dump -U gateway -d api_gateway --format=custom > "$output"
elif command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$(database_url_for_pg_dump)" --format=custom --file "$output"
else
  echo "pg_dump or a running Docker Compose postgres service is required for backup." >&2
  exit 1
fi

echo "Backup created: $output"
