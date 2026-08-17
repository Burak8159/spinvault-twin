"""Local Python micromagnetic solver tests. Not MuMax3."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.solvers.python_llg.engine import GAMMA, MU0, integrate as integrate_macrospin
from app.solvers.python_llg.engine import MacrospinParams
from app.solvers.python_micromagnetic.artifact import (
    FRAME_FORMAT,
    load_magnetization_npz,
    save_magnetization_npz,
)
from app.solvers.python_micromagnetic.demag_newell import (
    demag_direct,
    demag_operator,
    demag_tensor_components,
    self_demag_tensor,
)
from app.solvers.python_micromagnetic.engine import (
    build_mask,
    integrate_mesh,
    prepare_initial,
    select_output_steps,
)
from app.solvers.python_micromagnetic.fields import exchange_field_tesla, recommended_dt_s
from app.solvers.python_micromagnetic.geometry import magnetic_mask, random_magnetization, uniform_magnetization
from app.solvers.python_micromagnetic.integrator import MeshParams
from tests.conftest import drain_worker, sample_demo_payload


def _params(
    *,
    nx: int = 8,
    ny: int = 4,
    dx: float = 5e-9,
    dy: float = 5e-9,
    dz: float = 1.2e-9,
    t_max: float = 5e-12,
    dt: float | None = None,
    current: float = 0.0,
    temperature: float = 0.0,
    seed: int | None = 1,
    alpha: float = 0.01,
    aex: float = 1e-11,
    ku1: float = 8e5,
    pulse_t=(0.0, 0.0, 0.0),
    pulse_duration: float = 0.0,
) -> MeshParams:
    if dt is None:
        dt = recommended_dt_s(aex=aex, msat=1e6, dx=dx, dy=dy, extra_b_tesla=1.0, safety=0.04)
    return MeshParams(
        msat=1e6,
        alpha=alpha,
        aex=aex,
        ku1=ku1,
        u_hat=(0.0, 0.0, 1.0),
        dx=dx,
        dy=dy,
        dz=dz,
        bias_t=(0.0, 0.0, 0.0),
        pulse_t=pulse_t,
        pulse_duration_s=pulse_duration,
        t_max_s=t_max,
        dt_s=dt,
        p_hat=(0.0, 0.0, 1.0),
        current_a_per_m2=current,
        current_duration_s=t_max,
        polarization=0.6,
        asymmetry=1.0,
        field_like_ratio=0.0,
        temperature_k=temperature,
        seed=seed,
    )


def test_cube_self_demag_trace() -> None:
    nxx, nyy, nzz = self_demag_tensor(1e-9, 1e-9, 1e-9)
    assert nxx == pytest.approx(1.0 / 3.0, rel=1e-6)
    assert nyy == pytest.approx(1.0 / 3.0, rel=1e-6)
    assert nzz == pytest.approx(1.0 / 3.0, rel=1e-6)
    assert nxx + nyy + nzz == pytest.approx(1.0, rel=1e-6)
    off = demag_tensor_components(0.0, 0.0, 0.0, 1e-9, 1e-9, 1e-9)
    assert abs(float(off["xy"])) < 1e-12
    assert abs(float(off["xz"])) < 1e-12
    assert abs(float(off["yz"])) < 1e-12


def test_newell_kernel_symmetries() -> None:
    dx = 1.25e-9
    plus = demag_tensor_components(2 * dx, dx, 0.0, dx, dx, 1.2e-9)
    minus = demag_tensor_components(-2 * dx, dx, 0.0, dx, dx, 1.2e-9)
    assert float(plus["xx"]) == pytest.approx(float(minus["xx"]), rel=1e-9, abs=1e-12)
    assert float(plus["xy"]) == pytest.approx(-float(minus["xy"]), rel=1e-6, abs=1e-12)
    neigh = demag_tensor_components(dx, 0.0, 0.0, dx, dx, 1.2e-9)
    assert abs(float(neigh["xy"])) < 1e-10


def test_fft_matches_direct_convolution() -> None:
    nx, ny, dx, dy, dz, msat = 8, 4, 2e-9, 2e-9, 1.2e-9, 1e6
    mask = magnetic_mask(nx, ny, dx, dy, shape="rectangle")
    rng = np.random.default_rng(0)
    m = random_magnetization(mask, rng)
    op = demag_operator(nx, ny, dx, dy, dz, msat)
    b_fft = op.field_tesla(m, mask)
    b_dir = demag_direct(m, mask, dx, dy, dz, msat)
    assert np.max(np.abs(b_fft - b_dir)) < 1e-12


def test_thin_film_uniform_demag_is_mostly_out_of_plane() -> None:
    nx, ny, dx, dy, dz, msat = 16, 8, 2.5e-9, 2.5e-9, 1.2e-9, 1e6
    mask = magnetic_mask(nx, ny, dx, dy, shape="rectangle")
    m = uniform_magnetization(mask, (0.0, 0.0, 1.0))
    b = demag_operator(nx, ny, dx, dy, dz, msat).field_tesla(m, mask)
    hz_over = b[mask, 2] / (-MU0 * msat)
    assert float(np.mean(np.abs(b[mask, 0]))) < 0.05 * MU0 * msat
    assert float(np.mean(hz_over)) > 0.7


def test_uniform_static_holds() -> None:
    params = _params(t_max=2e-12)
    mask = build_mask(8, 4, params.dx, params.dy, "rectangle")
    m0 = prepare_initial(mask, (0.0, 0.0, 1.0))
    traj = integrate_mesh(m0, mask, params, n_frames=51)
    assert traj.mz[-1] == pytest.approx(1.0, abs=2e-3)
    assert traj.max_norm_drift < 1e-6


def test_energy_decays_without_drive() -> None:
    params = _params(t_max=8e-12, current=0.0, temperature=0.0, ku1=8e5)
    mask = build_mask(8, 4, params.dx, params.dy, "rectangle")
    xs = (np.arange(8) + 0.5) * params.dx
    m0 = np.zeros((4, 8, 3), dtype=np.float64)
    m0[..., 0] = 0.25 * np.sin(2 * np.pi * xs / (8 * params.dx))
    m0[..., 2] = np.sqrt(np.maximum(0.0, 1.0 - m0[..., 0] ** 2))
    m0 = np.where(mask[:, :, None], m0, 0.0)
    traj = integrate_mesh(m0, mask, params, n_frames=51)
    assert traj.energy["e_total"][-1] < traj.energy["e_total"][0]


def test_exchange_energy_relaxes() -> None:
    params = _params(t_max=8e-12, ku1=8e5, current=0.0)
    mask = build_mask(8, 4, params.dx, params.dy, "rectangle")
    xs = (np.arange(8) + 0.5) * params.dx
    m0 = np.zeros((4, 8, 3), dtype=np.float64)
    m0[..., 0] = 0.4 * np.sin(2 * np.pi * xs / (8 * params.dx))
    m0[..., 2] = np.sqrt(np.maximum(0.0, 1.0 - m0[..., 0] ** 2))
    m0 = np.where(mask[:, :, None], m0, 0.0)
    traj = integrate_mesh(m0, mask, params, n_frames=51)
    assert traj.energy["e_ex"][-1] < traj.energy["e_ex"][0]


def test_positive_current_drives_toward_polarizer() -> None:
    params = _params(nx=1, ny=1, dx=80e-9, dy=40e-9, t_max=2e-10, current=2e11, aex=0.0)
    mask = build_mask(1, 1, params.dx, params.dy, "rectangle")
    m0 = prepare_initial(mask, (0.15, 0.0, -0.989))
    traj = integrate_mesh(m0, mask, params, n_frames=51)
    assert traj.mz[-1] > traj.mz[0]


def test_negative_current_drives_toward_ap() -> None:
    params = _params(nx=1, ny=1, dx=80e-9, dy=40e-9, t_max=2e-10, current=-2e11, aex=0.0)
    mask = build_mask(1, 1, params.dx, params.dy, "rectangle")
    m0 = prepare_initial(mask, (0.15, 0.0, 0.989))
    traj = integrate_mesh(m0, mask, params, n_frames=51)
    assert traj.mz[-1] < traj.mz[0]


def test_single_cell_tracks_macrospin() -> None:
    dt = 2e-13
    t_max = 5e-11
    mesh = _params(nx=1, ny=1, dx=80e-9, dy=40e-9, t_max=t_max, dt=dt, current=2e11, aex=0.0)
    mask = build_mask(1, 1, mesh.dx, mesh.dy, "rectangle")
    m0_vec = (0.15, 0.0, -0.9887)
    traj = integrate_mesh(prepare_initial(mask, m0_vec), mask, mesh, n_frames=51)
    macro = integrate_macrospin(
        m0_vec,
        MacrospinParams(
            msat=1e6,
            alpha=0.01,
            ku1=8e5,
            u_hat=(0.0, 0.0, 1.0),
            include_demag=True,
            bias_t=(0.0, 0.0, 0.0),
            pulse_t=(0.0, 0.0, 0.0),
            pulse_duration_s=0.0,
            t_max_s=t_max,
            dt_s=dt,
            p_hat=(0.0, 0.0, 1.0),
            current_a_per_m2=2e11,
            current_duration_s=t_max,
            polarization=0.6,
            free_thickness_m=1.2e-9,
            temperature_k=0.0,
            volume_m3=80e-9 * 40e-9 * 1.2e-9,
        ),
        max_samples=80,
    )
    assert traj.mz[-1] == pytest.approx(macro.mz[-1], abs=0.15)


def test_seed_repeatability() -> None:
    params = _params(t_max=2e-12, temperature=300.0, seed=11)
    mask = build_mask(8, 4, params.dx, params.dy, "ellipse")
    m0 = prepare_initial(mask, (0.1, 0.0, 0.995))
    a = integrate_mesh(m0, mask, params, n_frames=51)
    b = integrate_mesh(m0, mask, params, n_frames=51)
    assert np.allclose(a.mz, b.mz)
    other = _params(t_max=2e-12, temperature=300.0, seed=12)
    c = integrate_mesh(m0, mask, other, n_frames=51)
    assert not np.allclose(a.mz, c.mz)


def test_thermal_field_scales_with_temperature_and_volume() -> None:
    from app.solvers.python_micromagnetic.fields import thermal_sigma_tesla

    cell = 5e-9 * 5e-9 * 1.2e-9
    dt = 1e-14
    s300 = thermal_sigma_tesla(alpha=0.01, temperature_k=300, msat=1e6, cell_volume_m3=cell, dt_s=dt)
    s75 = thermal_sigma_tesla(alpha=0.01, temperature_k=75, msat=1e6, cell_volume_m3=cell, dt_s=dt)
    s_big = thermal_sigma_tesla(alpha=0.01, temperature_k=300, msat=1e6, cell_volume_m3=4 * cell, dt_s=dt)
    assert s300 / s75 == pytest.approx(2.0, rel=1e-6)
    assert s300 / s_big == pytest.approx(2.0, rel=1e-6)


def test_timestep_convergence() -> None:
    mask = build_mask(4, 2, 8e-9, 8e-9, "rectangle")
    m0 = prepare_initial(mask, (0.2, 0.0, 0.98))
    coarse = _params(nx=4, ny=2, dx=8e-9, dy=8e-9, t_max=4e-12, dt=4e-15, current=0.0)
    fine = _params(nx=4, ny=2, dx=8e-9, dy=8e-9, t_max=4e-12, dt=2e-15, current=0.0)
    a = integrate_mesh(m0, mask, coarse, n_frames=51)
    b = integrate_mesh(m0, mask, fine, n_frames=51)
    assert abs(a.mz[-1] - b.mz[-1]) < 0.05


def test_mesh_refinement_uniform_state() -> None:
    coarse_p = _params(nx=8, ny=4, dx=10e-9, dy=10e-9, t_max=2e-12)
    fine_p = _params(nx=16, ny=8, dx=5e-9, dy=5e-9, t_max=2e-12)
    coarse = integrate_mesh(
        prepare_initial(build_mask(8, 4, coarse_p.dx, coarse_p.dy, "rectangle"), (0.0, 0.0, 1.0)),
        build_mask(8, 4, coarse_p.dx, coarse_p.dy, "rectangle"),
        coarse_p,
        n_frames=51,
    )
    fine = integrate_mesh(
        prepare_initial(build_mask(16, 8, fine_p.dx, fine_p.dy, "rectangle"), (0.0, 0.0, 1.0)),
        build_mask(16, 8, fine_p.dx, fine_p.dy, "rectangle"),
        fine_p,
        n_frames=51,
    )
    assert coarse.mz[-1] == pytest.approx(fine.mz[-1], abs=1e-3)


def test_npz_round_trip(tmp_path) -> None:
    frames = np.zeros((3, 4, 8, 3), dtype=np.float32)
    frames[..., 2] = 1.0
    times = np.array([0.0, 1e-12, 2e-12])
    mask = np.ones((4, 8), dtype=np.uint8)
    path = tmp_path / "magnetization.npz"
    save_magnetization_npz(path, frames=frames, times=times, mask=mask, dx=1e-9, dy=1e-9, dz=1.2e-9)
    loaded = load_magnetization_npz(path)
    assert loaded["format"] == FRAME_FORMAT
    assert loaded["m"].shape == (3, 4, 8, 3)
    assert np.allclose(loaded["time_s"], times)


def test_output_frame_count_independent_of_step() -> None:
    steps = select_output_steps(100000, 2e-15, n_frames=81)
    assert 51 <= len(steps) <= 101
    assert steps[0] == 0
    assert steps[-1] == 100000


def test_exchange_field_is_zero_for_uniform_m() -> None:
    mask = magnetic_mask(8, 4, 2e-9, 2e-9, shape="ellipse")
    m = uniform_magnetization(mask, (0.0, 0.0, 1.0))
    b = exchange_field_tesla(m, mask, aex=1e-11, msat=1e6, dx=2e-9, dy=2e-9)
    assert float(np.max(np.abs(b))) < 1e-12


def test_api_python_micromagnetic_never_claims_mumax3(client: TestClient) -> None:
    payload = sample_demo_payload(requestedSolver="python_micromagnetic")
    payload["controls"]["temperature"] = {"value": 0, "unit": "K"}
    payload["solverDrafts"]["mumax3"]["simulationTime"] = {"value": 0.002, "unit": "ns"}
    payload["solverDrafts"]["mumax3"]["gridSize"] = {"nx": 8, "ny": 4, "nz": 1}
    payload["solverDrafts"]["mumax3"]["modelKind"] = "spinvault_mtj_free_layer_switching_v1"
    payload["solverDrafts"]["mumax3"]["anisotropyConstant"] = {"value": 800000, "unit": "J/m^3"}
    payload["solverDrafts"]["mumax3"]["anisotropyAxis"] = {"x": 0, "y": 0, "z": 1}
    payload["solverDrafts"]["mumax3"]["statePreset"] = "transition_0_to_1"
    payload["torque"] = {
        "mechanism": "stt",
        "enabled": True,
        "currentDensity": {"value": 2e11, "unit": "A/m^2"},
        "polarization": {"value": 0.6, "unit": "dimensionless"},
    }
    created = client.post("/api/simulations", json=payload)
    assert created.status_code == 201
    job = created.json()["job"]
    assert job["status"] == "queued"
    drain_worker(client, max_jobs=2)
    job = client.get(f"/api/simulations/{job['jobId']}").json()
    assert job["status"] == "complete"
    assert job["result"]["source"] == "python_micromagnetic"
    assert job["result"]["isPhysicalSimulation"] is True
    assert job["provenance"]["solver"] == "python_micromagnetic"
    assert "mumax3" not in job["result"]["source"]
    frames = job["result"]["artifacts"]["frames"]
    assert len(frames) >= 2
    assert frames[0]["format"] == FRAME_FORMAT
    frame = client.get(f"/api/simulations/{job['jobId']}/frames/0")
    assert frame.status_code == 200
    body = frame.json()
    assert body["frame"]["format"] == FRAME_FORMAT
    assert "Not OVF" in body["note"]
    report_response = client.get(f"/api/simulations/{job['jobId']}/matplotlib")
    assert report_response.status_code == 200
    report = report_response.json()["report"]
    assert report["format"] == "spinvault-matplotlib-twin-v1"
    assert report["source"] == "python_micromagnetic"
    assert report["mesh"] == {"nx": 8, "ny": 4, "nz": 1, "frames": len(frames)}
    assert len(report["assets"]) == 7
    assert {asset["id"] for asset in report["assets"]} >= {
        "mesh-evolution",
        "spatial-texture",
        "reversal-animation",
    }
    assert "No prescribed reversal path" in report["honesty"]
    for asset in report["assets"]:
        response = client.get(
            f"/api/simulations/{job['jobId']}/matplotlib/{asset['path']}"
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == asset["mimeType"]
        assert len(response.content) > 1_000
    blocked = client.get(
        f"/api/simulations/{job['jobId']}/matplotlib/not-in-the-manifest.png"
    )
    assert blocked.status_code == 404
    # Result JSON must not embed the mesh arrays.
    dumped = str(job["result"]).encode("utf-8")
    assert len(dumped) < 500_000
