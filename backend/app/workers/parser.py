"""Worker-side parser for known solver table outputs.

Does not infer switching, TMR, energy figures of merit, or other physics conclusions.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

from pydantic import Field

from app.models.provenance import CamelModel, Provenance, utc_now
from app.workers.artifacts import ArtifactRef


class ParsedSeries(CamelModel):
    id: str
    label: str
    x_unit: str | None = Field(default=None, alias="xUnit")
    y_unit: str | None = Field(default=None, alias="yUnit")
    points: list[tuple[float, float]] = Field(default_factory=list)
    source_file: str = Field(alias="sourceFile")


class ParsedSimulationResult(CamelModel):
    job_id: str = Field(alias="jobId")
    solver: str
    is_physical_simulation: bool = Field(alias="isPhysicalSimulation")
    series: list[ParsedSeries] = Field(default_factory=list)
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    provenance: Provenance
    warnings: list[str] = Field(default_factory=list)


_COLUMN_WITH_UNIT = re.compile(r"(?P<label>[^\s(),]+)\s*\((?P<unit>[^)]*)\)")


def _known_unit(label: str) -> str | None:
    lowered = label.lower().lstrip("#").strip()
    if lowered in {"t", "time"} or lowered.startswith("t["):
        return "s"
    if lowered in {"mx", "my", "mz", "m", "m_x", "m_y", "m_z"}:
        return "dimensionless"
    return None


def _parse_header(line: str) -> tuple[list[str], list[str | None]] | None:
    """Parse a known MuMax3 header, including '# t (s)\\tmx ()...'."""
    content = line.strip().lstrip("\ufeff")
    if content.startswith("#"):
        content = content[1:].strip()

    fields: list[str]
    if "\t" in content:
        fields = [field.strip() for field in content.split("\t") if field.strip()]
    elif "," in content:
        fields = [
            field.strip()
            for field in next(csv.reader([content]))
            if field.strip()
        ]
    else:
        matches = list(_COLUMN_WITH_UNIT.finditer(content))
        if len(matches) >= 2:
            return (
                [match.group("label") for match in matches],
                [
                    match.group("unit").strip() or "dimensionless"
                    for match in matches
                ],
            )
        fields = content.split()

    if len(fields) < 2:
        return None

    labels: list[str] = []
    units: list[str | None] = []
    for field in fields:
        match = _COLUMN_WITH_UNIT.fullmatch(field)
        if match:
            labels.append(match.group("label"))
            units.append(match.group("unit").strip() or "dimensionless")
        else:
            labels.append(field)
            units.append(None)

    first = labels[0].lower().lstrip("#")
    if first not in {"t", "time"} and _known_unit(first) != "s":
        return None
    return labels, units


def _split_data_row(line: str) -> list[str]:
    if "\t" in line:
        return [cell.strip() for cell in line.split("\t")]
    if "," in line:
        return [cell.strip() for cell in next(csv.reader([line]))]
    return line.split()


def _is_numeric_row(row: list[str]) -> bool:
    if not row:
        return False
    try:
        [float(cell) for cell in row if cell != ""]
    except ValueError:
        return False
    return True


def parse_table_file(path: Path) -> tuple[list[ParsedSeries], list[str]]:
    """Parse known MuMax3 TSV plus simple whitespace/CSV tables."""
    warnings: list[str] = []
    if not path.exists():
        return [], [f"Missing table file: {path.name}"]

    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        return [], [f"Empty table file: {path.name}"]

    labels: list[str] | None = None
    declared_units: list[str | None] = []
    data_rows: list[list[str]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip().lstrip("\ufeff")
        if not line:
            continue
        if labels is None:
            parsed_header = _parse_header(line)
            if parsed_header is not None:
                labels, declared_units = parsed_header
                continue
        if line.startswith("#"):
            continue
        row = _split_data_row(line)
        if not any(row):
            continue
        if labels is None and not _is_numeric_row(row):
            labels = [cell.strip() or f"col{i}" for i, cell in enumerate(row)]
            declared_units = [None] * len(labels)
            continue
        data_rows.append(row)

    if labels is None:
        if not data_rows:
            return [], [f"Malformed or insufficient table rows in {path.name}."]
        width = len(data_rows[0])
        labels = [f"col{i}" for i in range(width)]
        declared_units = [None] * width
        warnings.append(f"{path.name}: no header found; columns labeled col0..colN.")

    if not data_rows:
        return [], [f"Malformed or insufficient table rows in {path.name}."]

    if len(labels) < 2:
        return [], [f"Malformed table header in {path.name}."]

    columns: list[list[tuple[float, float]]] = [[] for _ in labels[1:]]
    skipped = 0
    for row in data_rows:
        if len(row) < 2:
            skipped += 1
            continue
        try:
            x = float(row[0])
        except ValueError:
            skipped += 1
            continue
        for index, cell in enumerate(row[1 : len(labels)]):
            try:
                y = float(cell)
            except ValueError:
                skipped += 1
                continue
            columns[index].append((x, y))

    if skipped:
        warnings.append(f"{path.name}: skipped {skipped} malformed cell/row values.")

    series: list[ParsedSeries] = []
    x_label = labels[0]
    x_unit = declared_units[0] or _known_unit(x_label)
    relative = path.name
    for index, points in enumerate(columns):
        if not points:
            continue
        label = labels[index + 1]
        known_unit = _known_unit(label)
        y_unit = declared_units[index + 1] or known_unit
        series.append(
            ParsedSeries(
                id=f"{path.stem}-{index + 1}",
                label=(
                    f"{label} (raw table)"
                    if known_unit is not None
                    else f"{label} (unknown column)"
                ),
                x_unit=x_unit,
                y_unit=y_unit,
                points=points,
                source_file=relative,
            )
        )

    if not series:
        warnings.append(f"No numeric series parsed from {path.name}.")
    return series, warnings


def find_table_candidates(job_dir: Path) -> list[Path]:
    # run_mumax3 copies .out artifacts into outputs/. Prefer that stable contract
    # and only inspect native *.out folders as a fallback to avoid duplicate series.
    output_candidates = (
        sorted((job_dir / "outputs").glob("**/table.txt"))
        if (job_dir / "outputs").exists()
        else []
    )
    if output_candidates:
        return output_candidates

    native_candidates = [job_dir / "generated.out" / "table.txt"]
    native_candidates.extend(sorted(job_dir.glob("*.out/table.txt")))
    seen: set[Path] = set()
    unique: list[Path] = []
    for path in native_candidates:
        resolved = path.resolve() if path.exists() else path
        if path.exists() and resolved not in seen:
            seen.add(resolved)
            unique.append(path)
    return unique


def parse_job_outputs(
    job_dir: Path,
    *,
    job_id: str,
    solver: str,
    is_physical_simulation: bool,
    provenance: Provenance,
    artifact_refs: list[ArtifactRef] | None = None,
) -> ParsedSimulationResult:
    series: list[ParsedSeries] = []
    warnings: list[str] = []
    tables = find_table_candidates(job_dir)
    if not tables:
        warnings.append("No known table output files found.")
    for table in tables:
        parsed, table_warnings = parse_table_file(table)
        series.extend(parsed)
        warnings.extend(table_warnings)

    return ParsedSimulationResult(
        job_id=job_id,
        solver=solver,
        is_physical_simulation=is_physical_simulation,
        series=series,
        artifacts=artifact_refs or [],
        provenance=provenance,
        warnings=warnings,
    )
