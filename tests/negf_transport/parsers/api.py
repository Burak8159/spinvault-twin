"""Parser abstraction independent of sisl.

Preferred path: TBtrans NetCDF, accessed through sisl when compatible.
Fallbacks: direct NetCDF, then diagnostic text for tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from ..compat.contracts import ArtifactManifest
from ..compat.taxonomy import ArtifactRole, SourceKind


@dataclass(frozen=True)
class ParsedTransmission:
    energies_eV: tuple[float, ...]
    transmission: tuple[float, ...]
    parser_name: str
    data_source_kind: SourceKind | None
    artifact_role: ArtifactRole = ArtifactRole.TEST_FIXTURE


class TransmissionParser(Protocol):
    name: str

    def can_parse(self, path: Path) -> bool: ...

    def parse_file(self, path: Path) -> ParsedTransmission: ...

    def parse_manifest(self, manifest: ArtifactManifest) -> ParsedTransmission: ...


def select_parser(preference: str = "auto") -> TransmissionParser:
    from .diagnostic_text import DiagnosticTextParser
    from .netcdf_direct import DirectNetcdfParser
    from .sisl_netcdf import SislNetcdfParser

    text = DiagnosticTextParser()
    netcdf = DirectNetcdfParser()
    sisl_parser = SislNetcdfParser()
    if preference == "text":
        return text
    if preference == "netcdf":
        return netcdf
    if preference == "sisl":
        return sisl_parser
    if preference != "auto":
        raise ValueError(f"unknown parser preference: {preference}")
    if sisl_parser.backend_available():
        return sisl_parser
    if netcdf.backend_available():
        return netcdf
    return text


def first_existing(manifest: ArtifactManifest, kinds: tuple[str, ...]) -> Path:
    for item in manifest.files:
        if item.kind in kinds:
            path = Path(item.path)
            if path.is_file():
                return path
    raise FileNotFoundError(f"no artifact of kinds {kinds} in manifest {manifest.run_id}")
