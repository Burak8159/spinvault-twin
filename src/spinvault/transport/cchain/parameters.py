"""Official Simple C-chain tutorial numbers used as a software fixture.

The project chose this tutorial as the fixture. The numerical values themselves
originate in the upstream SIESTA tutorial, not in SpinVault.

ParameterOrigin is not extended here. Platform is requested to consider
UPSTREAM_REFERENCE. Until then: origin=PROPOSED_METHOD, source_kind=
OFFICIAL_SOFTWARE_TUTORIAL, mandatory exact source, artifact_role=TEST_FIXTURE.
"""

from __future__ import annotations

from spinvault.core.contracts import AppliedBias, EnergyReference, SpinRepresentation, ZERO_BIAS
from spinvault.core.taxonomy import (
    ArtifactRole,
    ParameterOrigin,
    ParameterStatus,
    REQUESTED_ORIGIN_UPSTREAM_REFERENCE,
    ScientificParameter,
    SourceKind,
)
from .pinning import TUTORIAL_DOCS_GIT_COMMIT, TUTORIAL_PATH, TUTORIAL_REPO, TUTORIAL_URL

CCHAIN_SOURCE = (
    "SIESTA Simple C-chain tutorial; "
    f"url={TUTORIAL_URL}; repo={TUTORIAL_REPO}; path={TUTORIAL_PATH}; "
    f"docs_git_commit={TUTORIAL_DOCS_GIT_COMMIT}"
)

_FIXTURE = dict(
    origin=ParameterOrigin.PROPOSED_METHOD,
    status=ParameterStatus.PROPOSED,
    artifact_role=ArtifactRole.TEST_FIXTURE,
    source=CCHAIN_SOURCE,
    source_kind=SourceKind.OFFICIAL_SOFTWARE_TUTORIAL,
    requested_origin=REQUESTED_ORIGIN_UPSTREAM_REFERENCE,
    notes=(
        "Numerical value copied from the official SIESTA Simple C-chain tutorial. "
        "The project did not invent it. Software/integration fixture only. "
        "requested_origin=UPSTREAM_REFERENCE is pending "
        "DEVELOPER_1_VERY_GOOD_PLATFORM_AWS_INTEGRATION."
    ),
)


def _p(name: str, value, unit: str | None) -> ScientificParameter:
    return ScientificParameter(name=name, value=value, unit=unit, **_FIXTURE)


TUTORIAL_PARAMETERS = {
    "c_c_bond": _p("c_c_bond", 1.5, "Ang"),
    "electrode_atom_count": _p("electrode_atom_count", 4, "1"),
    "electrode_lattice": _p("electrode_lattice", (6.0, 10.0, 10.0), "Ang"),
    "transverse_vacuum_center": _p("transverse_vacuum_center", 5.0, "Ang"),
    "unconnected_gap": _p("unconnected_gap", 3.0, "Ang"),
    "pao_basis_size": _p("pao_basis_size", "SZP", None),
    "xc_functional": _p("xc_functional", "PBE", None),
    "electrode_k_mesh": _p("electrode_k_mesh", (90, 1, 1), None),
    "device_k_mesh": _p("device_k_mesh", (1, 1, 1), None),
    "electrode_mesh_cutoff": _p("electrode_mesh_cutoff", 400.0, "Ry"),
    "device_mesh_cutoff": _p("device_mesh_cutoff", 300.0, "Ry"),
    "applied_bias": ScientificParameter(
        name="applied_bias",
        value=0.0,
        unit="V",
        origin=ParameterOrigin.PROPOSED_METHOD,
        status=ParameterStatus.PROPOSED,
        artifact_role=ArtifactRole.TEST_FIXTURE,
        source=CCHAIN_SOURCE,
        source_kind=SourceKind.OFFICIAL_SOFTWARE_TUTORIAL,
        requested_origin=REQUESTED_ORIGIN_UPSTREAM_REFERENCE,
        notes=(
            "Shared AppliedBias is a potential difference in V. Adapter: "
            "DeltaE = q_e * DeltaV, serialized as SIESTA TS.Voltage in eV in FDF only. "
            "Tutorial 0 V run; numerical coincidence of 0 V and 0 eV is not a unit identity."
        ),
    ),
    "tbtrans_energy_from": _p("tbtrans_energy_from", -10.0, "eV"),
    "tbtrans_energy_to": _p("tbtrans_energy_to", 10.0, "eV"),
    "tbtrans_energy_delta": _p("tbtrans_energy_delta", 0.01, "eV"),
    "ts_eta": _p("ts_eta", 10.0, "meV"),
}

FIXTURE_BIAS = AppliedBias(value=float(TUTORIAL_PARAMETERS["applied_bias"].value), unit="V")
assert FIXTURE_BIAS == ZERO_BIAS
assert TUTORIAL_PARAMETERS["xc_functional"].value == "PBE"
assert TUTORIAL_PARAMETERS["c_c_bond"].source_kind is SourceKind.OFFICIAL_SOFTWARE_TUTORIAL
assert "UPSTREAM_REFERENCE" not in ParameterOrigin.__members__
assert "SYNTHETIC_TEST_DATA" not in ParameterOrigin.__members__

FIXTURE_SPIN = SpinRepresentation(
    representation_id="spin.unpolarized.fixture.v0",
    collinear=False,
    noncollinear=False,
    soc=False,
    quantization_axis=None,
    magnetization_direction=None,
    solver_representation="unpolarized official C-chain tutorial",
    available_projections=("scalar_T",),
    notes=(
        "TEST_FIXTURE. source_kind=OFFICIAL_SOFTWARE_TUTORIAL. "
        "Collinear/no-SOC is a fixture choice, not production SpinVault spin physics."
    ),
)

FIXTURE_ENERGY = EnergyReference(
    reference_id="energy.tbtrans_line.tutorial.v0",
    energy_zero="TBtrans contour line as written in the official C-chain TBtrans.fdf",
    fermi_level="solver Fermi level in the TBtrans calculation",
    mu_left="e * applied_bias / 2 with applied_bias in V; adapter maps to TS.Voltage",
    mu_right="-e * applied_bias / 2 with applied_bias in V; adapter maps to TS.Voltage",
    bias_convention="AppliedBias DeltaV in V; adapter DeltaE = q_e DeltaV writes TS.Voltage in FDF only",
    unit="eV",
)

UNSET_PRODUCTION_ENERGY_GRID = ScientificParameter(
    name="NEGF_energy_grid",
    value=None,
    unit="eV",
    origin=ParameterOrigin.PROJECT_METHOD,
    status=ParameterStatus.UNSET,
    artifact_role=ArtifactRole.PRODUCTION,
    source_kind=None,
    notes="No production energy grid has been proposed yet.",
)

SYNTHETIC_DIAGNOSTIC_TRANSMISSION = ScientificParameter(
    name="diagnostic_transmission_table",
    value="tests/negf_transport/data/diagnostic_transmission.txt",
    unit=None,
    origin=ParameterOrigin.PROPOSED_METHOD,
    status=ParameterStatus.PROPOSED,
    artifact_role=ArtifactRole.TEST_FIXTURE,
    source="hand-written parser fixture; not solver output",
    source_kind=SourceKind.SYNTHETIC_TEST_DATA,
    requested_origin="SYNTHETIC_TEST_DATA",
    notes=(
        "Fabricated T(E) for parser tests. Not SOFTWARE_DEFAULT and not "
        "COMPUTED_TRANSPORT. requested_origin=SYNTHETIC_TEST_DATA pending platform."
    ),
)
