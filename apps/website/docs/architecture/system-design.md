# SpinVault System Design

The target system has seven practical layers:

1. Client / presentation layer
2. Orchestration / API gateway
3. Fast surrogate prediction layer
4. Heavy validation compute
5. Storage and archive layer
6. Governance and budget control
7. Future quantum hardware route

The repository now mirrors those layers under `platform/`.

The buildable local backend is under `orchestration/`. It is intentionally lightweight but maps to the same architecture:

- FastAPI acts as the gateway.
- `physics.py` acts as the current surrogate model.
- SQLite and JSON archives act as local metadata and storage.
- Background validation jobs act as the first version of the validation queue.
- Budget constants act as the first governance guardrail.
