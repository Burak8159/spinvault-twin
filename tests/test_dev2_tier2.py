"""Tier-2 C-chain smoke unit and integration tests (mock-first)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from spinvault.transport.parsers.api import ParsedTransmission, select_parser
from spinvault.transport.tier2 import (
    TIER2_BASELINE,
    CChainSmokeExecution,
    ExecutableInfo,
    StageResult,
    Tier2SmokeError,
    _find_transmission_artifact,
    _siesta_process_succeeded,
    build_cchain_fixture,
    execute_cchain_smoke,
    parse_siesta_version,
    parse_tbtrans_version,
    probe_siesta_executable,
    probe_tbtrans_executable,
    smoke_report,
    tier2_environment_configured,
    write_smoke_report,
)
from spinvault.core.taxonomy import ArtifactRole


def test_tier2_baseline_matches_f055273_parent():
    assert TIER2_BASELINE == "f055273f81c1a6fd0543dcb813ce28d57faea763"


def test_parse_siesta_version_with_v5_fallback():
    assert parse_siesta_version("Siesta Version 5.0.0") == "Siesta 5.0.0"
    assert parse_siesta_version("Welcome to Siesta V5") == "Siesta V5"
    assert parse_siesta_version("noise only") is None


def test_parse_tbtrans_version_with_welcome_fallback():
    assert parse_tbtrans_version("TBtrans Version 1.2.3") == "TBtrans 1.2.3"
    assert parse_tbtrans_version("WELCOME TO TBtrans") == "WELCOME TO TBtrans"
    assert parse_tbtrans_version("noise only") is None


def test_siesta_process_succeeded_accepts_job_completed():
    assert _siesta_process_succeeded("Job completed\n", "", 0) is True


def test_siesta_process_succeeded_rejects_nonzero_exit():
    assert _siesta_process_succeeded("Job completed\n", "", 1) is False
    assert _siesta_process_succeeded("still running\n", "", 0) is False


def test_find_transmission_artifact_prefers_avtrans(tmp_path: Path):
    root = tmp_path / "run"
    device = root / "unconnected" / "0V"
    device.mkdir(parents=True)
    (device / "device.TBT.nc").write_text("nc", encoding="utf-8")
    avtrans = device / "device.TBT.AVTRANS"
    avtrans.write_text("-1.0 0.5\n0.0 1.0\n", encoding="utf-8")
    assert _find_transmission_artifact(root) == avtrans


def test_find_transmission_artifact_falls_back_to_nc(tmp_path: Path):
    root = tmp_path / "run"
    device = root / "unconnected" / "0V"
    device.mkdir(parents=True)
    netcdf = device / "device.TBT.nc"
    netcdf.write_text("nc", encoding="utf-8")
    assert _find_transmission_artifact(root) == netcdf


def test_select_parser_auto_with_avtrans_path(tmp_path: Path):
    path = tmp_path / "device.TBT.AVTRANS"
    path.write_text("-1.0 0.5\n0.0 1.0\n", encoding="utf-8")
    parser = select_parser("auto", path)
    assert parser.name == "diagnostic_text"
    assert parser.parse_file(path).transmission[1] == 1.0


def test_probe_executables_compute_sha256(tmp_path: Path):
    siesta = tmp_path / "siesta"
    tbtrans = tmp_path / "tbtrans"
    siesta.write_text("#!/bin/sh\necho 'Siesta Version 5.0.0'\n", encoding="utf-8")
    tbtrans.write_text("#!/bin/sh\necho 'TBtrans Version 4.1.5'\n", encoding="utf-8")
    siesta.chmod(0o755)
    tbtrans.chmod(0o755)

    siesta_info = probe_siesta_executable(str(siesta))
    tbtrans_info = probe_tbtrans_executable(str(tbtrans))
    assert siesta_info.version == "5.0.0"
    assert tbtrans_info.version == "4.1.5"
    assert siesta_info.runtime_banner == "Siesta 5.0.0"
    assert tbtrans_info.runtime_banner == "TBtrans 4.1.5"
    assert siesta_info.sha256 and len(siesta_info.sha256) == 64
    assert tbtrans_info.sha256 and len(tbtrans_info.sha256) == 64


def test_build_cchain_fixture_writes_inputs(tmp_path: Path):
    result = build_cchain_fixture(tmp_path)
    assert result.status in {"inputs_written", "not_configured", "parsed_fixture"}
    assert result.job_files["ts"].is_file()
    assert "SolutionMethod transiesta" in result.job_files["ts"].read_text(encoding="utf-8")


def test_smoke_report_contains_provenance_fields():
    execution = CChainSmokeExecution(
        workdir=Path("/tmp/work"),
        siesta=ExecutableInfo(
            path="/bin/siesta",
            version="5.0.0",
            sha256="abc",
            runtime_banner="Siesta 5.0.0",
        ),
        tbtrans=ExecutableInfo(
            path="/bin/tbtrans",
            version="4.1.5",
            sha256="def",
            runtime_banner="TBtrans 4.1.5",
        ),
        stages=(
            StageResult(
                name="electrode_siesta",
                command=("/bin/siesta", "<", "RUN.fdf"),
                cwd=Path("/tmp/work/electrode"),
                returncode=0,
                stdout="Job completed",
                stderr="",
                succeeded=True,
                duration_s=1.0,
            ),
        ),
        transmission_path=Path("/tmp/work/unconnected/0V/device.TBT.AVTRANS"),
        parsed=ParsedTransmission(
            energies_eV=(0.0,),
            transmission=(1.0,),
            parser_name="diagnostic_text",
            data_source_kind=None,
            artifact_role=ArtifactRole.TEST_FIXTURE,
        ),
        transport=None,
        status="parsed_fixture",
    )
    report = smoke_report(execution)
    assert report["overall"] == "PASS"
    assert report["siesta_version"] == "5.0.0"
    assert report["tbtrans_version"] == "4.1.5"
    assert report["siesta_runtime_banner"] == "Siesta 5.0.0"
    assert report["siesta_sha256"] == "abc"
    assert report["tbtrans_sha256"] == "def"
    assert report["baseline_git_commit"] == TIER2_BASELINE


def test_execute_cchain_smoke_mocked_happy_path(tmp_path: Path):
    workdir = tmp_path / "smoke"
    avtrans = workdir / "unconnected" / "0V" / "device.TBT.AVTRANS"
    avtrans.parent.mkdir(parents=True)
    avtrans.write_text("-1.0 0.5\n0.0 1.0\n1.0 0.5\n", encoding="utf-8")

    siesta_bin = tmp_path / "siesta"
    tbtrans_bin = tmp_path / "tbtrans"
    siesta_bin.write_text("#!/bin/sh\n", encoding="utf-8")
    tbtrans_bin.write_text("#!/bin/sh\n", encoding="utf-8")
    siesta_bin.chmod(0o755)
    tbtrans_bin.chmod(0o755)

    def fake_stage(name, command, cwd, *, success_check, timeout=3600.0):
        return StageResult(
            name=name,
            command=command,
            cwd=cwd,
            returncode=0,
            stdout="Job completed\n" if "siesta" in name else "",
            stderr="",
            succeeded=True,
            duration_s=0.1,
        )

    siesta_info = ExecutableInfo(
        path=str(siesta_bin),
        version="5.4.2",
        sha256="s" * 64,
        runtime_banner="Siesta V5",
        package_provenance=None,
        software_environment=None,
    )
    tbtrans_info = ExecutableInfo(
        path=str(tbtrans_bin),
        version="5.4.2",
        sha256="t" * 64,
        runtime_banner="WELCOME TO TBtrans",
        package_provenance=None,
        software_environment=None,
    )

    with (
        patch("spinvault.transport.tier2.probe_siesta_executable", return_value=siesta_info),
        patch("spinvault.transport.tier2.probe_tbtrans_executable", return_value=tbtrans_info),
        patch("spinvault.transport.tier2.write_cchain_job") as write_job,
        patch("spinvault.transport.tier2._run_stage", side_effect=fake_stage),
    ):
        write_job.return_value = {"ts": workdir / "unconnected" / "0V" / "TS.fdf"}
        execution = execute_cchain_smoke(
            workdir,
            siesta_path=str(siesta_bin),
            tbtrans_path=str(tbtrans_bin),
        )

    assert execution.status == "parsed_fixture"
    assert execution.transport is not None
    assert execution.transport.solver_method.siesta_version == "5.4.2"
    assert execution.parsed is not None
    assert smoke_report(execution)["overall"] == "PASS"


def test_diagnostic_text_parser_can_parse_avtrans(tmp_path: Path):
    from spinvault.transport.parsers.diagnostic_text import DiagnosticTextParser

    path = tmp_path / "device.TBT.AVTRANS"
    path.write_text("0.0 1.0\n", encoding="utf-8")
    assert DiagnosticTextParser().can_parse(path)


def test_probe_missing_siesta_raises(tmp_path: Path):
    with pytest.raises(Tier2SmokeError, match="siesta"):
        probe_siesta_executable(str(tmp_path / "missing"))


@pytest.mark.skipif(not tier2_environment_configured(), reason="real siesta/tbtrans stack not configured")
def test_execute_cchain_smoke_real_env(tmp_path: Path):
    import os

    execution = execute_cchain_smoke(
        tmp_path / "real_smoke",
        siesta_path=os.environ.get("SPINVAULT_SIESTA", "/tmp/siesta-env/bin/siesta"),
        tbtrans_path=os.environ.get("SPINVAULT_TBTRANS", "/tmp/siesta-env/bin/tbtrans"),
        pseudo_dir=os.environ.get("SPINVAULT_CCHAIN_PSEUDO_DIR", "/tmp/cchain-pseudo"),
        timeout=900.0,
    )
    report = smoke_report(execution)
    write_smoke_report(execution)
    assert execution.status == "parsed_fixture"
    assert report["overall"] == "PASS"
    assert report["siesta_version"] == "5.4.2"
    assert report["tbtrans_version"] == "5.4.2"
    assert report["siesta_package_version"] == "5.4.2"
    assert report["tbtrans_package_version"] == "5.4.2"
    assert report["siesta_package_build"] == "nompi_h7e5ea38_1003"
    assert report["tbtrans_package_channel"] == "conda-forge"
