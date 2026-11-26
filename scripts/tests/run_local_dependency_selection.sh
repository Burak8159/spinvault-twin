#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/spinvault-launcher-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

setup_case() {
  local name="$1" system="$2" machine="$3" minor="$4"
  local case_root="$TMP/$name"
  mkdir -p "$case_root/project/backend/.venv/bin" "$case_root/project/scripts" "$case_root/fakebin"
  cp "$ROOT/scripts/run_local.sh" "$case_root/project/scripts/run_local.sh"
  cp "$ROOT/backend/requirements.txt" "$case_root/project/backend/requirements.txt"
  cp "$ROOT/backend/requirements-macos-arm64-py311.lock" \
    "$case_root/project/backend/requirements-macos-arm64-py311.lock"
  cat > "$case_root/project/backend/.venv/bin/python" <<'PYTHON'
#!/bin/sh
case "$*" in
  "-c import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)") exit 0 ;;
  "-c import fastapi, pydantic_settings, uvicorn, numpy, matplotlib, PIL") exit 1 ;;
  "-c import sys; print(f\"{sys.version_info.major}.{sys.version_info.minor}\")") echo "$FAKE_PY_MINOR" ;;
  "-m pip install "*) printf '%s\n' "$*" >> "$INSTALL_LOG"; exit 1 ;;
  *) exit 2 ;;
esac
PYTHON
  chmod +x "$case_root/project/backend/.venv/bin/python"
  cat > "$case_root/fakebin/uname" <<'UNAME'
#!/bin/sh
case "$1" in
  -s) echo "$FAKE_UNAME_SYSTEM" ;;
  -m) echo "$FAKE_UNAME_MACHINE" ;;
  *) exit 1 ;;
esac
UNAME
  chmod +x "$case_root/fakebin/uname"
  cat > "$case_root/fakebin/lsof" <<'LSOF'
#!/bin/sh
exit 1
LSOF
  chmod +x "$case_root/fakebin/lsof"

  export FAKE_PY_MINOR="$minor"
  export FAKE_UNAME_SYSTEM="$system"
  export FAKE_UNAME_MACHINE="$machine"
  export INSTALL_LOG="$case_root/install.log"
  : > "$INSTALL_LOG"
  set +e
  PATH="$case_root/fakebin:/usr/bin:/bin" \
    SPINVAULT_API_PORT=18991 SPINVAULT_WEB_PORT=18992 \
    bash "$case_root/project/scripts/run_local.sh" > "$case_root/output.log" 2>&1
  local status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    echo "$name unexpectedly passed the deliberately failing install" >&2
    return 1
  fi
  grep -q 'dependency install failed' "$case_root/output.log"
}

setup_case mac-arm64-py311 Darwin arm64 3.11
  grep -q 'using hash-locked macOS arm64 / Python 3.11 dependencies' \
  "$TMP/mac-arm64-py311/output.log"
grep -q -- '--require-hashes -r .*requirements-macos-arm64-py311.lock' \
  "$TMP/mac-arm64-py311/install.log"

setup_case linux-py311 Linux x86_64 3.11
grep -q 'no qualified dependency constraints for this platform' \
  "$TMP/linux-py311/output.log"
if grep -q -- ' -c ' "$TMP/linux-py311/install.log"; then
  echo 'unqualified Linux path unexpectedly selected platform constraints' >&2
  exit 1
fi

echo 'local launcher dependency selection: PASS (macOS arm64/Python 3.11; Linux fallback)'
