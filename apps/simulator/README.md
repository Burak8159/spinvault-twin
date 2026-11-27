# SpinVault Twin workspace

This Next.js app is a read-only overview for the local SpinVault Twin. It reads versioned device, structure, study, material and requirement records from the companion FastAPI service and links to the existing simulator, project-records and requirements tools.

## Run locally

1. Start the Twin API and static companion website using the repository's local runner (`scripts/run_local.sh`). The default addresses are `http://127.0.0.1:8001` and `http://127.0.0.1:4191`.
2. From `apps/simulator`, run `npm ci` and `npm run dev`.
3. Open `http://localhost:3000`.

Configure alternate local service addresses with:

- `SPINVAULT_TWIN_API_URL` — default `http://127.0.0.1:8001`.
- `SPINVAULT_TWIN_WEB_URL` — default `http://127.0.0.1:4191`.

The overview uses uncached server-side reads and displays an explicit offline or partial-data state. It does not create sample records, run physical simulations, or infer validation. Record revisions and hashes are displayed as supplied by the API. A record marked as not transport-validated remains so; a saved requirement/evidence comparison does not validate a whole device or solver.

## Checks

Run `npm run lint`, `npx tsc --noEmit`, and `npm run build` from this directory.
