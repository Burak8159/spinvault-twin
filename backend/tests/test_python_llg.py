"""CPU Python LLGS twin tests. Not MuMax3."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.models.simulation import SimulationRequest
from app.solvers.python_llg.adapter import PythonLlgAdapter
from app.solvers.python_llg.barrier import scatter
from app.solvers.python_llg.engine import (
    MacrospinParams,
    critical_current_density,
    integrate,
    keff_and_hk,
    stt_efficiency,
    transition_initial,
)
from tests.conftest import drain_worker
from tests.test_mtj_free_layer_v0 import switching_v1_payload


def _stt_params(
    *,
    current: float,
    duration: float = 3e-9,
    temperature: float = 0.0,
    seed: int | None = None,
    thickness: float = 1.2e-9,
    volume: float = 80e-9 * 40e-9 * 1.2e-9,
    polarization: float = 0.6,
) -> MacrospinParams:
    return MacrospinParams(
        msat=1e6,
        alpha=0.01,
        ku1=8e5,
        u_hat=(0.0, 0.0, 1.0),
        include_demag=True,
        bias_t=(0.0, 0.0, 0.0),
        pulse_t=(0.0, 0.0, 0.0),
        pulse_duration_s=0.0,
        t_max_s=duration,
        dt_s=5e-13,
        p_hat=(0.0, 0.0, 1.0),
        current_a_per_m2=current,
        current_duration_s=duration,
        polarization=polarization,
        free_thickness_m=thickness,
        temperature_k=temperature,
        volume_m3=volume,
        seed=seed,
    )


def test_keff_matches_thin_film_formula() -> None:
    k_eff, mu0_hk = keff_and_hk(1e6, 8e5, out_of_plane=True)
    assert k_eff > 0
    assert mu0_hk == pytest.approx(0.343, rel=0.02)


def test_jc0_matches_linearized_macrospin_threshold() -> None:
    k_eff, _ = keff_and_hk(1e6, 8e5, out_of_plane=True)
    jc0 = critical_current_density(
        alpha=0.01,
        k_eff=k_eff,
        thickness_m=1.2e-9,
        polarization=0.6,
        asymmetry=1.0,
    )
    eta0 = stt_efficiency(0.6, 1.0, 0.0)
    assert eta0 == pytest.approx(0.3)
    expected = 4.0 * 1.602176634e-19 * 0.01 * k_eff * 1.2e-9 / (1.054571817e-34 * eta0)
    assert jc0 == pytest.approx(expected, rel=1e-12)
    assert 3e10 < jc0 < 6e10


def test_static_ap_holds() -> None:
    traj = integrate((0.0, 0.0, -1.0), _stt_params(current=0.0, duration=2e-9))
    assert abs(traj.mz[-1] + 1.0) < 1e-3
    assert traj.max_norm_drift < 1e-6
    assert traj.stochastic is False


def test_switch_0_to_1_reverses_mz() -> None:
    pinned = (0.0, 0.0, 1.0)
    params = MacrospinParams(
        msat=1e6,
        alpha=0.01,
        ku1=8e5,
        u_hat=pinned,
        include_demag=True,
        bias_t=(0.0, 0.0, 0.0),
        pulse_t=(0.2, 0.0, 0.6),
        pulse_duration_s=2e-9,
        t_max_s=2e-9,
        dt_s=5e-13,
    )
    traj = integrate(transition_initial(pinned, -1.0), params)
    assert traj.mz[-1] > 0.0


def test_stt_positive_current_writes_parallel() -> None:
    k_eff, _ = keff_and_hk(1e6, 8e5, out_of_plane=True)
    jc0 = critical_current_density(
        alpha=0.01, k_eff=k_eff, thickness_m=1.2e-9, polarization=0.6, asymmetry=1.0
    )
    traj = integrate(transition_initial((0.0, 0.0, 1.0), -1.0), _stt_params(current=5.0 * jc0))
    assert traj.mz[-1] > 0.8
    assert traj.critical_current_a_per_m2 == pytest.approx(jc0, rel=1e-12)


def test_stt_negative_current_writes_antiparallel() -> None:
    k_eff, _ = keff_and_hk(1e6, 8e5, out_of_plane=True)
    jc0 = critical_current_density(
        alpha=0.01, k_eff=k_eff, thickness_m=1.2e-9, polarization=0.6, asymmetry=1.0
    )
    traj = integrate(transition_initial((0.0, 0.0, 1.0), 1.0), _stt_params(current=-5.0 * jc0))
    assert traj.mz[-1] < -0.8


def test_stt_below_threshold_does_not_reverse() -> None:
    k_eff, _ = keff_and_hk(1e6, 8e5, out_of_plane=True)
    jc0 = critical_current_density(
        alpha=0.01, k_eff=k_eff, thickness_m=1.2e-9, polarization=0.6, asymmetry=1.0
    )
    traj = integrate(transition_initial((0.0, 0.0, 1.0), -1.0), _stt_params(current=0.2 * jc0))
    assert traj.mz[-1] < 0.0


def test_zero_temperature_is_reproducible() -> None:
    params = _stt_params(current=0.0, temperature=0.0, seed=1)
    a = integrate((0.05, 0.0, -0.9987), params)
    b = integrate((0.05, 0.0, -0.9987), params)
    assert a.mz[-1] == b.mz[-1]
    assert a.mx[-1] == b.mx[-1]


def test_thermal_field_depends_on_seed() -> None:
    a = integrate((0.05, 0.0, -0.9987), _stt_params(current=0.0, temperature=300.0, seed=1))
    b = integrate((0.05, 0.0, -0.9987), _stt_params(current=0.0, temperature=300.0, seed=2))
    assert a.stochastic is True
    assert a.mz != b.mz


def test_thicker_free_layer_raises_jc0() -> None:
    thin = critical_current_density(
        alpha=0.01, k_eff=1.7e5, thickness_m=1.0e-9, polarization=0.6, asymmetry=1.0
    )
    thick = critical_current_density(
        alpha=0.01, k_eff=1.7e5, thickness_m=2.0e-9, polarization=0.6, asymmetry=1.0
    )
    assert thick / thin == pytest.approx(2.0)


def test_barrier_unitarity_and_thicker_lowers_t() -> None:
    thin = scatter(width_m=1e-9, height_ev=1.0, energy_ev=0.4)
    thick = scatter(width_m=1.4e-9, height_ev=1.0, energy_ev=0.4)
    assert abs(thin.reflection + thin.transmission - 1.0) < 1e-6
    assert thick.transmission < thin.transmission


def _switching_payload_with_stt(preset: str, current: float, temperature: float = 0.0) -> dict:
    payload = switching_v1_payload(preset)
    payload["controls"]["temperature"] = {"value": temperature, "unit": "K", "source": "user"}
    payload["torque"] = {
        "mechanism": "stt",
        "enabled": True,
        "currentDensity": {"value": current, "unit": "A/m^2", "source": "user"},
        "polarization": {"value": 0.6, "unit": "dimensionless", "source": "user"},
    }
    payload["initialMagnetization"] = {
        "mode": "uniform",
        "vector": {"x": 0.0, "y": 0.0, "z": 1.0},
        "seed": 7,
    }
    return payload


def test_adapter_switching_job_is_python_not_mumax() -> None:
    request = SimulationRequest.model_validate(
        _switching_payload_with_stt("transition_0_to_1", 2e11)
    )
    outcome = PythonLlgAdapter().execute(request, job_id="job_py")
    assert outcome.status == "complete"
    assert outcome.result is not None
    assert outcome.result.source == "python_llg_twin"
    assert outcome.result.is_physical_simulation is True
    mz = next(s for s in outcome.result.series if s.id == "mz")
    assert mz.points[-1].y > 0.0
    occurred = next(m for m in outcome.result.metrics if m.id == "switching-occurred")
    assert occurred.display_value == "yes"
    jc0 = next(m for m in outcome.result.metrics if m.id == "jc0")
    assert float(jc0.display_value) > 0.0


def test_adapter_subthreshold_current_does_not_switch() -> None:
    request = SimulationRequest.model_validate(
        _switching_payload_with_stt("transition_0_to_1", 5e9)
    )
    outcome = PythonLlgAdapter().execute(request, job_id="job_weak")
    assert outcome.status == "complete"
    assert outcome.result is not None
    mz = next(s for s in outcome.result.series if s.id == "mz")
    assert mz.points[-1].y < 0.0
    assert any(warn.code == "python-llg-stt-below-threshold" for warn in outcome.warnings)


def test_adapter_current_sign_selects_ap() -> None:
    request = SimulationRequest.model_validate(
        _switching_payload_with_stt("transition_1_to_0", 2e11)
    )
    outcome = PythonLlgAdapter().execute(request, job_id="job_ap")
    assert outcome.status == "complete"
    assert outcome.result is not None
    mz = next(s for s in outcome.result.series if s.id == "mz")
    assert mz.points[-1].y < 0.0


def test_adapter_temperature_enters_provenance() -> None:
    request = SimulationRequest.model_validate(
        _switching_payload_with_stt("state_0_ap", 2e11, temperature=300.0)
    )
    outcome = PythonLlgAdapter().execute(request, job_id="job_t")
    assert outcome.status == "complete"
    assert outcome.result is not None
    temp = next(m for m in outcome.result.metrics if m.id == "temperature")
    assert temp.display_value == "300"
    # Static preset must ignore write current so the bit can hold.
    current = next(m for m in outcome.result.metrics if m.id == "current-density")
    assert float(current.display_value) == 0.0


def test_api_python_llg_solver_completes_without_worker(client: TestClient) -> None:
    payload = _switching_payload_with_stt("transition_0_to_1", 2e11)
    payload["requestedSolver"] = "python_llg"
    response = client.post("/api/simulations", json=payload)
    assert response.status_code == 201
    job = response.json()["job"]
    assert job["status"] == "complete"
    assert job["requestedSolver"] == "python_llg"
    assert job["result"]["source"] == "python_llg_twin"
    mz = next(s for s in job["result"]["series"] if s["id"] == "mz")
    assert mz["points"][-1]["y"] > 0.8


def test_api_mumax_switching_does_not_substitute_python_llg(client: TestClient) -> None:
    response = client.post("/api/simulations", json=switching_v1_payload("transition_0_to_1"))
    assert response.status_code == 201
    job = response.json()["job"]
    drain_worker(client)
    job = client.get(f"/api/simulations/{job['jobId']}").json()
    assert job["status"] == "not_configured"
    assert job["result"] is None
    assert any(error["code"] == "mumax3_not_configured" for error in job["errors"])
