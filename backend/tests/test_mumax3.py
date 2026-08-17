"""MuMax3 adapter tests. Execution is mocked unless MUMAX3_BINARY is a real binary."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.experiments.equilibrium import build_reference_v01_request
from app.models.simulation import Quantity, SimulationRequest
from app.physics.parameters import exchange_length_m
from app.physics.reference_pmtj import reference_parameter_manifest
from app.solvers.mumax3.adapter import Mumax3Adapter
from app.solvers.mumax3.script import generate_mx3_script
from app.solvers.mumax3.units import UnsupportedUnitError, to_si
from app.solvers.mumax3.validate_request import validate_mumax_request
from tests.conftest import sample_mumax_payload


def reference_v01_payload() -> dict:
    payload = sample_mumax_payload()
    payload["scenarioId"] = "reference-pmtj-v01"
    payload["title"] = "Reference pMTJ V01 equilibrium"
    payload["geometry"].update(
        {
            "freeLayerLength": {"value": 40, "unit": "nm", "source": "preset"},
            "freeLayerWidth": {"value": 40, "unit": "nm", "source": "preset"},
            "freeLayerThickness": {"value": 1.2, "unit": "nm", "source": "preset"},
            "cellShape": "ellipse",
        }
    )
    payload["controls"]["temperature"] = {"value": 0, "unit": "K", "source": "preset"}
    payload["externalField"] = {
        axis: {"value": 0, "unit": "T", "source": "preset"}
        for axis in ("x", "y", "z")
    }
    payload["solverDrafts"]["mumax3"].update(
        {
            "modelKind": "reference_pmtj_v01_equilibrium",
            "meshCellSize": {
                "x": {"value": 1.25, "unit": "nm", "source": "preset"},
                "y": {"value": 1.25, "unit": "nm", "source": "preset"},
                "z": {"value": 0.6, "unit": "nm", "source": "preset"},
            },
            "gridSize": {"nx": 32, "ny": 32, "nz": 2},
            "saturationMagnetization": {
                "value": 1.0e6,
                "unit": "A/m",
                "source": "preset",
            },
            "exchangeStiffness": {
                "value": 1.0e-11,
                "unit": "J/m",
                "source": "preset",
            },
            "dampingAlpha": {
                "value": 0.01,
                "unit": "dimensionless",
                "source": "preset",
            },
            "anisotropyConstant": {
                "value": 8.0e5,
                "unit": "J/m^3",
                "source": "preset",
            },
            "anisotropyAxis": {"x": 0, "y": 0, "z": 1},
        }
    )
    return payload


def test_to_si_length_and_time() -> None:
    assert to_si(Quantity(value=2, unit="nm"), kind="length") == pytest.approx(2e-9)
    assert to_si(Quantity(value=5, unit="ns"), kind="time") == pytest.approx(5e-9)
    assert to_si(Quantity(value=1, unit="T"), kind="field") == 1.0


def test_to_si_rejects_unknown_unit() -> None:
    with pytest.raises(UnsupportedUnitError):
        to_si(Quantity(value=1, unit="eV"), kind="length")


def test_exchange_length_for_unvalidated_reference_defaults() -> None:
    value = exchange_length_m(
        exchange_stiffness_j_per_m=1.0e-11,
        saturation_magnetization_a_per_m=1.0e6,
    )
    assert value == pytest.approx(3.9894228e-9)
    manifest = reference_parameter_manifest()
    assert manifest["scientificStatus"] == "UNVALIDATED"
    assert all(
        item["provenance_status"] == "UNVALIDATED_DEFAULT"
        for item in manifest["parameters"]
    )


def test_v01_equilibrium_script_contains_real_relaxation_outputs() -> None:
    request = SimulationRequest.model_validate(reference_v01_payload())
    validation = validate_mumax_request(request)
    assert validation.ok
    assert any(w.code == "mumax3-mesh-exchange-precheck-pass" for w in validation.warnings)
    script = generate_mx3_script(request)
    assert "experimentId=V01_equilibrium" in script
    assert 'saveas(m, "initial")' in script
    assert "relax()" in script
    assert 'saveas(m, "equilibrium")' in script
    assert "Temp =" not in script
    assert "Pol =" not in script
    assert "J =" not in script


def test_canonical_v01_request_is_generated_from_reference_registry() -> None:
    request = build_reference_v01_request()
    assert request.requested_solver == "mumax3"
    assert request.solver_drafts.mumax3.model_kind == "reference_pmtj_v01_equilibrium"
    assert request.controls.temperature.value == 0
    assert request.geometry.free_layer_length.value == pytest.approx(40e-9)
    assert validate_mumax_request(request).ok


def test_v01_parameter_propagation_changes_generated_script() -> None:
    first = reference_v01_payload()
    second = reference_v01_payload()
    second["solverDrafts"]["mumax3"]["anisotropyConstant"]["value"] = 7.5e5
    first_script = generate_mx3_script(SimulationRequest.model_validate(first))
    second_script = generate_mx3_script(SimulationRequest.model_validate(second))
    assert first_script != second_script
    assert "Ku1 = 800000" in first_script
    assert "Ku1 = 750000" in second_script


def test_v01_rejects_nonzero_temperature_without_thermal_model() -> None:
    payload = reference_v01_payload()
    payload["controls"]["temperature"]["value"] = 300
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert not result.ok
    assert any(error.code == "v01-temperature-must-be-zero" for error in result.errors)


def test_exchange_length_rejects_mesh_coarser_than_exchange_length() -> None:
    payload = reference_v01_payload()
    payload["solverDrafts"]["mumax3"]["meshCellSize"] = {
        axis: {"value": value, "unit": "nm"}
        for axis, value in (("x", 5), ("y", 5), ("z", 0.6))
    }
    payload["solverDrafts"]["mumax3"]["gridSize"] = {"nx": 8, "ny": 8, "nz": 2}
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert not result.ok
    assert any(error.code == "mumax3-mesh-exceeds-exchange-length" for error in result.errors)


def test_availability_false_without_binary(tmp_path: Path) -> None:
    settings = Settings(mumax3_binary=None, job_root=tmp_path)
    adapter = Mumax3Adapter(settings=settings)
    assert adapter.is_available() is False


def test_availability_false_for_missing_path(tmp_path: Path) -> None:
    settings = Settings(mumax3_binary=str(tmp_path / "missing-mumax3"), job_root=tmp_path)
    adapter = Mumax3Adapter(settings=settings)
    assert adapter.is_available() is False


def test_script_generation_minimal_valid_request() -> None:
    request = SimulationRequest.model_validate(sample_mumax_payload())
    script = generate_mx3_script(request)
    assert "Generated by SpinVault Twin" in script
    assert "modelKind=smoke" in script
    assert "SetGridSize(8, 4, 1)" in script
    assert "SetCellSize(" in script
    assert "Msat =" in script
    assert "Aex =" in script
    assert "alpha =" in script
    assert "m = uniform(" in script
    assert "TableAdd(B_ext)" in script
    assert "TableAutoSave(" in script
    assert "OutputFormat = OVF2_TEXT" in script
    assert "run(" in script
    assert script.count("TableSave()") == 2
    assert "B_ext = vector(" in script
    assert "no switching or performance criterion" in script.lower()


def test_missing_grid_size_fails_validation() -> None:
    payload = sample_mumax_payload()
    payload["solverDrafts"]["mumax3"]["gridSize"] = None
    # pydantic may reject None for gridSize depending on model; force via object mutate
    request = SimulationRequest.model_validate(sample_mumax_payload())
    request.solver_drafts.mumax3.grid_size = None  # type: ignore[union-attr]
    result = validate_mumax_request(request)
    assert not result.ok
    assert any(error.code == "mumax3-grid-missing" for error in result.errors)


def test_api_mumax3_has_no_substitute_fallback(client: TestClient) -> None:
    from tests.conftest import drain_worker

    response = client.post("/api/simulations", json=sample_mumax_payload())
    assert response.status_code == 201
    job = response.json()["job"]
    assert job["status"] == "queued"
    drain_worker(client)
    job = client.get(f"/api/simulations/{job['jobId']}").json()
    assert job["status"] == "not_configured"
    assert job["result"] is None
    assert any(error["code"] == "mumax3_not_configured" for error in job["errors"])
    assert job["provenance"]["solver"] == "mumax3"
    assert any("no python llg" in note.lower() for note in job["provenance"]["notes"])


def test_solvers_status_endpoint(client: TestClient) -> None:
    response = client.get("/api/solvers")
    assert response.status_code == 200
    body = response.json()
    assert body["demo"]["configured"] is True
    assert body["mumax3"]["configured"] is False
    assert body["pythonLlg"]["configured"] is True
    assert body["kwant"]["configured"] is False


def test_mocked_successful_execution(tmp_path: Path) -> None:
    binary = tmp_path / "fake-mumax3"
    binary.write_text("#!/bin/sh\necho fake\n", encoding="utf-8")
    binary.chmod(0o755)

    def runner(command: list[str], cwd: Path, timeout: float):
        _ = timeout
        if "-v" in command:
            return 0, False, "mumax 3.12 fake windows_amd64\n", ""
        # Simulate mumax3 writing table output next to the script.
        out_dir = cwd / "generated.out"
        out_dir.mkdir(exist_ok=True)
        (out_dir / "table.txt").write_text(
            "# t (s)\tmx ()\tmy ()\tmz ()\tB_extx (T)\n"
            "0\t0\t0\t1\t0.01\n",
            encoding="utf-8",
        )
        return 0, False, f"ran {' '.join(command)}\n", ""

    settings = Settings(
        mumax3_binary=str(binary),
        job_root=tmp_path / "jobs",
        mumax3_timeout_seconds=30,
    )
    adapter = Mumax3Adapter(settings=settings, runner=runner)
    assert adapter.is_available() is True

    request = SimulationRequest.model_validate(sample_mumax_payload())
    outcome = adapter.execute(request, job_id="job_mock_ok")
    assert outcome.status == "complete"
    assert outcome.result is not None
    assert outcome.result.source == "mumax3"
    assert outcome.result.is_physical_simulation is True
    assert outcome.result.artifacts is not None
    assert "SetGridSize" in (outcome.result.artifacts.script_preview or "")
    assert (tmp_path / "jobs" / "job_mock_ok" / "generated.mx3").exists()
    assert (tmp_path / "jobs" / "job_mock_ok" / "request.json").exists()
    assert (tmp_path / "jobs" / "job_mock_ok" / "input_parameters.json").exists()
    assert (tmp_path / "jobs" / "job_mock_ok" / "stdout.log").exists()
    assert (tmp_path / "jobs" / "job_mock_ok" / "run_metadata.json").exists()
    assert (tmp_path / "jobs" / "job_mock_ok" / "result.json").exists()
    assert outcome.result.series


def test_mocked_subprocess_failure(tmp_path: Path) -> None:
    binary = tmp_path / "fake-mumax3"
    binary.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    binary.chmod(0o755)

    def runner(command: list[str], cwd: Path, timeout: float):
        _ = cwd, timeout
        if "-v" in command:
            return 0, False, "mumax 3.12 fake\n", ""
        return 1, False, "", "boom"

    settings = Settings(mumax3_binary=str(binary), job_root=tmp_path / "jobs")
    adapter = Mumax3Adapter(settings=settings, runner=runner)
    request = SimulationRequest.model_validate(sample_mumax_payload())
    outcome = adapter.execute(request, job_id="job_mock_fail")
    assert outcome.status == "failed"
    assert any(error.code == "mumax3_failed" for error in outcome.errors)
    assert outcome.result is not None  # artifacts preserved
    assert outcome.result.artifacts is not None
    assert "boom" in (outcome.result.artifacts.stderr or "")


def test_mocked_timeout(tmp_path: Path) -> None:
    binary = tmp_path / "fake-mumax3"
    binary.write_text("#!/bin/sh\n", encoding="utf-8")
    binary.chmod(0o755)

    def runner(command: list[str], cwd: Path, timeout: float):
        _ = cwd, timeout
        if "-v" in command:
            return 0, False, "mumax 3.12 fake\n", ""
        return 124, True, "", "timed out"

    settings = Settings(mumax3_binary=str(binary), job_root=tmp_path / "jobs", mumax3_timeout_seconds=1)
    adapter = Mumax3Adapter(settings=settings, runner=runner)
    request = SimulationRequest.model_validate(sample_mumax_payload())
    outcome = adapter.execute(request, job_id="job_mock_timeout")
    assert outcome.status == "failed"
    assert any(error.code == "mumax3_timeout" for error in outcome.errors)


@pytest.mark.skipif(not os.environ.get("MUMAX3_BINARY"), reason="Real MuMax3 binary not configured")
def test_real_binary_availability_when_configured() -> None:
    adapter = Mumax3Adapter()
    assert adapter.is_available() is True
