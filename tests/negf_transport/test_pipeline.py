from __future__ import annotations

from pathlib import Path

import pytest

from spinvault.core.quantities import UnresolvedCouplingError
from negf_transport.pipeline import refuse_retention_shortcut, refuse_stored_population, run_cchain_fixture

DATA = Path(__file__).resolve().parent / "data" / "diagnostic_transmission.txt"


def test_pipeline_writes_inputs_and_parses_diagnostic_transmission(tmp_path: Path):
    result = run_cchain_fixture(tmp_path, transmission_path=DATA, parser_preference="text")
    assert result.status == "parsed_fixture"
    assert result.transport is not None
    assert result.transport.data_source_kind.value == "SYNTHETIC_TEST_DATA"
    assert result.transport.provenance_origin.value == "PROPOSED_METHOD"
    assert result.job_files["ts"].is_file()
    assert "SolutionMethod transiesta" in result.job_files["ts"].read_text(encoding="utf-8")
    with pytest.raises(UnresolvedCouplingError):
        refuse_stored_population(result.transport)
    with pytest.raises(UnresolvedCouplingError):
        refuse_retention_shortcut(result.transport, 1.0e15)


def test_pipeline_without_solver_output_is_dry_run(tmp_path: Path):
    result = run_cchain_fixture(tmp_path)
    assert result.parsed is None
    assert result.status in {"inputs_written", "not_configured"}
    assert (tmp_path / "electrode" / "RUN.fdf").is_file()
