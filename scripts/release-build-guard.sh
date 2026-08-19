#!/usr/bin/env bash
set -euo pipefail

if [ "${SAFE_RELEASE_BUILD:-}" = "1" ]; then
  exit 0
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v pm2 >/dev/null 2>&1; then
  exit 0
fi

if pm2 jlist 2>/dev/null | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const apps = JSON.parse(input);
    const projectRoot = process.argv[1];
    const live = apps.some((app) =>
      app?.name === "api-gateway-api" &&
      ["online", "launching", "waiting restart"].includes(app?.pm2_env?.status) &&
      app?.pm2_env?.pm_cwd === projectRoot
    );
    process.exit(live ? 0 : 1);
  } catch {
    process.exit(1);
  }
});
' "$PROJECT_ROOT"
then
  cat >&2 <<'MESSAGE'
Build blocked: this directory is serving the production API.
Do not run build, Prisma generate, or typecheck directly here because they replace shared runtime artifacts.
Use `bash deploy.sh --update --backup` for a release, or validate in an isolated git worktree.
MESSAGE
  exit 41
fi
