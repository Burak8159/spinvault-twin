#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/spinvault-browser-failure.XXXXXX")"
RUNNER_PID=""
cleanup() {
  if [[ -n "$RUNNER_PID" ]] && kill -0 "$RUNNER_PID" 2>/dev/null; then
    # Background jobs inherit SIGINT as ignored on many shells. TERM is
    # handled by run_local.sh's cleanup trap and reliably stops both servers.
    kill -TERM "$RUNNER_PID" 2>/dev/null || true
    wait "$RUNNER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

mkdir -p "$TMP/fakebin"
cat > "$TMP/fakebin/open" <<'OPEN'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SPINVAULT_TEST_OPEN_LOG"
exit 1
OPEN
chmod +x "$TMP/fakebin/open"

read -r API_PORT WEB_PORT < <(python3 - <<'PY'
import socket
ports=[]
for _ in range(2):
    sock=socket.socket()
    sock.bind(("127.0.0.1",0))
    ports.append(sock.getsockname()[1])
    sock.close()
print(*ports)
PY
)

export SPINVAULT_API_PORT="$API_PORT"
export SPINVAULT_WEB_PORT="$WEB_PORT"
export SPINVAULT_DATA_DIR="$TMP/jobs"
export SPINVAULT_JOB_DATABASE="$TMP/jobs.sqlite3"
export SPINVAULT_REQUIREMENTS_DB="$TMP/requirements.sqlite"
export SPINVAULT_PROJECT_RECORDS_DB="$TMP/project-records.sqlite"
export SPINVAULT_JOB_ROOT="$TMP/mumax-jobs"
export SPINVAULT_TEST_OPEN_LOG="$TMP/open.log"
: > "$SPINVAULT_TEST_OPEN_LOG"

PATH="$TMP/fakebin:$PATH" "$ROOT/scripts/run_local.sh" > "$TMP/launcher.log" 2>&1 &
RUNNER_PID=$!

ready=false
for _ in $(seq 1 90); do
  if ! kill -0 "$RUNNER_PID" 2>/dev/null; then
    cat "$TMP/launcher.log" >&2
    echo "launcher exited before browser-open fallback could be checked" >&2
    exit 1
  fi
  if curl -fsS -m 2 "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 &&
     curl -fsS -m 2 "http://127.0.0.1:$WEB_PORT/simulator.html" >/dev/null 2>&1 &&
     [[ -s "$SPINVAULT_TEST_OPEN_LOG" ]]; then
    ready=true
    break
  fi
  sleep 0.25
done

if [[ "$ready" != true ]]; then
  cat "$TMP/launcher.log" >&2
  echo "Twin did not remain healthy after simulated browser-open failure" >&2
  exit 1
fi
grep -q "The Twin is still running" "$TMP/launcher.log"
kill -0 "$RUNNER_PID"
echo "local launcher survives browser-open failure: PASS (API and website healthy)"
