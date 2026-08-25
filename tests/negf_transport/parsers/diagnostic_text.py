"""Diagnostic/test text reader. Not a production TBtrans path."""

from __future__ import annotations

from pathlib import Path

from ..compat.contracts import ArtifactManifest
from ..compat.taxonomy import ArtifactRole, SourceKind
from .api import ParsedTransmission, first_existing


class DiagnosticTextParser:
    name = "diagnostic_text"

    def can_parse(self, path: Path) -> bool:
        return path.suffix in {".txt", ".dat"} and path.is_file()

    def parse_file(self, path: Path) -> ParsedTransmission:
        energies: list[float] = []
        values: list[float] = []
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 2:
                raise ValueError(f"expected 'E T' columns in {path}, got: {raw}")
            energies.append(float(parts[0]))
            values.append(float(parts[1]))
        if not energies:
            raise ValueError(f"no transmission rows in {path}")
        return ParsedTransmission(
            energies_eV=tuple(energies),
            transmission=tuple(values),
            parser_name=self.name,
            data_source_kind=SourceKind.SYNTHETIC_TEST_DATA,
            artifact_role=ArtifactRole.TEST_FIXTURE,
        )

    def parse_manifest(self, manifest: ArtifactManifest) -> ParsedTransmission:
        return self.parse_file(first_existing(manifest, ("tbtrans_text", "diagnostic_text")))
