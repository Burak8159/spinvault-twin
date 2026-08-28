from __future__ import annotations

from pathlib import Path

import pytest

from spinvault.core.contracts import ArtifactFile, ArtifactManifest
from spinvault.core.taxonomy import ArtifactRole, SourceKind
from spinvault.transport.parsers.api import select_parser
from spinvault.transport.parsers.diagnostic_text import DiagnosticTextParser
from spinvault.transport.parsers.netcdf_direct import DirectNetcdfParser
from spinvault.transport.parsers.sisl_netcdf import SislNetcdfParser

DATA = Path(__file__).resolve().parent / "data" / "diagnostic_transmission.txt"


def test_diagnostic_text_parser_reads_fixture_table():
    parsed = DiagnosticTextParser().parse_file(DATA)
    assert parsed.energies_eV[2] == 0.0
    assert parsed.transmission[2] == 1.0
    assert parsed.parser_name == "diagnostic_text"
    assert parsed.data_source_kind is SourceKind.SYNTHETIC_TEST_DATA
    assert parsed.artifact_role is ArtifactRole.TEST_FIXTURE


def test_manifest_text_round_trip():
    manifest = ArtifactManifest(
        run_id="fixture.parse",
        files=(ArtifactFile(path=str(DATA), kind="tbtrans_text"),),
        artifact_role=ArtifactRole.TEST_FIXTURE,
    )
    parsed = DiagnosticTextParser().parse_manifest(manifest)
    assert len(parsed.transmission) == 5


def test_auto_parser_does_not_require_sisl():
    parser = select_parser("auto")
    assert parser.name in {"sisl_netcdf", "netcdf_direct", "diagnostic_text"}
    if not SislNetcdfParser().backend_available() and not DirectNetcdfParser().backend_available():
        assert parser.name == "diagnostic_text"


def test_sisl_parser_is_optional():
    parser = SislNetcdfParser()
    if not parser.backend_available():
        with pytest.raises(RuntimeError, match="sisl"):
            parser.parse_file(DATA)


def test_direct_netcdf_is_optional_and_independent_of_sisl():
    parser = DirectNetcdfParser()
    if not parser.backend_available():
        with pytest.raises(RuntimeError, match="netCDF4"):
            parser.parse_file(DATA)
