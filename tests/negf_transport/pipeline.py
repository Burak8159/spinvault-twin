"""C-chain vertical slice: generate → detect solvers → parse.

Does not launch production SpinVault NEGF. Does not create src/spinvault.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .cchain.fdf import write_cchain_job
from .cchain.geometry import build_unconnected_device
from .cchain.parameters import (
    FIXTURE_ENERGY,
    FIXTURE_SPIN,
    SYNTHETIC_DIAGNOSTIC_TRANSMISSION,
)
from .compat.contracts import (
    ArtifactFile,
    ArtifactManifest,
    SolverMethodRecord,
    TransportResult,
)
from .compat.observables import TRANSMISSION_UNPOLARIZED
from .compat.taxonomy import (
    ArtifactRole,
    ParameterOrigin,
    REQUESTED_ORIGIN_SYNTHETIC_TEST_DATA,
    SourceKind,
)
from .executables import SolverEnvironment, probe_environment
from .parsers.api import ParsedTransmission, select_parser


@dataclass(frozen=True)
class FixturePipelineResult:
    job_files: dict[str, Path]
    environment: SolverEnvironment
    parsed: ParsedTransmission | None
    transport: TransportResult | None
    status: str


def run_cchain_fixture(
    workdir: Path,
    transmission_path: Path | None = None,
    parser_preference: str = "auto",
) -> FixturePipelineResult:
    job_files = write_cchain_job(workdir)
    environment = probe_environment()
    if transmission_path is None:
        return FixturePipelineResult(
            job_files=job_files,
            environment=environment,
            parsed=None,
            transport=None,
            status="inputs_written" if environment.configured else "not_configured",
        )
    parser = select_parser(parser_preference)
    parsed = parser.parse_file(transmission_path)
    device = build_unconnected_device()
    transport = TransportResult(
        run_id="fixture.cchain.unconnected.0V",
        energies_eV=parsed.energies_eV,
        transmission=parsed.transmission,
        transmission_matrix=None,
        spin_representation=FIXTURE_SPIN,
        energy_reference=FIXTURE_ENERGY,
        geometry=device.metadata,
        solver_method=SolverMethodRecord(
            xc="PBE",
            pseudopotential_ids=("tutorial.C.psf.unspecified_hash",),
            siesta_basis="SZP",
            dftu_formulation=None,
            soc=False,
            siesta_version=None,
            tbtrans_version=None,
            sisl_version=None,
            notes="Fixture method record. Tutorial C.psf is not a production PP family.",
        ),
        provenance_origin=ParameterOrigin.PROPOSED_METHOD,
        artifact_role=ArtifactRole.TEST_FIXTURE,
        data_source_kind=parsed.data_source_kind,
        requested_origin=(
            REQUESTED_ORIGIN_SYNTHETIC_TEST_DATA
            if parsed.data_source_kind is SourceKind.SYNTHETIC_TEST_DATA
            else None
        ),
        extra={
            "observable_definition_id": TRANSMISSION_UNPOLARIZED.definition_id,
            "parser_name": parsed.parser_name,
            "synthetic_parameter": SYNTHETIC_DIAGNOSTIC_TRANSMISSION.name
            if parsed.data_source_kind is SourceKind.SYNTHETIC_TEST_DATA
            else None,
        },
    )
    return FixturePipelineResult(
        job_files=job_files,
        environment=environment,
        parsed=parsed,
        transport=transport,
        status="parsed_fixture",
    )


def refuse_retention_shortcut(result: TransportResult, nu0_per_s: float) -> None:
    result.retention_time_from_fermi_transmission(nu0_per_s)


def refuse_stored_population(result: TransportResult) -> None:
    result.stored_population_or_raise()


def default_manifest(transmission_path: Path, run_id: str = "fixture.cchain.parse") -> ArtifactManifest:
    kind = "tbtrans_netcdf" if transmission_path.suffix == ".nc" or transmission_path.name.endswith(".TBT.nc") else "tbtrans_text"
    return ArtifactManifest(
        run_id=run_id,
        files=(ArtifactFile(path=str(transmission_path), kind=kind),),
        artifact_role=ArtifactRole.TEST_FIXTURE,
    )
