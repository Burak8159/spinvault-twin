# Integrated local workspace launcher qualification — 27 November 2026

## Change

Added `scripts/run_workspace.sh` as a single local entry point for the FastAPI service, existing static simulator/requirements tools, and the Next.js evidence workspace. It checks required ports and dependencies before starting, accepts explicit API/web/Next port overrides, links the dashboard to the selected local service URLs, and shuts down its child services together on Ctrl+C. It does not install dependencies or provision cloud resources. The launcher now builds and serves the dashboard in production mode by default; `SPINVAULT_NEXT_MODE=development` opts into the development watcher.

## Verification

- `bash -n scripts/run_workspace.sh`: passed.
- Occupied-port preflight: detected an already-used static port and exited before starting services; the existing listener was left untouched.
- Full launcher smoke on isolated ports `18081` (API), `14201` (static tools), and `13001` (workspace): API health 200; Next dashboard 200 and API-connected; empty-record state shown without fabricated records; requirements page 200; all 3 local services shut down on Ctrl+C.
- Post-run check: no listeners remained on the three test ports; temporary SQLite files and working directories were removed.
- No cloud compute was used.

## Exact source-package clean-install follow-up

The v11 archive was extracted to a fresh temporary directory. The simulator's pinned Node dependencies were installed with `npm ci --offline`; the archive's macOS arm64/Python 3.11 hash-locked backend dependencies were then installed into a separate fresh Python 3.11 virtual environment with `--require-hashes`. Results: website 167/167; backend 250 passed, 1 optional MuMax3 skip; simulator lint, TypeScript and optimized Webpack build passed.

An integrated launch from the extracted archive initially exposed excessive Next.js development file watchers (`EMFILE`) in this host's process environment. The launcher was corrected to build and serve the dashboard in production mode by default, retaining development mode as an explicit opt-in. On the corrected source checkout, the production launcher built successfully, served the overview/API/static pages with HTTP 200 on isolated ports, and shut down cleanly. The v11 development-mode failure is not counted as a passing launcher test. Exact packaged-source requalification for the corrected launcher is recorded separately in the Phase 1 research handoff.

## Limits

This qualifies local startup and shutdown on the current macOS environment only. It is not a production service manager, hosted deployment/authentication qualification, cross-platform test, solver execution, or scientific validation. Dependencies must be installed in `apps/simulator` before running the launcher.
