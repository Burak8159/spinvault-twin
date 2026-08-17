"""Deterministic demo executor. Not a physical simulation."""

from __future__ import annotations

import hashlib
import json
import math

from app.models.jobs import JobWarning
from app.models.provenance import Provenance, utc_now
from app.models.simulation import (
    ResultMetric,
    ResultSeries,
    ResultSeriesPoint,
    SimulationRequest,
    SimulationResult,
)
from app.solvers.base import SolverOutcome


def _input_hash(request: SimulationRequest) -> str:
    payload = request.model_dump(mode="json", by_alias=True, exclude_none=True)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


class DemoSolver:
    name = "demo"

    def execute(self, request: SimulationRequest, *, job_id: str | None = None) -> SolverOutcome:
        digest = _input_hash(request)
        _ = job_id
        seed = int(digest[:8], 16)
        duration = max(1.0, request.controls.duration.value)
        point_count = 24
        direction = 1.0 if request.controls.current_direction == "positive_z" else -1.0
        mz_points: list[ResultSeriesPoint] = []
        current_points: list[ResultSeriesPoint] = []

        for index in range(point_count):
            phase = index / (point_count - 1)
            t = phase * duration
            # Deterministic fixture curve keyed by request hash; not physics.
            wobble = ((seed >> (index % 8)) & 0xFF) / 255.0
            mz = 0.82 - 0.18 * phase + 0.04 * math.sin(phase * 6 + wobble)
            marker = direction * (0.4 + 0.2 * math.sin(phase * 4 + wobble))
            mz_points.append(ResultSeriesPoint(x=round(t, 6), y=round(mz, 3)))
            current_points.append(ResultSeriesPoint(x=round(t, 6), y=round(marker, 3)))

        provenance = Provenance(
            created_at=utc_now(),
            created_by="demo_fixture",
            solver="demo",
            solver_version="backend-demo-0.2.0",
            input_hash=f"demo-sha256-{digest}",
            notes=[
                "Demo output",
                "source=demo_fixture",
                "is_physical_simulation=false",
                "Prepared for MuMax3 request generation; not connected.",
                "Kwant integration pending.",
                "Surrogate model not connected.",
            ],
        )
        result = SimulationResult(
            source="demo_fixture",
            is_physical_simulation=False,
            summary=(
                "Demo fixture only. Chart values are deterministic placeholders for API "
                "and UI development, not a solved magnetization trajectory."
            ),
            series=[
                ResultSeries(
                    id="mz-demo",
                    label="mz (demo fixture)",
                    x_label="Time",
                    x_unit=request.controls.duration.unit,
                    y_label="mz",
                    y_unit="dimensionless",
                    points=mz_points,
                ),
                ResultSeries(
                    id="current-demo",
                    label="Current marker (demo fixture)",
                    x_label="Time",
                    x_unit=request.controls.duration.unit,
                    y_label="Direction marker",
                    y_unit="dimensionless",
                    points=current_points,
                ),
            ],
            metrics=[
                ResultMetric(
                    id="switching-marker",
                    label="Switching marker",
                    display_value="n/a",
                    unit="dimensionless",
                    note="Not computed. Demo fixture has no switching criterion.",
                ),
                ResultMetric(
                    id="energy-marker",
                    label="Energy density marker",
                    display_value="n/a",
                    unit="dimensionless",
                    note="Not computed. No micromagnetic energy model is connected.",
                ),
                ResultMetric(
                    id="tmr-marker",
                    label="TMR marker",
                    display_value="n/a",
                    unit="dimensionless",
                    note="Not computed. Kwant/transport is not connected.",
                ),
            ],
            provenance=provenance,
        )
        return SolverOutcome(
            status="complete",
            result=result,
            warnings=[
                JobWarning(
                    code="demo-non-physical",
                    message="Demo executor returned a labeled fixture. Values are not physical results.",
                )
            ],
            provenance=provenance,
        )
