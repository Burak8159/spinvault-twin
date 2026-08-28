"""Parser abstraction independent of sisl."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from spinvault.core.contracts import ArtifactManifest
from spinvault.core.taxonomy import ArtifactRole, SourceKind


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


def _all_parsers() -> list[TransmissionParser]:
    from spinvault.transport.parsers.diagnostic_text import DiagnosticTextParser
    from spinvault.transport.parsers.netcdf_direct import DirectNetcdfParser
    from spinvault.transport.parsers.sisl_netcdf import SislNetcdfParser

    return [SislNetcdfParser(), DirectNetcdfParser(), DiagnosticTextParser()]


def _parser_by_preference(preference: str) -> TransmissionParser:
    from spinvault.transport.parsers.diagnostic_text import DiagnosticTextParser
    from spinvault.transport.parsers.netcdf_direct import DirectNetcdfParser
    from spinvault.transport.parsers.sisl_netcdf import SislNetcdfParser

    mapping = {
        "text": DiagnosticTextParser(),
        "netcdf": DirectNetcdfParser(),
        "sisl": SislNetcdfParser(),
    }
    if preference not in mapping:
        raise ValueError(f"unknown parser preference: {preference}")
    return mapping[preference]


def select_parser(preference: str = "auto", path: Path | None = None) -> TransmissionParser:
    if path is not None:
        resolved = Path(path)
        if preference == "auto":
            for parser in _all_parsers():
                if parser.can_parse(resolved):
                    return parser
            raise ValueError(f"no parser can read transmission artifact: {resolved}")
        parser = _parser_by_preference(preference)
        if not parser.can_parse(resolved):
            raise ValueError(f"parser {parser.name!r} cannot read {resolved}")
        return parser

    from spinvault.transport.parsers.diagnostic_text import DiagnosticTextParser
    from spinvault.transport.parsers.netcdf_direct import DirectNetcdfParser
    from spinvault.transport.parsers.sisl_netcdf import SislNetcdfParser

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
