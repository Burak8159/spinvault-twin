from __future__ import annotations

from datetime import datetime, timezone

import pytest

from spinvault.transport.cchain.geometry import build_unconnected_device
from spinvault.transport.cchain.parameters import FIXTURE_ENERGY, FIXTURE_SPIN, UNSET_PRODUCTION_ENERGY_GRID
from spinvault.core.contracts import (
    UNRESOLVED_RETENTION_COUPLING,
    AppliedBias,
    CalculationSpec,
    RunMetadata,
    SolverMethodRecord,
    TransportResult,
    ZERO_BIAS,
    bias_change_requires_new_spec,
    new_run_from_interrupt,
)
from spinvault.core.observables import P_CURRENT, P_INJECTED
from spinvault.core.quantities import (
    CurrentSpinPolarization,
    InjectedSpinFraction,
    NormalizedChannelFractions,
    UnresolvedCouplingError,
)
from spinvault.core.taxonomy import (
    ArtifactRole,
    ParameterOrigin,
    ParameterStatus,
    ScientificParameter,
    SourceKind,
)


def _spec() -> CalculationSpec:
    return CalculationSpec(
        calculation_id="calc.fixture.0",
        campaign_id="fixture_cchain",
        structure_id="fixture.cchain.unconnected.v0",
        engine="siesta",
        calculation_type="transiesta_zero_bias",
        applied_bias=ZERO_BIAS,
        physics={"soc": False},
        numerical={},
        resources={},
        origin=ParameterOrigin.PROJECT_METHOD,
        status=ParameterStatus.PROPOSED,
        artifact_role=ArtifactRole.TEST_FIXTURE,
    )


def test_origin_and_status_are_distinct():
    grid = UNSET_PRODUCTION_ENERGY_GRID
    assert grid.origin is ParameterOrigin.PROJECT_METHOD
    assert grid.status is ParameterStatus.UNSET
    assert grid.source_kind is None
    assert grid.value is None


def test_invalid_origin_status_combination_is_rejected():
    with pytest.raises(ValueError, match="PROJECT_METHOD"):
        ScientificParameter(
            name="NEGF_energy_grid",
            value=None,
            unit="eV",
            origin=ParameterOrigin.PROJECT_METHOD,
            status=ParameterStatus.NEEDS_CONVERGENCE,
        )


def test_test_fixture_is_artifact_role_not_origin():
    assert ArtifactRole.TEST_FIXTURE.value == "TEST_FIXTURE"
    assert "TEST_FIXTURE" not in ParameterOrigin.__members__


def test_channel_fractions_sum_to_one_current_polarization_does_not():
    fractions = NormalizedChannelFractions(p_up=0.1, p_down=0.9, definition_id="frac")
    assert fractions.p_up + fractions.p_down == 1.0
    polarization = CurrentSpinPolarization(value=0.2, definition_id=P_CURRENT.definition_id)
    injected = InjectedSpinFraction(value=0.4, definition_id=P_INJECTED.definition_id)
    assert type(polarization) is not type(injected)
    assert type(polarization) is not type(fractions)


def test_bias_change_is_new_calculation_spec():
    previous = _spec()
    changed = bias_change_requires_new_spec(previous, AppliedBias(0.5, "V"))
    assert changed.calculation_id != previous.calculation_id
    assert changed.applied_bias.value == 0.5
    assert changed.applied_bias.unit == "V"
    assert previous.applied_bias == ZERO_BIAS


def test_common_bias_rejects_electron_volt_unit():
    with pytest.raises(ValueError, match="must be 'V'"):
        AppliedBias(0.0, "eV")


def test_interrupt_keeps_calculation_spec_and_new_run_metadata():
    parent = RunMetadata(
        run_id="run-1",
        calculation_id="calc.fixture.0",
        campaign_id="fixture_cchain",
        timestamp_utc=datetime.now(timezone.utc),
        git_commit=None,
        git_dirty=None,
        engine="siesta",
        engine_version=None,
        parent_run_id=None,
        restart_number=0,
        exit_status="FAILED_WALLTIME",
        artifact_role=ArtifactRole.TEST_FIXTURE,
    )
    child = new_run_from_interrupt(parent, "run-2")
    assert child.calculation_id == parent.calculation_id
    assert child.parent_run_id == parent.run_id
    assert child.restart_number == 1


def test_transport_refuses_store_and_wkb_shortcut():
    device = build_unconnected_device()
    result = TransportResult(
        run_id="r",
        energies_eV=(0.0,),
        transmission=(1.0,),
        transmission_matrix=None,
        spin_representation=FIXTURE_SPIN,
        energy_reference=FIXTURE_ENERGY,
        geometry=device.metadata,
        solver_method=SolverMethodRecord(
            xc="PBE",
            pseudopotential_ids=(),
            siesta_basis="SZP",
            dftu_formulation=None,
            soc=False,
            siesta_version=None,
            tbtrans_version=None,
            sisl_version=None,
        ),
        provenance_origin=ParameterOrigin.PROPOSED_METHOD,
        data_source_kind=SourceKind.SYNTHETIC_TEST_DATA,
        requested_origin="SYNTHETIC_TEST_DATA",
        artifact_role=ArtifactRole.TEST_FIXTURE,
    )
    with pytest.raises(UnresolvedCouplingError, match="StoredSpinPopulation"):
        result.stored_population_or_raise()
    with pytest.raises(UnresolvedCouplingError, match="Forbidden"):
        result.retention_time_from_fermi_transmission(1.0e15)
    assert UNRESOLVED_RETENTION_COUPLING.status is ParameterStatus.UNSET
