#!/bin/bash
# Double-click this file on macOS to start SpinVault Twin.
cd "$(dirname "$0")" || exit 1
chmod +x scripts/run_local.sh
exec scripts/run_local.sh
