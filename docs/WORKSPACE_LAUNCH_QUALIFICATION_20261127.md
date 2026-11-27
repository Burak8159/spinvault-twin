# Integrated local workspace launcher qualification — 27 November 2026

## Change

Added `scripts/run_workspace.sh` as a single local entry point for the FastAPI service, existing static simulator/requirements tools, and the Next.js evidence workspace. It checks required ports and dependencies before starting, accepts explicit API/web/Next port overrides, links the dashboard to the selected local service URLs, and shuts down its child services together on Ctrl+C. It does not install dependencies or provision cloud resources.

## Verification

- `bash -n scripts/run_workspace.sh`: passed.
- Occupied-port preflight: detected an already-used static port and exited before starting services; the existing listener was left untouched.
- Full launcher smoke on isolated ports `18081` (API), `14201` (static tools), and `13001` (workspace): API health 200; Next dashboard 200 and API-connected; empty-record state shown without fabricated records; requirements page 200; all 3 local services shut down on Ctrl+C.
- Post-run check: no listeners remained on the three test ports; temporary SQLite files and working directories were removed.
- No cloud compute was used.

## Limits

This qualifies local startup and shutdown on the current macOS environment only. It is not a production service manager, hosted deployment/authentication qualification, cross-platform test, solver execution, or scientific validation. Dependencies must be installed in `apps/simulator` before running the launcher.
