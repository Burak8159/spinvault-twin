"""OVF frame catalog, parse, and API safety tests."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.models.jobs import JobRecord
from app.models.provenance import Provenance, utc_now
from app.models.simulation import SimulationArtifacts, SimulationResult
from app.solvers.mumax3.frames import find_ovf_frames, load_ovf_frame
from app.storage.memory_store import InMemoryJobStore
from tests.conftest import sample_demo_payload


def _write_text_ovf(path: Path, *, nx: int = 2, ny: int = 2, nz: int = 1) -> None:
    rows = "\n".join(["0.1 0.0 0.995"] * (nx * ny * nz))
    path.write_text(
        "# OOMMF OVF 2.0\n"
        f"# xnodes: {nx}\n"
        f"# ynodes: {ny}\n"
        f"# znodes: {nz}\n"
        "# valuedim: 3\n"
        "# Desc: Time: 2e-11 s\n"
        "# Begin: Data Text\n"
        f"{rows}\n"
        "# End: Data Text\n",
        encoding="utf-8",
    )


def _write_binary_ovf(
    path: Path,
    *,
    binary_size: int,
    endian: str,
    vectors: list[tuple[float, ...]],
    value_dim: int = 3,
) -> None:
    check_value = 1234567.0 if binary_size == 4 else 123456789012345.0
    format_char = "f" if binary_size == 4 else "d"
    values = [check_value, *(value for vector in vectors for value in vector)]
    path.write_bytes(
        (
            "# OOMMF OVF 2.0\n"
            f"# xnodes: {len(vectors)}\n"
            "# ynodes: 1\n"
            "# znodes: 1\n"
            f"# valuedim: {value_dim}\n"
            f"# Begin: Data Binary {binary_size}\n"
        ).encode("utf-8")
        + struct.pack(f"{endian}{len(values)}{format_char}", *values)
        + f"\n# End: Data Binary {binary_size}\n".encode("utf-8")
    )


def test_find_and_parse_text_ovf(tmp_path: Path) -> None:
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    _write_text_ovf(outputs / "m000003.ovf", nx=2, ny=2, nz=1)
    frames = find_ovf_frames(tmp_path)
    assert len(frames) == 1
    assert frames[0]["path"] == "outputs/m000003.ovf"
    assert frames[0]["index"] == 3
    assert frames[0]["metadata"]["cellCount"] == 4
    assert frames[0]["metadata"]["time"] == 2e-11
    parsed = load_ovf_frame(tmp_path, frames[0])
    assert len(parsed["vectors"]) == 4
    assert parsed["vectors"][0]["mx"] == 0.1
    assert parsed["vectors"][0]["mz"] == 0.995
    assert parsed["vectors"][0]["x"] == 0
    assert parsed["vectors"][0]["y"] == 0
    assert set(parsed["vectors"][0]) == {"index", "x", "y", "z", "mx", "my", "mz", "magnitude"}


def test_path_traversal_rejected(tmp_path: Path) -> None:
    outside = tmp_path.parent / "escape.ovf"
    _write_text_ovf(outside)
    try:
        load_ovf_frame(tmp_path, {"path": "../escape.ovf", "label": "escape.ovf", "index": 0})
        assert False, "expected path traversal to raise"
    except ValueError as exc:
        assert "escapes" in str(exc).lower()


@pytest.mark.parametrize("relative_path", [r"outputs\..\..\escape.ovf", r"outputs/..\../escape.ovf"])
def test_mixed_separator_path_traversal_rejected(tmp_path: Path, relative_path: str) -> None:
    with pytest.raises(ValueError, match="escapes"):
        load_ovf_frame(tmp_path, {"path": relative_path, "label": "escape.ovf", "index": 0})


def test_windows_separator_frame_path_is_parsed(tmp_path: Path) -> None:
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    _write_text_ovf(outputs / "m000021.ovf", nx=1, ny=1, nz=1)

    parsed = load_ovf_frame(
        tmp_path,
        {"path": r"outputs\m000021.ovf", "label": "m000021.ovf", "index": 21},
    )

    assert parsed["index"] == 21
    assert len(parsed["vectors"]) == 1


def test_invalid_binary_ovf_is_rejected(tmp_path: Path) -> None:
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    path = outputs / "m000001.ovf"
    path.write_text(
        "# OOMMF OVF 2.0\n"
        "# xnodes: 2\n"
        "# ynodes: 2\n"
        "# znodes: 1\n"
            "# Begin: Data Binary 4\n"
            "not-text\n"
            "# End: Data Binary\n",
            encoding="utf-8",
        )
    try:
        load_ovf_frame(tmp_path, {"path": "outputs/m000001.ovf", "label": "m000001.ovf", "index": 1})
        assert False, "expected invalid binary OVF rejection"
    except ValueError as exc:
        assert "check value" in str(exc)


def test_binary_ovf4_is_parsed_without_text_conversion(tmp_path: Path) -> None:
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    path = outputs / "m000002.ovf"
    values = [
        1234567.0,
        0.1, 0.0, 0.995,
        0.2, 0.1, 0.97,
        -0.1, 0.2, 0.96,
        0.0, -0.2, 0.98,
    ]
    path.write_bytes(
        (
            "# OOMMF OVF 2.0\n"
            "# xnodes: 2\n"
            "# ynodes: 2\n"
            "# znodes: 1\n"
            "# valuedim: 3\n"
            "# Begin: Data Binary 4\n"
        ).encode("utf-8")
        + struct.pack(">13f", *values)
        + b"\n# End: Data Binary 4\n"
    )

    parsed = load_ovf_frame(tmp_path, {"path": "outputs/m000002.ovf", "label": "m000002.ovf", "index": 2})

    assert len(parsed["vectors"]) == 4
    assert parsed["vectors"][0]["mx"] == pytest.approx(0.1)
    assert parsed["vectors"][0]["mz"] == pytest.approx(0.995)
    assert parsed["vectors"][3]["my"] == pytest.approx(-0.2)


def test_binary_ovf8_little_endian_respects_valuedim(tmp_path: Path) -> None:
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    path = outputs / "m000008.ovf"
    _write_binary_ovf(
        path,
        binary_size=8,
        endian="<",
        value_dim=4,
        vectors=[(0.25, -0.5, 0.75, 99.0), (-1.0, 0.0, 1.0, 88.0)],
    )

    parsed = load_ovf_frame(tmp_path, {"path": "outputs/m000008.ovf", "index": 8})

    assert len(parsed["vectors"]) == 2
    assert parsed["vectors"][0]["mx"] == pytest.approx(0.25)
    assert parsed["vectors"][0]["mz"] == pytest.approx(0.75)
    assert parsed["vectors"][1]["mx"] == pytest.approx(-1.0)
    assert parsed["vectors"][1]["x"] == 1


def test_truncated_binary_ovf_is_rejected(tmp_path: Path) -> None:
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    path = outputs / "m000009.ovf"
    header = (
        "# OOMMF OVF 2.0\n"
        "# xnodes: 2\n"
        "# ynodes: 1\n"
        "# znodes: 1\n"
        "# valuedim: 3\n"
        "# Begin: Data Binary 4\n"
    ).encode("utf-8")
    path.write_bytes(
        header
        + struct.pack("<4f", 1234567.0, 0.1, 0.2, 0.3)
        + b"\n# End: Data Binary 4\n"
    )

    with pytest.raises(ValueError, match="truncated"):
        load_ovf_frame(tmp_path, {"path": "outputs/m000009.ovf", "index": 9})


def test_frame_endpoint_rejects_demo_and_out_of_range(client: TestClient) -> None:
    created = client.post("/api/simulations", json=sample_demo_payload()).json()["job"]
    response = client.get(f"/api/simulations/{created['jobId']}/frames/0")
    assert response.status_code == 422
    assert "MuMax3" in str(response.json()["detail"])


def test_frame_endpoint_serves_cataloged_text_ovf(client: TestClient) -> None:
    settings = get_settings()
    job_id = "job_ovf_preview"
    job_dir = settings.job_root / job_id
    outputs = job_dir / "outputs"
    outputs.mkdir(parents=True, exist_ok=True)
    _write_text_ovf(outputs / "m000000.ovf", nx=2, ny=2, nz=1)
    frames = find_ovf_frames(job_dir)

    store: InMemoryJobStore = client.store  # type: ignore[attr-defined]
    now = utc_now()
    store.create(
        JobRecord(
            job_id=job_id,
            scenario_id="mtj",
            title="OVF preview",
            requested_solver="mumax3",
            status="complete",
            progress_phase="complete",
            created_at=now,
            updated_at=now,
            completed_at=now,
            provenance=Provenance(created_by="system", solver="mumax3", notes=["modelKind=smoke"]),
            result=SimulationResult(
                source="mumax3",
                is_physical_simulation=True,
                summary="MuMax3 completed",
                series=[],
                metrics=[],
                provenance=Provenance(created_by="system", solver="mumax3"),
                artifacts=SimulationArtifacts(
                    script_preview="SetGridSize(2,2,1)\n",
                    frames=frames,
                ),
            ),
        )
    )

    ok = client.get(f"/api/simulations/{job_id}/frames/0")
    assert ok.status_code == 200
    body = ok.json()
    assert body["jobId"] == job_id
    assert len(body["frame"]["vectors"]) == 4
    assert "Raw MuMax3 OVF" in body["note"]

    missing = client.get(f"/api/simulations/{job_id}/frames/9")
    assert missing.status_code == 404
    assert "out of range" in missing.json()["detail"]

    frames_escape = list(frames)
    frames_escape[0] = {**frames[0], "path": "../escape.ovf"}
    job = store.get(job_id)
    assert job is not None and job.result is not None and job.result.artifacts is not None
    job.result.artifacts.frames = frames_escape
    store.update(job)
    blocked = client.get(f"/api/simulations/{job_id}/frames/0")
    assert blocked.status_code == 422
    assert "escapes" in blocked.json()["detail"].lower()


def _write_oriented_ovf(path: Path) -> None:
    path.write_text(
        "# OOMMF OVF 2.0\n"
        "# xnodes: 2\n"
        "# ynodes: 2\n"
        "# znodes: 1\n"
        "# xstepsize: 1e-9\n"
        "# ystepsize: 2e-9\n"
        "# zstepsize: 1.2e-9\n"
        "# xmin: 0\n"
        "# ymin: 0\n"
        "# zmin: 0\n"
        "# valuedim: 3\n"
        "# Desc: Time: 1e-9 s\n"
        "# Begin: Data Text\n"
        "1 0 0\n"
        "0 1 0\n"
        "0 0 1\n"
        "-0.1 0 0.995\n"
        "# End: Data Text\n",
        encoding="utf-8",
    )


def test_ovf_axis_and_component_order_not_transposed(tmp_path: Path) -> None:
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    _write_oriented_ovf(outputs / "m000000.ovf")
    parsed = load_ovf_frame(tmp_path, {"path": "outputs/m000000.ovf", "index": 0})
    by_xy = {(v["x"], v["y"]): v for v in parsed["vectors"]}
    assert by_xy[(0, 0)]["mx"] == 1
    assert by_xy[(1, 0)]["my"] == 1
    assert by_xy[(0, 1)]["mz"] == 1
    assert by_xy[(1, 1)]["mz"] == pytest.approx(0.995)
    assert parsed["sanity"]["componentOrder"] == "mx, my, mz"
    assert "x fastest" in parsed["sanity"]["axisOrder"]
    assert parsed["vectors"][0]["xMeters"] == pytest.approx(0.5e-9)
    assert parsed["vectors"][1]["yMeters"] == pytest.approx(1e-9)


def test_ovf_norm_sanity_and_active_cell_average(tmp_path: Path) -> None:
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    path = outputs / "m000001.ovf"
    path.write_text(
        "# OOMMF OVF 2.0\n"
        "# xnodes: 2\n"
        "# ynodes: 1\n"
        "# znodes: 1\n"
        "# valuedim: 3\n"
        "# Begin: Data Text\n"
        "0 0 1\n"
        "0 0 0\n"
        "# End: Data Text\n",
        encoding="utf-8",
    )
    parsed = load_ovf_frame(tmp_path, {"path": "outputs/m000001.ovf", "index": 1})
    assert parsed["sanity"]["activeCellCount"] == 1
    assert parsed["sanity"]["meanMz"] == pytest.approx(1.0)
    assert parsed["sanity"]["normOk"] is True
    assert parsed["sanity"]["stdMz"] == pytest.approx(0.0)


def test_uniform_plus_z_and_minus_z_averages(tmp_path: Path) -> None:
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    for name, mz in (("plus.ovf", 1.0), ("minus.ovf", -1.0)):
        (outputs / name).write_text(
            "# OOMMF OVF 2.0\n"
            "# xnodes: 2\n"
            "# ynodes: 2\n"
            "# znodes: 1\n"
            "# valuedim: 3\n"
            "# Begin: Data Text\n"
            + "\n".join([f"0 0 {mz}"] * 4)
            + "\n# End: Data Text\n",
            encoding="utf-8",
        )
    plus = load_ovf_frame(tmp_path, {"path": "outputs/plus.ovf", "index": 0})
    minus = load_ovf_frame(tmp_path, {"path": "outputs/minus.ovf", "index": 1})
    assert plus["sanity"]["meanMz"] == pytest.approx(1.0)
    assert minus["sanity"]["meanMz"] == pytest.approx(-1.0)
    assert plus["vectors"][0]["mz"] == pytest.approx(1.0)
    assert minus["vectors"][0]["mz"] == pytest.approx(-1.0)
