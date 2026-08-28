from __future__ import annotations

from pathlib import Path

import pytest

from spinvault.transport.cchain.fdf import write_cchain_job
from spinvault.transport.cchain.parameters import (
    SYNTHETIC_DIAGNOSTIC_TRANSMISSION,
    TUTORIAL_PARAMETERS,
    UNSET_PRODUCTION_ENERGY_GRID,
)
from spinvault.transport.cchain.pinning import TUTORIAL_DOCS_GIT_COMMIT, TUTORIAL_URL, pin_from_job
from spinvault.transport.bias import (
    applied_bias_to_siesta_energy,
    ts_voltage_eV,
    ts_voltage_fdf_line,
)
from spinvault.core.contracts import AppliedBias, ZERO_BIAS
from spinvault.core.taxonomy import (
    ArtifactRole,
    ParameterOrigin,
    REQUESTED_ORIGIN_SYNTHETIC_TEST_DATA,
    REQUESTED_ORIGIN_UPSTREAM_REFERENCE,
    SourceKind,
)
from negf_transport.pipeline import run_cchain_fixture

DATA = Path(__file__).resolve().parent / "data" / "diagnostic_transmission.txt"


def test_tutorial_values_cite_upstream_source_not_project_invention():
    bond = TUTORIAL_PARAMETERS["c_c_bond"]
    assert bond.origin is ParameterOrigin.PROPOSED_METHOD
    assert bond.source_kind is SourceKind.OFFICIAL_SOFTWARE_TUTORIAL
    assert bond.requested_origin == REQUESTED_ORIGIN_UPSTREAM_REFERENCE
    assert bond.artifact_role is ArtifactRole.TEST_FIXTURE
    assert "siesta" in bond.source.lower()
    assert TUTORIAL_DOCS_GIT_COMMIT in bond.source
    assert TUTORIAL_URL in bond.source
    assert "UNSET" not in SourceKind.__members__
    grid = UNSET_PRODUCTION_ENERGY_GRID
    assert grid.source_kind is None


def test_synthetic_transmission_is_not_software_default_or_computed(tmp_path: Path):
    result = run_cchain_fixture(tmp_path, transmission_path=DATA, parser_preference="text")
    assert result.transport is not None
    assert result.transport.provenance_origin is not ParameterOrigin.SOFTWARE_DEFAULT
    assert result.transport.provenance_origin is not ParameterOrigin.COMPUTED_TRANSPORT
    assert result.transport.data_source_kind is SourceKind.SYNTHETIC_TEST_DATA
    assert result.transport.requested_origin == REQUESTED_ORIGIN_SYNTHETIC_TEST_DATA
    assert result.transport.artifact_role is ArtifactRole.TEST_FIXTURE
    assert SYNTHETIC_DIAGNOSTIC_TRANSMISSION.source_kind is SourceKind.SYNTHETIC_TEST_DATA
    assert SYNTHETIC_DIAGNOSTIC_TRANSMISSION.origin is not ParameterOrigin.SOFTWARE_DEFAULT
    assert "SYNTHETIC_TEST_DATA" not in ParameterOrigin.__members__


def test_common_bias_is_volts_and_siesta_voltage_is_adapter_only(tmp_path: Path):
    assert TUTORIAL_PARAMETERS["applied_bias"].unit == "V"
    assert TUTORIAL_PARAMETERS["applied_bias"].name != "ts_voltage"
    energy = applied_bias_to_siesta_energy(AppliedBias(0.5, "V"))
    assert energy.unit == "eV"
    assert energy.value == 0.5
    assert ts_voltage_eV(ZERO_BIAS) == 0.0
    assert ts_voltage_eV(AppliedBias(0.5, "V")) == energy.value
    files = write_cchain_job(tmp_path)
    ts = files["ts"].read_text(encoding="utf-8")
    assert "DeltaV = 0.0 V" in ts
    assert "DeltaE = q_e * DeltaV" in ts
    assert "TS.Voltage 0.0 eV" in ts
    line = ts_voltage_fdf_line(AppliedBias(1.0, "V"))
    assert "DeltaV = 1.0 V" in line
    assert "DeltaE = q_e * DeltaV" in line
    assert "TS.Voltage 1.0 eV" in line


def test_fixture_pin_records_docs_commit_and_hashes(tmp_path: Path):
    files = write_cchain_job(tmp_path)
    pin = pin_from_job(files, diagnostic_transmission=DATA)
    assert pin.docs_git_commit == TUTORIAL_DOCS_GIT_COMMIT
    assert pin.tutorial_url == TUTORIAL_URL
    assert pin.siesta_version is None
    assert pin.electrode_geometry_hash
    assert pin.device_geometry_hash
    assert pin.fdf_sha256["ts"]
    assert pin.diagnostic_transmission_sha256 == __import__("hashlib").sha256(DATA.read_bytes()).hexdigest()
    again = write_cchain_job(tmp_path / "second")
    assert pin_from_job(again).fdf_sha256["ts"] == pin.fdf_sha256["ts"]


def test_tutorial_parameter_requires_source():
    with pytest.raises(ValueError, match="tutorial-derived"):
        from spinvault.core.taxonomy import ParameterStatus, ScientificParameter

        ScientificParameter(
            name="c_c_bond",
            value=1.5,
            unit="Ang",
            origin=ParameterOrigin.PROPOSED_METHOD,
            status=ParameterStatus.PROPOSED,
            source_kind=SourceKind.OFFICIAL_SOFTWARE_TUTORIAL,
            source=None,
        )
