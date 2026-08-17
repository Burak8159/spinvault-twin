#!/usr/bin/env bash
# Start the whole SpinVault Twin stack on this machine: Twin API + solver worker
# + static website. No cloud services and no external network access are used.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="127.0.0.1"
API_PORT="${SPINVAULT_API_PORT:-8001}"
WEB_PORT="${SPINVAULT_WEB_PORT:-4191}"
VENV="$REPO_ROOT/backend/.venv"
PYTHON="$VENV/bin/python"

die() {
  echo "error: $*" >&2
  exit 1
}

port_owner() {
  # lsof exits nonzero when nothing is listening, which is the normal case here.
  { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true; } | head -1
}

require_free_port() {
  local port="$1" label="$2" owner
  owner="$(port_owner "$port")"
  [ -z "$owner" ] && return 0
  die "$label port $port is already in use by pid $owner.
  Stop that process with 'kill $owner', or choose free ports, for example:
  SPINVAULT_API_PORT=8055 SPINVAULT_WEB_PORT=4455 scripts/run_local.sh"
}

command -v python3 >/dev/null 2>&1 || die "python3 is required but was not found on PATH."
require_free_port "$API_PORT" "API"
require_free_port "$WEB_PORT" "website"

if [ ! -x "$PYTHON" ]; then
  echo "setup: creating virtualenv at backend/.venv"
  python3 -m venv "$VENV"
fi

# Installing needs the network, so only do it when a dependency is actually
# missing. A provisioned venv then starts fully offline.
if ! "$PYTHON" -c 'import fastapi, pydantic_settings, uvicorn' >/dev/null 2>&1; then
  echo "setup: installing backend dependencies (needs network once)"
  "$PYTHON" -m pip install --disable-pip-version-check -r "$REPO_ROOT/backend/requirements.txt" ||
    die "dependency install failed. Fix the pip error above, then re-run."
fi

API_PID=""
WEB_PID=""
cleanup() {
  trap - EXIT INT TERM
  echo
  echo "shutting down local stack"
  for pid in "$API_PID" "$WEB_PID"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# SPINVAULT_WORKER_ENABLED keeps the solver worker in the API process, so a
# submitted job is executed here instead of sitting queued forever.
echo "api: starting Twin API on http://$HOST:$API_PORT"
(
  cd "$REPO_ROOT/backend"
  SPINVAULT_WORKER_ENABLED=true exec "$PYTHON" -m uvicorn app.main:app --host "$HOST" --port "$API_PORT"
) &
API_PID=$!

echo "website: starting static server on http://$HOST:$WEB_PORT"
"$PYTHON" "$REPO_ROOT/scripts/serve_website.py" --host "$HOST" --port "$WEB_PORT" &
WEB_PID=$!

printf 'waiting for the API to report healthy'
for _ in $(seq 1 60); do
  if curl -fsS -m 2 "http://$HOST:$API_PORT/health" >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  kill -0 "$API_PID" 2>/dev/null || die "the API process exited during startup (see the log above)."
  printf '.'
  sleep 0.5
done

curl -fsS -m 2 "http://$HOST:$API_PORT/health" >/dev/null 2>&1 ||
  die "the API did not become healthy on http://$HOST:$API_PORT."

SOLVERS="$(curl -fsS -m 5 "http://$HOST:$API_PORT/api/solvers" 2>/dev/null || true)"
case "$SOLVERS" in
  *'"pythonLlg":{"configured":true'*) LLG="ready (CPU macrospin LLG on this machine)" ;;
  *) LLG="NOT configured" ;;
esac

cat <<EOF

  SpinVault Twin is running locally.

    simulator   http://$HOST:$WEB_PORT/simulator.html
    website     http://$HOST:$WEB_PORT/index.html
    API health  http://$HOST:$API_PORT/health
    API docs    http://$HOST:$API_PORT/docs

    python_llg  $LLG
    mumax3      only runs when MUMAX3_BINARY points at a local binary

  The simulator defaults to http://localhost:8001 for the API. On a non-default
  port, open: http://$HOST:$WEB_PORT/simulator.html?api=http://$HOST:$API_PORT

  Press Ctrl+C to stop both servers.

EOF

wait
