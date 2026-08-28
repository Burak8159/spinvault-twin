"""Build TransportResult objects from parsed solver output."""

from __future__ import annotations

from spinvault.core.contracts import SolverMethodRecord, TransportGeometryMetadata, TransportResult
from spinvault.core.observables import TRANSMISSION_UNPOLARIZED
from spinvault.core.taxonomy import ArtifactRole, ParameterOrigin, SourceKind
from spinvault.transport.cchain.parameters import FIXTURE_ENERGY, FIXTURE_SPIN, SYNTHETIC_DIAGNOSTIC_TRANSMISSION
from spinvault.transport.parsers.api import ParsedTransmission


def build_transport_result(
    parsed: ParsedTransmission,
    geometry: TransportGeometryMetadata,
    *,
    run_id: str = "fixture.cchain.unconnected.0V",
    siesta_version: str | None = None,
    tbtrans_version: str | None = None,
) -> TransportResult:
    return TransportResult(
        run_id=run_id,
        energies_eV=parsed.energies_eV,
        transmission=parsed.transmission,
        transmission_matrix=None,
        spin_representation=FIXTURE_SPIN,
        energy_reference=FIXTURE_ENERGY,
        geometry=geometry,
        solver_method=SolverMethodRecord(
            xc="PBE",
            pseudopotential_ids=("tutorial.C.psf.unspecified_hash",),
            siesta_basis="SZP",
            dftu_formulation=None,
            soc=False,
            siesta_version=siesta_version,
            tbtrans_version=tbtrans_version,
            sisl_version=None,
            notes="Fixture method record. Tutorial C.psf is not a production PP family.",
        ),
        provenance_origin=ParameterOrigin.PROPOSED_METHOD,
        artifact_role=ArtifactRole.TEST_FIXTURE,
        data_source_kind=parsed.data_source_kind,
        requested_origin=(
            "SYNTHETIC_TEST_DATA"
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
