"""Registry of derived-quantity definitions. Types, not just names."""

from __future__ import annotations

from .contracts import ObservableDefinition

P_CURRENT = ObservableDefinition(
    definition_id="obs.P_current.collinear_two_channel.v0",
    name="P_current",
    quantity_type="CurrentSpinPolarization",
    formula="(I_up - I_down) / (I_up + I_down)",
    domain="collinear_two_channel",
    sign_convention="positive when up-channel current exceeds down-channel current",
    units="dimensionless",
    energy_reference_id="energy.bias_split_mu.v0",
    spin_representation_id="spin.collinear_no_soc.fixture.v0",
    dependencies=("I_up", "I_down", "SpinRepresentation"),
    notes="Undefined if the solver spin representation is not two independent channels.",
)

P_INJECTED = ObservableDefinition(
    definition_id="obs.P_injected.collinear_two_channel.v0",
    name="P_injected",
    quantity_type="InjectedSpinFraction",
    formula="explicit injection model on I_sigma(V); not P_store",
    domain="collinear_two_channel",
    sign_convention="same channel labels as SpinRepresentation",
    units="dimensionless",
    energy_reference_id="energy.bias_split_mu.v0",
    spin_representation_id="spin.collinear_no_soc.fixture.v0",
    dependencies=("I_up", "I_down"),
    notes="Injection polarization. Mapping to stored population is unresolved.",
)

TRANSMISSION_UNPOLARIZED = ObservableDefinition(
    definition_id="obs.T.unpolarized_scalar.v0",
    name="T",
    quantity_type="ScalarTransmission",
    formula="T(E) as reported by the solver for an unpolarized calculation",
    domain="unpolarized_scalar",
    sign_convention="non-negative transmission probability",
    units="dimensionless",
    energy_reference_id="energy.tbtrans_line.tutorial.v0",
    spin_representation_id="spin.unpolarized.fixture.v0",
    dependencies=("TBtrans NetCDF transmission",),
)

CONDUCTANCE = ObservableDefinition(
    definition_id="obs.G.zero_bias.v0",
    name="G",
    quantity_type="Conductance",
    formula="requires an explicit Landauer/integration definition before use",
    domain="unset_until_defined",
    sign_convention="positive conductance",
    units="S",
    energy_reference_id=None,
    spin_representation_id=None,
    dependencies=("T(E)", "EnergyReference", "occupations"),
    notes="Not implemented. Do not silently take T(E_F) as conductance.",
)

SPIN_ASYMMETRY_R = ObservableDefinition(
    definition_id="obs.R.two_channel.v0",
    name="R",
    quantity_type="TransmissionAsymmetry",
    formula="T_paper_up / T_paper_down only after an explicit channel map",
    domain="requires_explicit_paper_to_solver_map",
    sign_convention="greater than 1 when the mapped easy channel transmits more",
    units="dimensionless",
    energy_reference_id=None,
    spin_representation_id=None,
    dependencies=("T_up", "T_down", "paper_up_channel", "paper_down_channel"),
    notes="Paper R=5.48 is a WKB regression target, not an NEGF acceptance test.",
)

DEFINITIONS = {
    P_CURRENT.definition_id: P_CURRENT,
    P_INJECTED.definition_id: P_INJECTED,
    TRANSMISSION_UNPOLARIZED.definition_id: TRANSMISSION_UNPOLARIZED,
    CONDUCTANCE.definition_id: CONDUCTANCE,
    SPIN_ASYMMETRY_R.definition_id: SPIN_ASYMMETRY_R,
}
