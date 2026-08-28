# Migration assumptions (fixture slice)

Canonical roles — do not introduce shorthand IDs in code, fixtures, branches, or contracts:

- `DEVELOPER_1_VERY_GOOD_PLATFORM_AWS_INTEGRATION`
- `DEVELOPER_2_GOOD_NEGF_TRANSPORT_ENSEMBLES`
- `DEVELOPER_3_BEGINNER_DFT_STRUCTURES_INTERFACES`

This directory is owned by `DEVELOPER_2_GOOD_NEGF_TRANSPORT_ENSEMBLES`.

## Waiting on

`DEVELOPER_1_VERY_GOOD_PLATFORM_AWS_INTEGRATION` to freeze Team Contract v1 and establish `src/spinvault/`.

Production SpinVault NEGF remains blocked on a reviewed transport-ready `StructureRecord` from `DEVELOPER_3_BEGINNER_DFT_STRUCTURES_INTERFACES`.

Until then, transport uses `TEST_FIXTURE` structures (official SIESTA Simple C-chain) for software validation only.

## Sequence after Team Contract v1

1. Migrate this approved fixture slice into the canonical package.
2. Tier 2: pinned `siesta` + `tbtrans` C-chain smoke test.
3. Parse real solver output; record solver version and input/output hashes.
4. Only then, zero-bias SpinVault NEGF on a reviewed structure.

## Bias (must survive migration)

Shared model: `AppliedBias` is a potential difference ΔV in volts.

Adapter only: electron electrochemical-potential difference

```text
ΔE = q_e ΔV
```

serialized as SIESTA's energy-valued `TS.Voltage` in eV. For an electron the numerical magnitude in eV equals the potential-difference magnitude in V; they remain distinct quantities. `CalculationSpec` MUST NOT contain `TS.Voltage`. Conversion is `applied_bias_to_siesta_energy(bias) -> Energy`.

## Provenance fields (must survive migration)

- `origin`, `status`, and `source_kind` stay distinct.
- Absent `source_kind` is `None`, not a fabricated `UNSET` enum member.
- `ParameterStatus.UNSET` in this fixture draft is **not** a claim about Team Contract v1. Platform must freeze whether `UNSET` belongs in the canonical status enum (vs `unresolved` / `reference_only` / …). This role will not edit that enum independently.

## What Tier-1 tests do and do not claim

```bash
python3 -m pytest tests/negf_transport -q
```

24 solver-free tests: schemas, adapters, fixtures. They do **not** validate an installed TranSIESTA/TBtrans stack.
