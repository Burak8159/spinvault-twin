"""Parse MuMax3 table/log artifacts without inventing physics interpretation."""

from __future__ import annotations

from pathlib import Path

from app.models.provenance import Provenance, utc_now
from app.models.simulation import (
    ResultSeries,
    ResultSeriesPoint,
    SimulationArtifacts,
    SimulationResult,
)
from app.solvers.mumax3.frames import find_ovf_frames
from app.solvers.mumax3.metrics import (
    SwitchingDiagnosticContext,
    magnetization_metrics_from_series,
)
from app.workers.parser import parse_table_file


def _read_text(path: Path, limit: int = 200_000) -> str | None:
    if not path.exists() or not path.is_file():
        return None
    return path.read_text(encoding="utf-8", errors="replace")[:limit]


def _parse_table(path: Path) -> list[ResultSeries]:
    """
    Parse a MuMax3-style table.txt if present.

    Expected: whitespace or comma separated, first column time-like, remaining numeric columns.
    Returns raw series only; no switching/performance inference.
    """
    parsed, _warnings = parse_table_file(path)
    return [
        ResultSeries(
            id=f"mumax-{item.id}",
            label=item.label,
            x_label="time" if item.x_unit == "s" else "x",
            x_unit=item.x_unit or "unknown",
            y_label=item.label,
            y_unit=item.y_unit or "unknown",
            points=[ResultSeriesPoint(x=x, y=y) for x, y in item.points],
        )
        for item in parsed
    ]


def find_table_file(job_dir: Path) -> Path | None:
    candidates = [
        job_dir / "outputs" / "table.txt",
        job_dir / "generated.out" / "table.txt",
    ]
    candidates.extend(sorted(job_dir.glob("*.out/table.txt")))
    candidates.extend(sorted((job_dir / "outputs").glob("**/table.txt")))
    for path in candidates:
        if path.exists():
            return path
    return None


def parse_outputs(
    job_dir: Path,
    *,
    request_hash: str,
    script_hash: str,
    script_text: str,
    solver_version: str | None,
    started_at: str,
    ended_at: str,
    success: bool,
    model_kind: str = "smoke",
    switching_context: SwitchingDiagnosticContext | None = None,
) -> SimulationResult:
    stdout = _read_text(job_dir / "stdout.log")
    stderr = _read_text(job_dir / "stderr.log")
    table = find_table_file(job_dir)
    series = _parse_table(table) if table else []
    frames = find_ovf_frames(job_dir)

    manifest = {
        "jobDir": str(job_dir),
        "files": sorted(
            str(path.relative_to(job_dir))
            for path in job_dir.rglob("*")
            if path.is_file()
        ),
        "tableFile": str(table.relative_to(job_dir)) if table else None,
        "frameCount": len(frames),
        "startedAt": started_at,
        "endedAt": ended_at,
        "requestHash": request_hash,
        "scriptHash": script_hash,
        "modelKind": model_kind,
    }

    notes = [
        f"modelKind={model_kind}",
        "MuMax3 numerical run with user-provided parameters.",
        "Not a calibrated or experimentally validated device model.",
        f"request_hash={request_hash}",
        f"script_hash={script_hash}",
        f"started_at={started_at}",
        f"ended_at={ended_at}",
        f"artifacts_dir={job_dir}",
    ]
    if table is None:
        notes.append("No table.txt found; series may be empty.")
    else:
        notes.append(f"Parsed raw table columns from {table.name} without performance inference.")
    if frames:
        notes.append(f"Cataloged {len(frames)} raw OVF magnetization frames for visualization only.")
    else:
        notes.append("No OVF magnetization frames found; spatial playback is unavailable.")

    provenance = Provenance(
        created_at=utc_now(),
        created_by="system",
        solver="mumax3",
        solver_version=solver_version,
        input_hash=request_hash,
        notes=notes,
    )

    from app.models.simulation import ResultMetric
    from app.solvers.mumax3.frames import load_ovf_frame

    ovf_summary = None
    if frames:
        try:
            parsed_last = load_ovf_frame(job_dir, frames[-1])
            ovf_summary = parsed_last.get("sanity")
        except (OSError, ValueError):
            ovf_summary = None

    metrics = [
        *magnetization_metrics_from_series(
            series, switching_context, ovf_summary=ovf_summary
        ),
        ResultMetric(
            id="model-kind",
            label="Model kind",
            display_value=model_kind,
            unit="dimensionless",
            note="Request modelKind used for script generation.",
        ),
        ResultMetric(
            id="run-status",
            label="Solver exit",
            display_value="ok" if success else "failed",
            unit="dimensionless",
            note="Subprocess completion marker, not a physics figure of merit.",
        ),
        ResultMetric(
            id="ovf-frame-count",
            label="OVF frames",
            display_value=str(len(frames)),
            unit="frames",
            note="Raw MuMax3 magnetization frame files available for visualization only.",
        ),
    ]

    summary = (
        f"MuMax3 modelKind={model_kind} completed and raw outputs were archived. "
        "Values are numerical solver outputs for the provided parameters, not a validated device prediction."
        if success
        else "MuMax3 exited with failure. Logs and any partial outputs were archived."
    )

    return SimulationResult(
        source="mumax3",
        is_physical_simulation=success,
        summary=summary,
        series=series,
        metrics=metrics,
        provenance=provenance,
        artifacts=SimulationArtifacts(
            script_preview=script_text,
            stdout=stdout,
            stderr=stderr,
            manifest=manifest,
            frames=frames,
        ),
    )
