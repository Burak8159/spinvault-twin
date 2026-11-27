#!/usr/bin/env bash
# Start and supervise the local Twin API, static tools, and evidence workspace.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="127.0.0.1"
API_PORT="${SPINVAULT_API_PORT:-8001}"
WEB_PORT="${SPINVAULT_WEB_PORT:-4191}"
NEXT_PORT="${SPINVAULT_NEXT_PORT:-3000}"
NEXT_MODE="${SPINVAULT_NEXT_MODE:-production}"
NEXT_BIN="$REPO_ROOT/apps/simulator/node_modules/.bin/next"
STACK_PID=""
NEXT_PID=""
EVIDENCE_STATUS="not configured; evidence comparisons will be unavailable"
REVIEW_KEY_STATUS="not configured; observations cannot qualify as reviewed"
ACCEPTANCE_POLICY_STATUS="not configured; same-cycle gate checks will be unavailable"

if [ -n "${SPINVAULT_REQUIREMENT_EVIDENCE_ROOT:-}" ] && [ -d "$SPINVAULT_REQUIREMENT_EVIDENCE_ROOT" ]; then
  EVIDENCE_STATUS="configured private evidence folder"
fi
if [ -n "${SPINVAULT_EVIDENCE_SIGNING_KEY_FILE:-}" ] && [ -r "$SPINVAULT_EVIDENCE_SIGNING_KEY_FILE" ]; then
  REVIEW_KEY_STATUS="configured; each review signature is still verified per record"
fi
if [ -n "${SPINVAULT_ACCEPTANCE_POLICY_FILE:-}" ] && [ -r "$SPINVAULT_ACCEPTANCE_POLICY_FILE" ]; then
  ACCEPTANCE_POLICY_STATUS="configured; runtime semantics and each gate still require validation"
fi

die() {
  echo "error: $*" >&2
  exit 1
}

port_owner() {
  { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true; } | head -1
}

require_free_port() {
  local port="$1" label="$2" owner
  owner="$(port_owner "$port")"
  [ -z "$owner" ] && return 0
  die "$label port $port is already in use by pid $owner. Stop that process or set SPINVAULT_${label}_PORT to a free port."
}

cleanup() {
  trap - EXIT INT TERM
  echo
  echo "shutting down the SpinVault Twin workspace"
  if [ -n "$NEXT_PID" ]; then
    kill -TERM "$NEXT_PID" 2>/dev/null || true
  fi
  if [ -n "$STACK_PID" ]; then
    kill -TERM "$STACK_PID" 2>/dev/null || true
  fi
  [ -z "$NEXT_PID" ] || wait "$NEXT_PID" 2>/dev/null || true
  [ -z "$STACK_PID" ] || wait "$STACK_PID" 2>/dev/null || true
}

wait_for_url() {
  local url="$1" label="$2" attempts="$3" i
  for ((i=1; i<=attempts; i++)); do
    curl -fsS -m 3 "$url" >/dev/null 2>&1 && return 0
    if [ -n "$STACK_PID" ] && ! kill -0 "$STACK_PID" 2>/dev/null; then
      die "the API/static server exited during startup."
    fi
    if [ -n "$NEXT_PID" ] && ! kill -0 "$NEXT_PID" 2>/dev/null; then
      die "the evidence workspace exited during startup."
    fi
    sleep 0.5
  done
  die "$label did not become ready at $url."
}

command -v curl >/dev/null 2>&1 || die "curl is required."
command -v lsof >/dev/null 2>&1 || die "lsof is required for safe port checks."
command -v python3 >/dev/null 2>&1 || die "python3 is required to validate private evidence storage."
[ -x "$NEXT_BIN" ] || die "Next.js dependencies are not installed. Run 'npm ci' in apps/simulator, then retry. No packages were installed automatically."
case "$NEXT_MODE" in
  production) command -v npm >/dev/null 2>&1 || die "npm is required to build the local evidence workspace." ;;
  development) ;;
  *) die "SPINVAULT_NEXT_MODE must be 'production' or 'development'." ;;
esac

if [ -n "${SPINVAULT_REQUIREMENT_EVIDENCE_ROOT:-}" ]; then
  python3 "$REPO_ROOT/scripts/check_private_evidence_root.py" \
    "$SPINVAULT_REQUIREMENT_EVIDENCE_ROOT" \
    "$REPO_ROOT/apps/website" "$REPO_ROOT/apps/simulator/public" ||
    die "requirement evidence must live outside the static website and simulator public directories."
fi

require_free_port "$API_PORT" API
require_free_port "$WEB_PORT" WEB
require_free_port "$NEXT_PORT" NEXT

trap cleanup EXIT INT TERM

echo "starting the Twin API and static tools"
SPINVAULT_NO_BROWSER=true "$REPO_ROOT/scripts/run_local.sh" &
STACK_PID=$!
wait_for_url "http://$HOST:$API_PORT/health" "Twin API" 120
wait_for_url "http://$HOST:$WEB_PORT/simulator.html" "static simulator" 20

echo "starting the evidence workspace"
(
  cd "$REPO_ROOT/apps/simulator"
  export SPINVAULT_TWIN_API_URL="http://$HOST:$API_PORT"
  export SPINVAULT_TWIN_WEB_URL="http://$HOST:$WEB_PORT"
  if [ "$NEXT_MODE" = "production" ]; then
    echo "building the evidence workspace for production mode"
    npm run build
    exec "$NEXT_BIN" start --hostname "$HOST" --port "$NEXT_PORT"
  fi
  exec "$NEXT_BIN" dev --hostname "$HOST" --port "$NEXT_PORT"
) &
NEXT_PID=$!
if [ "$NEXT_MODE" = "production" ]; then
  wait_for_url "http://$HOST:$NEXT_PORT/" "evidence workspace" 600
else
  wait_for_url "http://$HOST:$NEXT_PORT/" "evidence workspace" 120
fi

cat <<EOF

  SpinVault Twin workspace is running locally.

    Workspace overview  http://$HOST:$NEXT_PORT/
  Mode                $NEXT_MODE
    Simulator           http://$HOST:$WEB_PORT/simulator.html
    Project records     http://$HOST:$WEB_PORT/project_records.html
    Requirements        http://$HOST:$WEB_PORT/requirements.html
    API health          http://$HOST:$API_PORT/health
    Evidence folder     $EVIDENCE_STATUS
    Review key          $REVIEW_KEY_STATUS
    Same-cycle policy   $ACCEPTANCE_POLICY_STATUS
    Evidence setup      docs/LOCAL_EVIDENCE_CONFIGURATION.md

  Press Ctrl+C to stop the workspace and its local services.

EOF

while kill -0 "$STACK_PID" 2>/dev/null && kill -0 "$NEXT_PID" 2>/dev/null; do
  sleep 1
done
die "a workspace service stopped unexpectedly."
