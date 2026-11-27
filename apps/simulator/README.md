# SpinVault Twin workspace

This Next.js app is a read-only overview for the local SpinVault Twin. It reads versioned device, structure, study, material and requirement records from the companion FastAPI service and links to the existing simulator, project-records and requirements tools.

## Run locally

1. From `apps/simulator`, run `npm ci` once to install the pinned app dependencies.
2. From the repository root, run `scripts/run_workspace.sh`. By default it builds and serves the dashboard in production mode, starts the Twin API and static companion tools, checks the required ports, and shuts the services down together when you press Ctrl+C. Set `SPINVAULT_NEXT_MODE=development` to use the live-reloading development server instead.
3. Open `http://127.0.0.1:3000`.

The default API and static-tool addresses remain `http://127.0.0.1:8001` and `http://127.0.0.1:4191`. The workspace uses port `3000`. Set `SPINVAULT_API_PORT`, `SPINVAULT_WEB_PORT`, or `SPINVAULT_NEXT_PORT` to choose different free ports. The launcher never installs packages automatically; if dependencies are missing, it exits with the install command.

Configure alternate local service addresses with:

- `SPINVAULT_TWIN_API_URL` — default `http://127.0.0.1:8001`.
- `SPINVAULT_TWIN_WEB_URL` — default `http://127.0.0.1:4191`.

The overview uses uncached server-side reads and displays an explicit offline or partial-data state. It does not create sample records, run physical simulations, or infer validation. Record revisions and hashes are displayed as supplied by the API. A record marked as not transport-validated remains so; a saved requirement/evidence comparison does not validate a whole device or solver.

## Checks

Run `npm run lint`, `npx tsc --noEmit`, and `npm run build` from this directory.
