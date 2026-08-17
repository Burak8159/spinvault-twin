"""SpinVault MTJ free-layer v0 model tests."""

from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.models.jobs import JobRecord
from app.models.provenance import Provenance, utc_now
from app.models.simulation import ResultSeries, ResultSeriesPoint, SimulationRequest
from app.solvers.mumax3.adapter import Mumax3Adapter
from app.solvers.mumax3.frames import load_ovf_frame
from app.solvers.mumax3.metrics import (
    SwitchingDiagnosticContext,
    magnetization_metrics_from_series,
)
from app.solvers.mumax3.script import generate_mx3_script, resolve_model_kind
from app.solvers.mumax3.validate_request import validate_mumax_request
from app.storage.memory_store import InMemoryJobStore
from app.workers.local_worker import LocalWorker
from app.workers.queue import InMemorySimulationQueue
from tests.conftest import sample_mumax_payload


def switching_v1_payload(
    state_preset: str = "transition_0_to_1",
) -> dict:
    payload = sample_mumax_payload()
    payload["solverDrafts"]["mumax3"].update(
        {
            "modelKind": "spinvault_mtj_free_layer_switching_v1",
            "gridSize": {"nx": 64, "ny": 32, "nz": 1},
            "meshCellSize": {
                "x": {"value": 1.25, "unit": "nm"},
                "y": {"value": 1.25, "unit": "nm"},
                "z": {"value": 1.2, "unit": "nm"},
            },
            "anisotropyAxis": {"x": 0, "y": 0, "z": 1},
            "anisotropyConstant": {
                "value": 800000,
                "unit": "J/m^3",
                "source": "preset",
            },
            "pinnedDirection": {"x": 0, "y": 0, "z": 1},
            "statePreset": state_preset,
            "fieldPulseAmplitude": {
                "value": 0.6,
                "unit": "T",
                "source": "preset",
            },
            "fieldPulseDuration": {
                "value": 0.5,
                "unit": "ns",
                "source": "preset",
            },
            "switchingThreshold": 0.8,
            "simulationTime": {"value": 2, "unit": "ns", "source": "preset"},
        }
    )
    payload["externalField"] = {
        "x": {"value": 0, "unit": "T", "source": "user"},
        "y": {"value": 0, "unit": "T", "source": "user"},
        "z": {"value": 0, "unit": "T", "source": "user"},
    }
    return payload


def physically_sized_coarse_v0_payload() -> dict:
    """Return an intentionally coarse mesh whose world still matches 80×40×1.2 nm."""
    payload = sample_mumax_payload()
    payload["solverDrafts"]["mumax3"]["gridSize"] = {"nx": 8, "ny": 4, "nz": 1}
    payload["solverDrafts"]["mumax3"]["meshCellSize"] = {
        "x": {"value": 10, "unit": "nm"},
        "y": {"value": 10, "unit": "nm"},
        "z": {"value": 1.2, "unit": "nm"},
    }
    return payload


def test_default_model_kind_is_smoke() -> None:
    request = SimulationRequest.model_validate(sample_mumax_payload())
    assert resolve_model_kind(request) == "smoke"
    script = generate_mx3_script(request)
    assert "modelKind=smoke" in script
    assert "SetGeom" not in script


def test_mtj_free_layer_v0_script_includes_geometry_and_tables() -> None:
    payload = sample_mumax_payload()
    payload["solverDrafts"]["mumax3"]["modelKind"] = "spinvault_mtj_free_layer_v0"
    request = SimulationRequest.model_validate(payload)
    assert resolve_model_kind(request) == "spinvault_mtj_free_layer_v0"
    script = generate_mx3_script(request)
    assert "modelKind=spinvault_mtj_free_layer_v0" in script
    assert "SetGeom(ellipse(" in script
    assert "TableAutoSave(" in script
    assert "OutputFormat = OVF2_TEXT" in script
    assert script.count("TableSave()") == 2
    assert "autosave(m," in script
    assert script.count("save(m)") == 2
    assert "Not calibrated" in script
    assert "TMR" in script  # explicit omission note
    assert "TableAdd(B_ext)" in script


def test_visible_v0_script_uses_tilted_request_vectors_and_time() -> None:
    payload = sample_mumax_payload()
    payload["solverDrafts"]["mumax3"]["modelKind"] = (
        "spinvault_mtj_free_layer_v0_visible"
    )
    payload["solverDrafts"]["mumax3"]["simulationTime"] = {
        "value": 1,
        "unit": "ns",
        "source": "preset",
    }
    payload["initialMagnetization"]["vector"] = {"x": 0.1, "y": 0, "z": 0.995}
    payload["externalField"] = {
        "x": {"value": 0.01, "unit": "T", "source": "preset"},
        "y": {"value": 0, "unit": "T", "source": "preset"},
        "z": {"value": 0.01, "unit": "T", "source": "preset"},
    }
    script = generate_mx3_script(SimulationRequest.model_validate(payload))
    assert "modelKind=spinvault_mtj_free_layer_v0_visible" in script
    assert "m = uniform(0.1, 0, 0.995)" in script
    assert "B_ext = vector(0.01, 0, 0.01)" in script
    assert "run(1e-09)" in script
    assert "TableAutoSave(1e-11)" in script
    assert "OutputFormat = OVF2_TEXT" in script
    assert "STT/SOT" in script  # explicit omission, not implementation


def test_visible_v0_warns_when_user_caps_grid_below_dense_playback_default() -> None:
    payload = physically_sized_coarse_v0_payload()
    payload["solverDrafts"]["mumax3"]["modelKind"] = (
        "spinvault_mtj_free_layer_v0_visible"
    )
    payload["solverDrafts"]["mumax3"]["gridSize"] = {"nx": 8, "ny": 4, "nz": 1}
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert result.ok
    warnings = {warning.code: warning.message for warning in result.warnings}
    assert "mumax3-visible-grid-coarse" in warnings
    assert "64 x 32 x 2" in warnings["mumax3-visible-grid-coarse"]


def test_switching_v1_script_is_auditable_field_pulse_model() -> None:
    request = SimulationRequest.model_validate(switching_v1_payload())
    result = validate_mumax_request(request)
    assert result.ok
    script = generate_mx3_script(request)
    assert "modelKind=spinvault_mtj_free_layer_switching_v1" in script
    assert "SetGridSize(64, 32, 1)" in script
    assert "SetGeom(ellipse(" in script
    assert "Ku1 = 800000" in script
    assert "anisU = vector(0, 0, 1)" in script
    assert "statePreset = transition_0_to_1" in script
    assert "pinnedDirection (normalized) = (0, 0, 1)" in script
    assert "m = uniform(0.02, 0, -0.999799979996)" in script
    assert "B_ext = vector(0, 0, 0.6)" in script
    assert "run(5e-10)" in script
    assert "run(1.5e-09)" in script
    assert "autosave(m, 2e-11)" in script
    assert ">=100 autosaved OVF frames" in script
    assert "TableAdd(B_ext)" in script
    assert "Field-pulse excitation only; no STT/SOT/current term is used." in script
    assert "tunneling" in script
    assert "TMR" in script


def test_switching_v1_script_changes_with_physical_parameters() -> None:
    baseline_payload = switching_v1_payload()
    changed_payload = switching_v1_payload()
    changed_mumax = changed_payload["solverDrafts"]["mumax3"]
    changed_mumax["saturationMagnetization"]["value"] = 850000
    changed_mumax["exchangeStiffness"]["value"] = 1.4e-11
    changed_mumax["dampingAlpha"]["value"] = 0.025
    changed_mumax["anisotropyConstant"]["value"] = 650000
    changed_mumax["fieldPulseAmplitude"]["value"] = 0.18
    changed_mumax["fieldPulseDuration"]["value"] = 0.35
    baseline = generate_mx3_script(SimulationRequest.model_validate(baseline_payload))
    changed = generate_mx3_script(SimulationRequest.model_validate(changed_payload))
    assert baseline != changed
    assert "Msat = 850000" in changed
    assert "Aex = 1.4e-11" in changed
    assert "alpha = 0.025" in changed
    assert "Ku1 = 650000" in changed
    assert "B_ext = vector(0, 0, 0.18)" in changed
    assert "run(3.5e-10)" in changed


def test_mtj_validation_blocks_geometry_that_mesh_would_clip() -> None:
    payload = physically_sized_coarse_v0_payload()
    payload["solverDrafts"]["mumax3"]["modelKind"] = "spinvault_mtj_free_layer_v0"
    payload["solverDrafts"]["mumax3"]["gridSize"]["nx"] = 7
    payload["solverDrafts"]["mumax3"]["meshCellSize"]["z"]["value"] = 0.6
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert not result.ok
    codes = {error.code for error in result.errors}
    assert "mumax3-geom-larger-than-world" in codes
    assert "mumax3-thickness-mismatch" in codes


def test_switching_v1_state_presets_define_p_and_ap_without_a_pulse() -> None:
    ap = SimulationRequest.model_validate(switching_v1_payload("state_0_ap"))
    p = SimulationRequest.model_validate(switching_v1_payload("state_1_p"))
    ap_script = generate_mx3_script(ap)
    p_script = generate_mx3_script(p)
    assert "m = uniform(-0, -0, -1)" in ap_script
    assert "m = uniform(0, 0, 1)" in p_script
    assert "Static P/AP state preset: no switching pulse requested." in ap_script
    assert "run(2e-09)" in ap_script

    reverse = SimulationRequest.model_validate(
        switching_v1_payload("transition_1_to_0")
    )
    reverse_script = generate_mx3_script(reverse)
    assert "m = uniform(0.02, 0, 0.999799979996)" in reverse_script
    assert "Pulse target direction = (-0, -0, -1)" in reverse_script
    assert "B_ext = vector(0, 0, -0.6)" in reverse_script


def test_switching_v1_rejects_missing_anisotropy_and_transition_pulse() -> None:
    payload = switching_v1_payload()
    mumax = payload["solverDrafts"]["mumax3"]
    mumax["anisotropyConstant"] = None
    mumax["anisotropyAxis"] = None
    mumax["fieldPulseAmplitude"] = None
    mumax["fieldPulseDuration"] = None
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert not result.ok
    codes = {error.code for error in result.errors}
    assert "mumax3-anisotropy-axis-missing" in codes
    assert "mumax3-anisotropy-constant-missing" in codes
    assert "mumax3-field-pulse-missing" in codes
    assert "mumax3-field-pulse-duration-missing" in codes


def test_switching_v1_reports_overridden_m0_and_postrun_threshold() -> None:
    payload = switching_v1_payload()
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert result.ok
    codes = {warning.code for warning in result.warnings}
    assert "mumax3-m0-overridden-by-preset" in codes
    assert "mumax3-switching-threshold-postrun-only" in codes


def test_switching_v1_rejects_pulse_below_anisotropy_field() -> None:
    payload = switching_v1_payload()
    payload["solverDrafts"]["mumax3"]["fieldPulseAmplitude"] = {
        "value": 0.3,
        "unit": "T",
        "source": "preset",
    }
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert not result.ok
    assert any(error.code == "mumax3-pulse-below-switching-field" for error in result.errors)


def test_switching_v1_rejects_pinned_axis_inconsistent_with_easy_axis() -> None:
    payload = switching_v1_payload()
    payload["solverDrafts"]["mumax3"]["pinnedDirection"] = {"x": 1, "y": 0, "z": 0}
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert not result.ok
    assert any(error.code == "mumax3-pinned-anisotropy-misaligned" for error in result.errors)


def test_mtj_free_layer_v0_rect_shape() -> None:
    payload = sample_mumax_payload()
    payload["geometry"]["cellShape"] = "rectangle"
    payload["solverDrafts"]["mumax3"]["modelKind"] = "spinvault_mtj_free_layer_v0"
    script = generate_mx3_script(SimulationRequest.model_validate(payload))
    assert "SetGeom(rect(" in script


def test_mtj_free_layer_v0_validation_warnings() -> None:
    payload = physically_sized_coarse_v0_payload()
    payload["solverDrafts"]["mumax3"]["modelKind"] = "spinvault_mtj_free_layer_v0"
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert result.ok
    codes = {warning.code for warning in result.warnings}
    assert "mumax3-mtj-v0-scope" in codes
    assert "mumax3-material-labels" in codes
    assert "mumax3-unvalidated-model" in codes


def test_mtj_v0_missing_required_fields_fail_validation() -> None:
    payload = physically_sized_coarse_v0_payload()
    payload["solverDrafts"]["mumax3"]["modelKind"] = "spinvault_mtj_free_layer_v0"
    payload["solverDrafts"]["mumax3"]["saturationMagnetization"] = None
    payload["solverDrafts"]["mumax3"]["exchangeStiffness"] = None
    payload["solverDrafts"]["mumax3"]["dampingAlpha"] = None
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert not result.ok
    codes = {error.code for error in result.errors}
    assert "mumax3-saturationMagnetization-missing" in codes
    assert "mumax3-exchangeStiffness-missing" in codes
    assert "mumax3-dampingAlpha-missing" in codes


def test_mtj_v0_invalid_geometry_fails_validation() -> None:
    payload = sample_mumax_payload()
    payload["solverDrafts"]["mumax3"]["modelKind"] = "spinvault_mtj_free_layer_v0"
    payload["geometry"]["freeLayerLength"]["value"] = 0
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert not result.ok
    assert any(error.field == "geometry.freeLayerLength" for error in result.errors)


def test_mtj_v0_missing_grid_fails_validation() -> None:
    payload = sample_mumax_payload()
    payload["solverDrafts"]["mumax3"]["modelKind"] = "spinvault_mtj_free_layer_v0"
    request = SimulationRequest.model_validate(payload)
    request.solver_drafts.mumax3.grid_size = None  # type: ignore[union-attr]
    result = validate_mumax_request(request)
    assert not result.ok
    assert any(error.code == "mumax3-grid-missing" for error in result.errors)


def test_smoke_path_still_validates_without_model_kind_field() -> None:
    payload = sample_mumax_payload()
    # omit modelKind entirely — pydantic default smoke
    result = validate_mumax_request(SimulationRequest.model_validate(payload))
    assert result.ok
    assert resolve_model_kind(SimulationRequest.model_validate(payload)) == "smoke"


def test_magnetization_metrics_from_parsed_series() -> None:
    series = [
        ResultSeries(
            id="mx",
            label="mx (raw table)",
            x_label="time",
            x_unit="s",
            y_label="mx (raw table)",
            y_unit="dimensionless",
            points=[ResultSeriesPoint(x=0, y=0.1), ResultSeriesPoint(x=1e-9, y=0.2)],
        ),
        ResultSeries(
            id="my",
            label="my (raw table)",
            x_label="time",
            x_unit="s",
            y_label="my (raw table)",
            y_unit="dimensionless",
            points=[ResultSeriesPoint(x=0, y=0.0), ResultSeriesPoint(x=1e-9, y=0.05)],
        ),
        ResultSeries(
            id="mz",
            label="mz (raw table)",
            x_label="time",
            x_unit="s",
            y_label="mz (raw table)",
            y_unit="dimensionless",
            points=[ResultSeriesPoint(x=0, y=1.0), ResultSeriesPoint(x=1e-9, y=0.9)],
        ),
    ]
    metrics = {m.id: m for m in magnetization_metrics_from_series(series)}
    assert metrics["parsed-series"].display_value == "3"
    assert metrics["final-mx"].display_value.startswith("0.2")
    assert metrics["final-mz"].display_value.startswith("0.9")
    assert "mz=" in metrics["final-max-abs-m"].display_value
    assert metrics["m-state-heuristic"].display_value == "out_of_plane_positive_z"
    assert "Not validated" in metrics["m-state-heuristic"].note
    assert "TMR" in metrics["m-state-heuristic"].note
    assert metrics["raw-max-component-delta"].display_value.startswith("0.1")
    assert metrics["raw-max-component-delta"].display_value == "0.15"
    assert "consecutive parsed mean-m" in metrics["raw-max-component-delta"].note
    assert metrics["trajectory-motion"].display_value == "non_static"


def test_switching_diagnostics_report_success_and_static_no_switch() -> None:
    def make_series(values: list[tuple[float, float, float]]) -> list[ResultSeries]:
        return [
            ResultSeries(
                id=axis,
                label=f"{axis} (raw table)",
                x_label="time",
                x_unit="s",
                y_label=f"{axis} (raw table)",
                y_unit="dimensionless",
                points=[
                    ResultSeriesPoint(x=index * 1e-10, y=value[component])
                    for index, value in enumerate(values)
                ],
            )
            for component, axis in enumerate(("mx", "my", "mz"))
        ]

    context = SwitchingDiagnosticContext(
        pinned_direction=(0, 0, 1),
        state_preset="transition_0_to_1",
        threshold=0.8,
    )
    switched = {
        metric.id: metric
        for metric in magnetization_metrics_from_series(
            make_series([(0, 0, -1), (0.2, 0, 0), (0, 0, 0.95)]),
            context,
        )
    }
    assert switched["switching-occurred"].display_value == "yes"
    assert switched["final-alignment-state"].display_value == "P"

    static = {
        metric.id: metric
        for metric in magnetization_metrics_from_series(
            make_series([(0, 0, -1), (0, 0, -1)]),
            context,
        )
    }
    assert static["switching-occurred"].display_value == "no"
    assert static["trajectory-motion"].display_value == "static"
    assert static["mz-zero-crossing-time"].display_value == "unavailable"
    assert static["switching-completion-time"].display_value == "unavailable"

    assert switched["switching-onset-time"].display_value != "unavailable"
    assert switched["mz-zero-crossing-time"].display_value != "unavailable"
    assert switched["switching-completion-time"].display_value != "unavailable"
    assert switched["final-alignment-state"].display_value == "P"


def test_intermediate_state_is_not_forced_pap() -> None:
    series = [
        ResultSeries(
            id=axis,
            label=f"{axis} (raw table)",
            x_label="time",
            x_unit="s",
            y_label=f"{axis} (raw table)",
            y_unit="dimensionless",
            points=[
                ResultSeriesPoint(x=0, y=0.0 if axis != "mz" else 0.2),
                ResultSeriesPoint(x=1e-9, y=0.0 if axis != "mz" else 0.1),
            ],
        )
        for axis in ("mx", "my", "mz")
    ]
    context = SwitchingDiagnosticContext(
        pinned_direction=(0, 0, 1),
        state_preset="transition_0_to_1",
        threshold=0.8,
    )
    metrics = {m.id: m for m in magnetization_metrics_from_series(series, context)}
    assert metrics["final-alignment-state"].display_value == "intermediate"
    assert metrics["switching-occurred"].display_value == "no"


def test_ovf_table_mismatch_is_flagged() -> None:
    series = [
        ResultSeries(
            id=axis,
            label=axis,
            x_label="time",
            x_unit="s",
            y_label=axis,
            y_unit="dimensionless",
            points=[ResultSeriesPoint(x=0, y=0.0 if axis != "mz" else 1.0)],
        )
        for axis in ("mx", "my", "mz")
    ]
    metrics = {
        m.id: m
        for m in magnetization_metrics_from_series(
            series,
            ovf_summary={"meanMx": 0.0, "meanMy": 0.0, "meanMz": 0.4, "stdMz": 0.2, "normOk": True},
        )
    }
    assert metrics["ovf-table-mismatch"].display_value == "mismatch"
    assert metrics["spatial-mz-std"].display_value.startswith("0.2")
    assert metrics["energy-available"].display_value == "unavailable"


def test_worker_mtj_v0_provenance_and_metrics(tmp_path: Path) -> None:
    binary = tmp_path / "fake-mumax3"
    binary.write_text("#!/bin/sh\n", encoding="utf-8")
    binary.chmod(0o755)

    def runner(command: list[str], cwd: Path, _timeout: float):
        if "-v" in command:
            return 0, False, "mumax3 3.12\n", ""
        out_dir = cwd / "generated.out"
        out_dir.mkdir(exist_ok=True)
        (out_dir / "table.txt").write_text(
            "# t (s)\tmx ()\tmy ()\tmz ()\tB_extx (T)\n"
            "0\t0\t0\t1\t0.01\n"
            "1e-12\t0.1\t0\t0.9\t0.01\n",
            encoding="utf-8",
        )
        (out_dir / "m000000.ovf").write_text(
            "# OOMMF OVF 2.0\n"
            "# xnodes: 8\n"
            "# ynodes: 4\n"
            "# znodes: 1\n"
            "# xstepsize: 2e-9\n"
            "# ystepsize: 2e-9\n"
            "# zstepsize: 6e-10\n"
            "# valuedim: 3\n"
            "# Begin: Data Text\n"
            + "\n".join("0.1 0.0 0.995" for _ in range(32))
            + "\n# End: Data Text\n",
            encoding="utf-8",
        )
        return 0, False, "using cc=86 PTX\n", ""

    settings = Settings(mumax3_binary=str(binary), job_root=tmp_path / "jobs", worker_enabled=False)
    store = InMemoryJobStore()
    queue = InMemorySimulationQueue()
    worker = LocalWorker(
        store=store,
        queue=queue,
        settings=settings,
        adapter=Mumax3Adapter(settings=settings, runner=runner),
    )
    payload = physically_sized_coarse_v0_payload()
    payload["solverDrafts"]["mumax3"]["modelKind"] = "spinvault_mtj_free_layer_v0"
    request = SimulationRequest.model_validate(payload)
    job = JobRecord(
        job_id="job_mtj_v0",
        scenario_id=request.scenario_id,
        title=request.title,
        requested_solver="mumax3",
        status="queued",
        progress_phase="queued",
        created_at=utc_now(),
        updated_at=utc_now(),
        provenance=Provenance(created_by="system", solver="mumax3", notes=["queued"]),
        request=request,
    )
    store.create(job)
    queue.enqueue(job.job_id)
    assert worker.run_once() is True
    done = store.get(job.job_id)
    assert done is not None
    assert done.status == "complete"
    assert done.result is not None
    assert done.result.source == "mumax3"
    assert done.result.is_physical_simulation is True
    assert any(s.id.endswith("-1") or "mx" in s.label.lower() for s in done.result.series)
    assert any(note.startswith("modelKind=spinvault_mtj_free_layer_v0") for note in done.provenance.notes)
    assert any(note == "Not a calibrated or experimentally validated device model." for note in done.provenance.notes)
    assert any(note.startswith("request_hash=") for note in done.provenance.notes)
    assert any(note.startswith("script_hash=") for note in done.provenance.notes)
    assert any(note.startswith("worker_id=") for note in done.provenance.notes)
    assert any(note.startswith("artifacts_dir=") for note in done.provenance.notes)
    assert any(note.startswith("run_acceleration=") for note in done.provenance.notes)
    assert done.provenance.solver == "mumax3"
    assert done.provenance.solver_version
    metric_ids = {m.id for m in done.result.metrics}
    assert "final-mx" in metric_ids
    assert "final-my" in metric_ids
    assert "final-mz" in metric_ids
    assert "m-state-heuristic" in metric_ids
    assert "model-kind" in metric_ids
    assert "ovf-frame-count" in metric_ids
    assert not any("tmr" == m.id.lower() or "resistance" in m.id.lower() for m in done.result.metrics)
    assert done.result.artifacts is not None
    assert len(done.result.artifacts.frames) == 1
    assert done.result.artifacts.frames[0]["path"] == "outputs/m000000.ovf"
    assert done.result.artifacts.frames[0]["metadata"]["cellCount"] == 32
    assert any(w.code == "mumax3-mtj-v0-scope" for w in done.warnings)
    assert any(w.code == "mumax3-material-labels" for w in done.warnings)
    script = (settings.job_root / job.job_id / "generated.mx3").read_text(encoding="utf-8")
    assert "SetGeom(ellipse(" in script
    assert "t, mx, my, mz" in script
    assert "autosave(m," in script
    assert "save(m)" in script
    assert (settings.job_root / job.job_id / "request.json").exists()
    assert (settings.job_root / job.job_id / "generated.mx3").exists()
    assert (settings.job_root / job.job_id / "status.json").exists()
    assert (settings.job_root / job.job_id / "stdout.log").exists()
    assert (settings.job_root / job.job_id / "stderr.log").exists()
    assert (settings.job_root / job.job_id / "result.json").exists()
    assert (settings.job_root / job.job_id / "outputs" / "table.txt").exists()
    frame = load_ovf_frame(settings.job_root / job.job_id, done.result.artifacts.frames[0])
    assert len(frame["vectors"]) == 32
    assert frame["vectors"][0]["mx"] == 0.1
    assert frame["vectors"][0]["mz"] == 0.995
    assert (settings.job_root / job.job_id / "outputs" / "m000000.ovf").exists()
