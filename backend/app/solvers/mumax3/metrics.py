"""Metrics derived only from parsed MuMax3 table series and optional OVF averages."""

from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Any

from app.models.simulation import ResultMetric, ResultSeries

TABLE_OVF_MISMATCH_TOLERANCE = 0.05


@dataclass(frozen=True)
class SwitchingDiagnosticContext:
    pinned_direction: tuple[float, float, float]
    state_preset: str
    threshold: float


def _series_by_magnetization_component(series: list[ResultSeries]) -> dict[str, ResultSeries]:
    found: dict[str, ResultSeries] = {}
    for item in series:
        token = item.y_label.lower()
        for key in ("mx", "my", "mz"):
            if key in found:
                continue
            if token.startswith(key) or f" {key}" in f" {token}" or token.split()[0].startswith(key):
                found[key] = item
    return found


def energy_series_present(series: list[ResultSeries]) -> bool:
    return any(_is_energy_series(item) for item in series)


def _is_energy_series(item: ResultSeries) -> bool:
    token = f"{item.id} {item.y_label}".lower()
    return bool(
        "e_total" in token
        or "e_exch" in token
        or "e_demag" in token
        or "e_anis" in token
        or "e_zeeman" in token
        or token.startswith("e_")
        or "energy" in token
    )


def magnetization_metrics_from_series(
    series: list[ResultSeries],
    switching: SwitchingDiagnosticContext | None = None,
    *,
    ovf_summary: dict[str, Any] | None = None,
) -> list[ResultMetric]:
    """Build final mx/my/mz and switching metrics from parsed trajectories only."""
    metrics: list[ResultMetric] = [
        ResultMetric(
            id="parsed-series",
            label="Parsed series",
            display_value=str(len(series)),
            unit="dimensionless",
            note="Raw parser count only.",
        )
    ]
    components = _series_by_magnetization_component(series)
    finals: dict[str, float] = {}
    initials: dict[str, float] = {}
    for key in ("mx", "my", "mz"):
        item = components.get(key)
        if item is None or not item.points:
            continue
        initials[key] = item.points[0].y
        value = item.points[-1].y
        finals[key] = value
        metrics.append(
            ResultMetric(
                id=f"initial-{key}",
                label=f"Initial {key}",
                display_value=f"{initials[key]:.6g}",
                unit=item.y_unit or "dimensionless",
                note="First parsed raw table sample. DERIVED from table.txt.",
            )
        )
        metrics.append(
            ResultMetric(
                id=f"final-{key}",
                label=f"Final {key}",
                display_value=f"{value:.6g}",
                unit=item.y_unit or "dimensionless",
                note="Last parsed raw table sample only. No tunneling/TMR inference.",
            )
        )

    trajectory = _aligned_trajectory(components)
    if len(trajectory) >= 2:
        max_delta = max(
            sqrt(
                (current[1] - previous[1]) ** 2
                + (current[2] - previous[2]) ** 2
                + (current[3] - previous[3]) ** 2
            )
            for previous, current in zip(trajectory, trajectory[1:])
        )
        metrics.append(
            ResultMetric(
                id="raw-max-component-delta",
                label="Max frame-to-frame mean-m delta",
                display_value=f"{max_delta:.6g}",
                unit="dimensionless",
                note=(
                    "Maximum Euclidean delta between consecutive parsed mean-m table "
                    "samples. Raw trajectory diagnostic; not a transport metric."
                ),
            )
        )
        metrics.append(
            ResultMetric(
                id="trajectory-motion",
                label="Mean-m trajectory motion",
                display_value="static" if max_delta <= 1e-6 else "non_static",
                unit="dimensionless",
                note="Static threshold is max consecutive mean-m delta <= 1e-6.",
            )
        )

    if finals:
        max_key = max(finals, key=lambda k: abs(finals[k]))
        metrics.append(
            ResultMetric(
                id="final-max-abs-m",
                label="Final max |m| component",
                display_value=f"{max_key}={abs(finals[max_key]):.6g}",
                unit="dimensionless",
                note="Derived from final mx/my/mz table samples only.",
            )
        )
        mx = finals.get("mx", 0.0)
        my = finals.get("my", 0.0)
        mz = finals.get("mz", 0.0)
        if abs(mz) >= abs(mx) and abs(mz) >= abs(my):
            heuristic = "out_of_plane_positive_z" if mz >= 0 else "out_of_plane_negative_z"
        else:
            heuristic = "in_plane_dominant"
        metrics.append(
            ResultMetric(
                id="m-state-heuristic",
                label="Magnetization state heuristic",
                display_value=heuristic,
                unit="dimensionless",
                note=(
                    "Transparent heuristic over final mx/my/mz only. "
                    "Not validated. Not a switching-success, TMR, or retention claim."
                ),
            )
        )
    if switching is not None and trajectory:
        metrics.extend(_switching_metrics(trajectory, switching))
    if ovf_summary:
        metrics.extend(_ovf_consistency_metrics(finals, ovf_summary))
        std_mz = ovf_summary.get("stdMz")
        if isinstance(std_mz, (int, float)):
            metrics.append(
                ResultMetric(
                    id="spatial-mz-std",
                    label="Spatial std(mz)",
                    display_value=f"{float(std_mz):.6g}",
                    unit="dimensionless",
                    note=(
                        "DERIVED from active OVF cells (|m|>=0.05) in the compared frame. "
                        "Nonuniformity diagnostic; not a domain-wall claim."
                    ),
                )
            )
        if ovf_summary.get("normOk") is False:
            metrics.append(
                ResultMetric(
                    id="ovf-norm-sanity",
                    label="OVF |m| sanity",
                    display_value="fail",
                    unit="dimensionless",
                    note="Active OVF cells include |m| values outside 1±0.08.",
                )
            )
        elif ovf_summary.get("normOk") is True:
            metrics.append(
                ResultMetric(
                    id="ovf-norm-sanity",
                    label="OVF |m| sanity",
                    display_value="ok",
                    unit="dimensionless",
                    note="Active OVF cells have |m| within 1±0.08.",
                )
            )
    if not energy_series_present(series):
        metrics.append(
            ResultMetric(
                id="energy-available",
                label="Energy series",
                display_value="unavailable",
                unit="dimensionless",
                note="Unavailable: energy columns were not parsed from this run's table.txt.",
            )
        )
    return metrics


def _aligned_trajectory(
    components: dict[str, ResultSeries],
) -> list[tuple[float, float, float, float]]:
    mx = components.get("mx")
    my = components.get("my")
    mz = components.get("mz")
    if mx is None or my is None or mz is None:
        return []
    count = min(len(mx.points), len(my.points), len(mz.points))
    return [
        (mx.points[index].x, mx.points[index].y, my.points[index].y, mz.points[index].y)
        for index in range(count)
    ]


def _switching_metrics(
    trajectory: list[tuple[float, float, float, float]],
    context: SwitchingDiagnosticContext,
) -> list[ResultMetric]:
    px, py, pz = context.pinned_direction
    norm = sqrt(px**2 + py**2 + pz**2)
    pinned = (px / norm, py / norm, pz / norm)
    alignments = [
        mx * pinned[0] + my * pinned[1] + mz * pinned[2]
        for _t, mx, my, mz in trajectory
    ]
    times = [sample[0] for sample in trajectory]
    mz_values = [sample[3] for sample in trajectory]
    final_alignment = alignments[-1]
    if final_alignment >= context.threshold:
        final_state = "P"
    elif final_alignment <= -context.threshold:
        final_state = "AP"
    else:
        final_state = "intermediate"

    requested = context.state_preset in {
        "transition_0_to_1",
        "transition_1_to_0",
    }
    switched = False
    if context.state_preset == "transition_0_to_1":
        switched = (
            alignments[0] <= -context.threshold
            and max(alignments) >= context.threshold
            and final_alignment >= context.threshold
        )
    elif context.state_preset == "transition_1_to_0":
        switched = (
            alignments[0] >= context.threshold
            and min(alignments) <= -context.threshold
            and final_alignment <= -context.threshold
        )

    switching_value = "yes" if switched else ("no" if requested else "not_requested")
    leave_well = context.threshold * 0.75
    onset_time = None
    completion_time = None
    zero_cross_time = None
    if context.state_preset == "transition_0_to_1":
        for time, alignment in zip(times, alignments):
            if onset_time is None and alignment > -leave_well:
                onset_time = time
            if zero_cross_time is None and alignment >= 0:
                zero_cross_time = time
            if completion_time is None and alignment >= context.threshold:
                completion_time = time
                break
    elif context.state_preset == "transition_1_to_0":
        for time, alignment in zip(times, alignments):
            if onset_time is None and alignment < leave_well:
                onset_time = time
            if zero_cross_time is None and alignment <= 0:
                zero_cross_time = time
            if completion_time is None and alignment <= -context.threshold:
                completion_time = time
                break
    else:
        for previous, current, time in zip(mz_values, mz_values[1:], times[1:]):
            if previous * current <= 0 and (previous != 0 or current != 0):
                zero_cross_time = time
                break

    settling_delta = None
    if completion_time is not None:
        after = [
            abs(current - previous)
            for (prev_t, *prev_m), (cur_t, *cur_m), previous, current in zip(
                trajectory,
                trajectory[1:],
                alignments,
                alignments[1:],
            )
            if cur_t >= completion_time
        ]
        if after:
            settling_delta = max(after)

    nonuniform = "nonuniform" if abs(alignments[0]) < context.threshold and abs(final_alignment) < context.threshold else None
    if final_state == "intermediate":
        classification = "intermediate"
    else:
        classification = final_state

    metrics = [
        ResultMetric(
            id="final-pinned-alignment",
            label="Final alignment to pinned direction",
            display_value=f"{final_alignment:.6g}",
            unit="dimensionless",
            note=(
                f"Dot product of final raw mean m and normalized pinned direction; "
                f"P/AP threshold is ±{context.threshold:.3g}."
            ),
        ),
        ResultMetric(
            id="final-alignment-state",
            label="Final P/AP alignment",
            display_value=classification,
            unit="dimensionless",
            note=(
                "P if alignment≥+threshold, AP if alignment≤−threshold, otherwise intermediate. "
                "Mean m only; not TMR or resistance."
            ),
        ),
        ResultMetric(
            id="switching-occurred",
            label="Switching occurred",
            display_value=switching_value,
            unit="dimensionless",
            note=(
                f"Preset={context.state_preset}. A transition is successful only when "
                "the trajectory starts beyond the source threshold, crosses the target "
                "threshold, and finishes beyond the target threshold."
            ),
        ),
        ResultMetric(
            id="switching-threshold",
            label="P/AP threshold",
            display_value=f"{context.threshold:.6g}",
            unit="dimensionless",
            note="Classification threshold on pinned-direction alignment of mean m.",
        ),
        ResultMetric(
            id="state-preset",
            label="Requested state preset",
            display_value=context.state_preset,
            unit="dimensionless",
            note="Request preset used to interpret switching success.",
        ),
        ResultMetric(
            id="switching-onset-time",
            label="Switching onset time",
            display_value="unavailable" if onset_time is None else f"{onset_time:.6g}",
            unit="s" if onset_time is not None else "dimensionless",
            note=(
                "DERIVED: first table sample where |alignment| falls below 0.75×threshold "
                "away from the source well. Unavailable if that crossing is not observed."
                if requested
                else "Not requested for a static P/AP preset."
            ),
        ),
        ResultMetric(
            id="mz-zero-crossing-time",
            label="mz / alignment zero crossing",
            display_value="unavailable" if zero_cross_time is None else f"{zero_cross_time:.6g}",
            unit="s" if zero_cross_time is not None else "dimensionless",
            note="DERIVED: first table sample where pinned alignment crosses 0. Unavailable if no crossing.",
        ),
        ResultMetric(
            id="switching-completion-time",
            label="Switching completion time",
            display_value="unavailable" if completion_time is None else f"{completion_time:.6g}",
            unit="s" if completion_time is not None else "dimensionless",
            note=(
                "DERIVED: first table sample that reaches the target ±threshold. "
                "Unavailable if the target well is never entered."
            ),
        ),
        ResultMetric(
            id="settling-delta",
            label="Post-completion |Δalignment| max",
            display_value="unavailable" if settling_delta is None else f"{settling_delta:.6g}",
            unit="dimensionless",
            note="DERIVED: max consecutive alignment change after completion. Unavailable if completion is not reached.",
        ),
    ]
    if nonuniform:
        metrics.append(
            ResultMetric(
                id="spatial-state-note",
                label="State note",
                display_value=nonuniform,
                unit="dimensionless",
                note="Initial and final mean alignment both inside the unresolved band.",
            )
        )
    return metrics


def _ovf_consistency_metrics(
    table_finals: dict[str, float],
    ovf_summary: dict[str, Any],
) -> list[ResultMetric]:
    metrics: list[ResultMetric] = []
    mismatches: list[str] = []
    for key, ovf_key in (("mx", "meanMx"), ("my", "meanMy"), ("mz", "meanMz")):
        table_value = table_finals.get(key)
        ovf_value = ovf_summary.get(ovf_key)
        if table_value is None or not isinstance(ovf_value, (int, float)):
            continue
        delta = abs(float(ovf_value) - table_value)
        metrics.append(
            ResultMetric(
                id=f"ovf-table-{key}-delta",
                label=f"OVF vs table Δ{key}",
                display_value=f"{delta:.6g}",
                unit="dimensionless",
                note=(
                    "DERIVED: |<m> from active OVF cells − last table.txt sample|. "
                    f"Mismatch flag if >{TABLE_OVF_MISMATCH_TOLERANCE}."
                ),
            )
        )
        if delta > TABLE_OVF_MISMATCH_TOLERANCE:
            mismatches.append(key)
    metrics.append(
        ResultMetric(
            id="ovf-table-mismatch",
            label="OVF vs table average",
            display_value="mismatch" if mismatches else "ok",
            unit="dimensionless",
            note=(
                "Compared last table.txt mean m to active-cell OVF spatial average. "
                + (
                    f"Mismatch on {', '.join(mismatches)}."
                    if mismatches
                    else "Agreement within 0.05."
                )
            ),
        )
    )
    return metrics
