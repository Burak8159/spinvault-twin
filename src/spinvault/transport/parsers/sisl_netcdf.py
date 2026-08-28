"""Preferred structured path when sisl can read TBtrans NetCDF."""

from __future__ import annotations

from pathlib import Path

from spinvault.core.contracts import ArtifactManifest
from spinvault.core.taxonomy import ArtifactRole
from spinvault.transport.parsers.api import ParsedTransmission, first_existing


class SislNetcdfParser:
    name = "sisl_netcdf"

    def backend_available(self) -> bool:
        try:
            import sisl  # noqa: F401
        except ImportError:
            return False
        return True

    def can_parse(self, path: Path) -> bool:
        return path.is_file() and (path.name.endswith(".TBT.nc") or path.suffix == ".nc")

    def parse_file(self, path: Path) -> ParsedTransmission:
        if not self.backend_available():
            raise RuntimeError("sisl is not installed; use netcdf_direct or diagnostic_text")
        import sisl

        sile = sisl.get_sile(path)
        if hasattr(sile, "transmission"):
            energy, transmission = _from_tbt(sile)
        else:
            raise TypeError(f"sisl sile {type(sile)!r} has no transmission() method")
        return ParsedTransmission(
            energies_eV=tuple(float(x) for x in energy),
            transmission=tuple(float(x) for x in transmission),
            parser_name=self.name,
            data_source_kind=None,
            artifact_role=ArtifactRole.TEST_FIXTURE,
        )

    def parse_manifest(self, manifest: ArtifactManifest) -> ParsedTransmission:
        return self.parse_file(first_existing(manifest, ("tbtrans_netcdf", "tbtnc")))


def _from_tbt(sile):
    transmission = sile.transmission()
    if hasattr(sile, "E"):
        energy = sile.E
    elif hasattr(transmission, "energy"):
        energy = transmission.energy
    else:
        raise TypeError("sisl TBtrans object did not expose an energy grid")
    values = transmission if not hasattr(transmission, "ravel") else transmission.ravel()
    return energy, values
