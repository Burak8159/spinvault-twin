"""Direct NetCDF access. Does not import sisl."""

from __future__ import annotations

from pathlib import Path

from ..compat.contracts import ArtifactManifest
from ..compat.taxonomy import ArtifactRole
from .api import ParsedTransmission, first_existing


class DirectNetcdfParser:
    name = "netcdf_direct"

    def backend_available(self) -> bool:
        try:
            import netCDF4  # noqa: F401
        except ImportError:
            return False
        return True

    def can_parse(self, path: Path) -> bool:
        return path.suffix in {".nc", ".TBT.nc"} or path.name.endswith(".TBT.nc")

    def parse_file(self, path: Path) -> ParsedTransmission:
        if not self.backend_available():
            raise RuntimeError("netCDF4 is not installed; cannot use the direct NetCDF parser")
        import netCDF4

        root = netCDF4.Dataset(path)
        try:
            energy = _first_variable(root, ("E", "energy", "E_tbt"))
            transmission = _first_variable(root, ("T", "transmission", "Trans"))
            return ParsedTransmission(
                energies_eV=tuple(float(x) for x in energy[...].ravel()),
                transmission=tuple(float(x) for x in transmission[...].ravel()),
                parser_name=self.name,
                data_source_kind=None,
                artifact_role=ArtifactRole.TEST_FIXTURE,
            )
        finally:
            root.close()

    def parse_manifest(self, manifest: ArtifactManifest) -> ParsedTransmission:
        return self.parse_file(first_existing(manifest, ("tbtrans_netcdf", "tbtnc")))


def _first_variable(dataset, names: tuple[str, ...]):
    for name in names:
        if name in dataset.variables:
            return dataset.variables[name]
    raise KeyError(
        "TBtrans NetCDF is missing a recognized energy/transmission variable. "
        f"looked for {names}; found {tuple(dataset.variables)}"
    )
