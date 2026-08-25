# NEGF fixture slice (`DEVELOPER_2_GOOD_NEGF_TRANSPORT_ENSEMBLES`)

This directory is a **compatibility / test layer**, not the production package.

- Do **not** treat it as `src/spinvault/`.
- `DEVELOPER_1_VERY_GOOD_PLATFORM_AWS_INTEGRATION` owns Team Contract v1 and the canonical package skeleton.
- Every artifact here has `artifact_role=TEST_FIXTURE`.
- This is **not** CFAS|NFO|Al2O3|CFAS production NEGF.

See `MIGRATION.md` for the agreed stop point and post-contract sequence.

## Provenance rules in this slice

- Tutorial numbers: `origin=PROPOSED_METHOD`, `source_kind=OFFICIAL_SOFTWARE_TUTORIAL`, exact SIESTA docs URL + git commit, `artifact_role=TEST_FIXTURE`. `UPSTREAM_REFERENCE` is a requested origin for platform, not a local enum member.
- Synthetic diagnostic T(E): `source_kind=SYNTHETIC_TEST_DATA`, **not** `SOFTWARE_DEFAULT`, **not** `COMPUTED_TRANSPORT`.
- Shared bias: `AppliedBias` is ΔV in **V**. Adapter: **ΔE = q_e ΔV**, written as energy-valued `TS.Voltage` in eV in FDF only. `CalculationSpec` has no `TS.Voltage`.
- Absent `source_kind` is `None`. `ParameterStatus.UNSET` is a separate field; Team Contract v1 must decide if that status token is canonical.

## Test tiers

1. **Unit/fixture tests (this directory)** — no solver. Run on every commit.
2. **Solver smoke test** — pinned `siesta` + `tbtrans` on the official C-chain. After the platform container exists.
3. **Numerical regression** — selected C-chain outputs vs pinned references, with tolerances.
4. **Production physics convergence** — SpinVault only. Completely separate. Blocked on a reviewed `StructureRecord` from `DEVELOPER_3_BEGINNER_DFT_STRUCTURES_INTERFACES`.

```bash
python3 -m pytest tests/negf_transport -q
```

These tests are **tier 1 only**. They do not prove that an installed SIESTA/TranSIESTA/TBtrans stack runs.

## What this will not do

- Emit `StoredSpinPopulation` / `P_store`
- Compute `tau = 1/(nu0 * T(E_F))`
- Inherit QE pseudopotentials as SIESTA production PPs
- Merge `ReferenceModel.WKB_MANUSCRIPT` or `LegacyTwinModel.TSU_ESAKI_JULLIERE` into NEGF results
- Start CFAS|NFO|Al2O3|CFAS until DFT/structures delivers a reviewed transport-ready `StructureRecord`
