# SpinVault Twin frontend shell

Vanilla HTML/CSS/JS workspace for the Twin simulator (`apps/website/simulator.html`).

## Execution modes

- **Demo (default):** local fixture adapter (no network). Optional Settings switch uses the FastAPI demo executor.
- **MuMax3 / Kwant / Surrogate:** submit to the FastAPI API (`SPINVAULT_API_URL`, default `http://localhost:8001`). MuMax3 is queued to a local worker (async progress phases). Without `MUMAX3_BINARY`, status becomes `not_configured`. Kwant/surrogate stay `not_configured`. GPU/RTX labels appear only with NVIDIA runtime evidence.

This UI does **not** implement MuMax3 physics, Kwant transport, or surrogate inference.

## Layout

| Path | Role |
| --- | --- |
| `components/` | Visual UI (`workspace.js`, `viewport.js`) |
| `lib/` | Types, defaults, validation, fixtures, status copy |
| `../api/` | Config, serialize, remote client, local demo adapter |

## Quality commands

From `apps/website`:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
