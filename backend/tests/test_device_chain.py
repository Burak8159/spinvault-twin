"""The NumPy device chain must agree with the JavaScript one, not merely resemble it.

Golden values come from scripts/export_device_chain_golden.mjs, which runs the
same functions the web dashboard uses. If either side changes, this fails.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from app.physics.device_chain import (
    BOLTZMANN,
    TEN_YEAR_SECONDS,
    delta_for_retention,
    effective_anisotropy,
    free_layer_volume_m3,
    julliere_transport,
    leakage_sweep,
    retention_from_delta,
    supply_function,
    thermal_stability,
    transmission,
    tunnel_current_density,
)

GOLDEN_PATH = Path(__file__).parent / "data" / "device_chain_golden.json"


def _decode(value):
    if value == "Infinity":
        return math.inf
    if value == "-Infinity":
        return -math.inf
    return value


@pytest.fixture(scope="module")
def golden() -> dict:
    return json.loads(GOLDEN_PATH.read_text())


def _snake(mapping: dict) -> dict:
    """camelCase golden inputs -> snake_case keyword arguments."""
    out = {}
    for key, value in mapping.items():
        snake = "".join(f"_{ch.lower()}" if ch.isupper() else ch for ch in key)
        out[snake] = value
    return out


def test_free_layer_volume_matches_javascript(golden: dict) -> None:
    for case in golden["volume"]:
        kwargs = _snake(case["input"])
        assert free_layer_volume_m3(**kwargs) == pytest.approx(case["volumeM3"], rel=1e-12)


def test_effective_anisotropy_matches_javascript(golden: dict) -> None:
    for case in golden["anisotropy"]:
        kwargs = _snake(case["input"])
        result = effective_anisotropy(**kwargs)
        assert result["effective_j_per_m3"] == pytest.approx(case["effectiveJPerM3"], rel=1e-12)
        assert result["shape_term_j_per_m3"] == pytest.approx(case["shapeTermJPerM3"], rel=1e-12)


def test_thermal_stability_matches_javascript(golden: dict) -> None:
    for case in golden["stability"]:
        kwargs = _snake(case["input"])
        result = thermal_stability(**kwargs)
        assert float(result["delta"]) == pytest.approx(_decode(case["delta"]), rel=1e-12)
        assert float(result["energy_barrier_j"]) == pytest.approx(case["energyBarrierJ"], rel=1e-12)
        assert float(result["energy_barrier_ev"]) == pytest.approx(case["energyBarrierEv"], rel=1e-12)


def test_retention_matches_javascript(golden: dict) -> None:
    deltas = np.array([case["delta"] for case in golden["retention"]], dtype=float)
    result = retention_from_delta(deltas)
    for index, case in enumerate(golden["retention"]):
        expected_tau = _decode(case["tauSeconds"])
        actual_tau = float(result["tau_seconds"][index])
        if math.isinf(expected_tau):
            assert math.isinf(actual_tau)
        else:
            assert actual_tau == pytest.approx(expected_tau, rel=1e-12)
        assert float(result["flip_probability"][index]) == pytest.approx(
            case["flipProbability"], rel=1e-9, abs=1e-15
        )
        assert bool(result["meets_ten_year_retention"][index]) is case["meetsTenYearRetention"]


def test_supply_function_matches_javascript(golden: dict) -> None:
    for case in golden["supply"]:
        args = case["input"]
        value = supply_function(
            args["energyEv"], args["fermiEv"], args["biasVolts"], args["temperatureK"]
        )
        assert float(value) == pytest.approx(case["supply"], rel=1e-11)


def test_transmission_matches_javascript(golden: dict) -> None:
    for case in golden["transmission"]:
        kwargs = _snake(case["input"])
        result = transmission(**kwargs)
        assert result["transmission"] == pytest.approx(case["transmission"], rel=1e-9)
        assert result["reflection"] == pytest.approx(case["reflection"], rel=1e-9)
        assert result["regime"] == case["regime"]


def test_leakage_current_matches_javascript(golden: dict) -> None:
    for case in golden["leakage"]:
        kwargs = _snake(case["input"])
        result = tunnel_current_density(**kwargs)
        assert result["current_density_a_per_m2"] == pytest.approx(
            case["currentDensityAPerM2"], rel=1e-9
        )
        assert result["regime"] == case["regime"]


def test_julliere_matches_javascript(golden: dict) -> None:
    for case in golden["julliere"]:
        kwargs = _snake(case["input"])
        result = julliere_transport(**kwargs)
        assert float(result["conductance_s"]) == pytest.approx(case["conductanceS"], rel=1e-12)
        assert result["resistance_parallel_ohm"] == pytest.approx(
            _decode(case["resistanceParallelOhm"]), rel=1e-12
        )
        assert result["tmr_ratio"] == pytest.approx(_decode(case["tmrRatio"]), rel=1e-12)


def test_retention_grows_exponentially_and_stays_finite() -> None:
    result = retention_from_delta(np.array([40.0, 60.0, 80.0]))
    tau = result["tau_seconds"]
    # Each 20 in Delta is a factor exp(20) in dwell time.
    assert tau[1] / tau[0] == pytest.approx(math.exp(20.0), rel=1e-9)
    assert tau[2] / tau[1] == pytest.approx(math.exp(20.0), rel=1e-9)
    # Far above the exp() overflow limit the model reports infinity, not NaN.
    huge = retention_from_delta(np.array([1500.0]))
    assert math.isinf(float(huge["tau_seconds"][0]))
    assert float(huge["flip_probability"][0]) == 0.0


def test_ten_year_threshold_is_self_consistent() -> None:
    delta = delta_for_retention(TEN_YEAR_SECONDS)
    just_below = retention_from_delta(np.array([delta - 1e-6]))
    just_above = retention_from_delta(np.array([delta + 1e-6]))
    assert bool(just_below["meets_ten_year_retention"][0]) is False
    assert bool(just_above["meets_ten_year_retention"][0]) is True


def test_zero_temperature_gives_infinite_stability() -> None:
    result = thermal_stability(8e5, 1.5e-24, 0.0)
    assert math.isinf(float(result["delta"]))
    retention = retention_from_delta(result["delta"])
    assert math.isinf(float(retention["tau_seconds"]))
    assert float(retention["flip_probability"]) == 0.0


def test_leakage_falls_exponentially_with_barrier_thickness() -> None:
    thicknesses = np.array([0.8, 1.0, 1.2, 1.4])
    current = leakage_sweep(
        thicknesses,
        sweep="barrier_thickness_nm",
        barrier_height_ev=1.2,
        effective_mass_ratio=0.4,
        bias_volts=0.1,
        temperature_k=300.0,
    )
    assert np.all(np.diff(current) < 0.0)
    # J ~ exp(-2 kappa d), so ln J must fall almost linearly in thickness and the
    # per-step factor must match exp(2 kappa dd) for the dominant carriers near E_F.
    ratios = current[:-1] / current[1:]
    kappa = math.sqrt(2 * 0.4 * 9.109_383_701_5e-31 * 0.4 * 1.602_176_634e-19) / 1.054_571_817e-34
    expected = math.exp(2 * kappa * 0.2e-9)
    assert np.allclose(ratios, expected, rtol=0.25)
    slopes = np.diff(np.log(current)) / np.diff(thicknesses)
    assert np.allclose(slopes, slopes[0], rtol=0.05)


def test_leakage_rises_with_bias_and_falls_with_barrier_height() -> None:
    low_bias = tunnel_current_density(1.0, 1.2, bias_volts=0.1)["current_density_a_per_m2"]
    high_bias = tunnel_current_density(1.0, 1.2, bias_volts=0.5)["current_density_a_per_m2"]
    assert high_bias > low_bias

    low_barrier = tunnel_current_density(1.0, 0.6, bias_volts=0.1)["current_density_a_per_m2"]
    high_barrier = tunnel_current_density(1.0, 2.0, bias_volts=0.1)["current_density_a_per_m2"]
    assert low_barrier > high_barrier


def test_zero_bias_carries_no_net_current() -> None:
    result = tunnel_current_density(1.0, 1.2, bias_volts=0.0)
    assert result["current_density_a_per_m2"] == pytest.approx(0.0, abs=1e-6)


def test_over_barrier_regime_is_reported_not_implied() -> None:
    tunneling = tunnel_current_density(1.0, 1.2, fermi_ev=0.8)
    over = tunnel_current_density(1.0, 0.5, fermi_ev=0.8)
    assert tunneling["regime"] == "tunneling"
    assert over["regime"] == "over_barrier"


def test_transmission_conserves_probability() -> None:
    for energy in (0.2, 0.6, 1.2, 1.8):
        result = transmission(
            barrier_thickness_nm=1.0,
            barrier_height_ev=1.2,
            electron_energy_ev=energy,
            effective_mass_ratio=0.4,
            bias_volts=0.0,
        )
        assert result["probability_conservation"] == pytest.approx(1.0, rel=1e-9)


def test_supply_function_vanishes_at_zero_bias() -> None:
    energies = np.linspace(0.01, 1.5, 25)
    supply = supply_function(energies, 0.8, 0.0, 300.0)
    assert np.allclose(supply, 0.0, atol=1e-12)


def test_supply_function_saturates_at_qv_over_kt() -> None:
    # Deep below the Fermi level both logs are linear and the difference is qV/kT.
    kt = BOLTZMANN * 300.0
    expected = (1.602_176_634e-19 * 0.3) / kt
    supply = float(supply_function(0.01, 0.8, 0.3, 300.0))
    assert supply == pytest.approx(expected, rel=1e-6)
