"""Resolve exact conda package provenance for executed solver binaries.

Reads conda-meta JSON from the environment prefix inferred from the resolved
executable path. Does not invoke a shell or hard-code environment paths.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json


class CondaProvenanceError(RuntimeError):
    def __init__(self, category: str, message: str):
        super().__init__(message)
        self.category = category


@dataclass(frozen=True)
class CondaPackageProvenance:
    package_name: str
    package_version: str
    package_build: str
    package_channel: str
    environment_prefix: str
    conda_meta_path: str


def detect_conda_prefix(executable_path: Path) -> Path | None:
    resolved = executable_path.resolve()
    candidate = resolved.parent
    while True:
        if (candidate / "conda-meta").is_dir():
            return candidate
        if candidate.parent == candidate:
            return None
        candidate = candidate.parent


def _package_files(meta: dict) -> set[str]:
    files: set[str] = set()
    for entry in meta.get("files") or ():
        files.add(str(entry).replace("\\", "/"))
    for entry in meta.get("link", {}).get("paths") or ():
        path = entry.get("_path") if isinstance(entry, dict) else None
        if path:
            files.add(str(path).replace("\\", "/"))
    return files


def _executable_belongs_to_package(executable_path: Path, prefix: Path, meta: dict) -> bool:
    resolved = executable_path.resolve()
    try:
        relative = resolved.relative_to(prefix.resolve())
    except ValueError:
        return False
    rel_posix = relative.as_posix()
    files = _package_files(meta)
    return rel_posix in files or f"bin/{resolved.name}" in files


def load_conda_package_provenance(
    executable_path: Path,
    *,
    package_name: str = "siesta",
) -> CondaPackageProvenance:
    resolved = executable_path.resolve()
    if not resolved.is_file():
        raise CondaProvenanceError("EXECUTABLE_NOT_FOUND", f"Executable not found: {resolved}")

    prefix = detect_conda_prefix(resolved)
    if prefix is None:
        raise CondaProvenanceError(
            "PACKAGE_PROVENANCE_AMBIGUOUS",
            f"No conda-meta directory found for executable prefix: {resolved}",
        )

    meta_dir = prefix / "conda-meta"
    candidates = sorted(
        path
        for path in meta_dir.glob(f"{package_name}-*.json")
        if path.is_file() and path.name != "history"
    )
    if not candidates:
        raise CondaProvenanceError(
            "PACKAGE_PROVENANCE_AMBIGUOUS",
            f"No conda-meta record for package {package_name!r} under {meta_dir}",
        )

    for meta_path in candidates:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if meta.get("name") != package_name:
            continue
        if not _executable_belongs_to_package(resolved, prefix, meta):
            continue
        version = str(meta.get("version") or "").strip()
        build = str(meta.get("build_string") or meta.get("build") or "").strip()
        channel = str(meta.get("channel") or "").strip()
        if not version or not build or not channel:
            raise CondaProvenanceError(
                "PACKAGE_PROVENANCE_AMBIGUOUS",
                f"Incomplete conda-meta for {package_name}: {meta_path}",
            )
        return CondaPackageProvenance(
            package_name=package_name,
            package_version=version,
            package_build=build,
            package_channel=channel,
            environment_prefix=str(prefix.resolve()),
            conda_meta_path=str(meta_path.resolve()),
        )

    raise CondaProvenanceError(
        "PACKAGE_PROVENANCE_AMBIGUOUS",
        f"Installed {package_name} metadata does not list executable {resolved}",
    )


def package_provenance_dependencies(
    *,
    label: str,
    executable_path: Path,
    executable_sha256: str,
    package: CondaPackageProvenance,
    runtime_banner: str,
) -> tuple[str, ...]:
    return (
        f"package_name={package.package_name}",
        f"package_version={package.package_version}",
        f"package_build={package.package_build}",
        f"package_channel={package.package_channel}",
        f"environment_prefix={package.environment_prefix}",
        f"conda_meta_path={package.conda_meta_path}",
        f"executable_label={label}",
        f"executable_path={executable_path.resolve()}",
        f"executable_sha256={executable_sha256}",
        f"runtime_banner={runtime_banner}",
        f"supplied_by_package={package.package_name}",
    )


def package_provenance_report_fields(
    *,
    role: str,
    package: CondaPackageProvenance,
    executable_path: Path,
    executable_sha256: str,
    runtime_banner: str,
) -> dict[str, str]:
    prefix = f"{role}_"
    return {
        f"{prefix}package_name": package.package_name,
        f"{prefix}package_version": package.package_version,
        f"{prefix}package_build": package.package_build,
        f"{prefix}package_channel": package.package_channel,
        f"{prefix}environment_prefix": package.environment_prefix,
        f"{prefix}resolved_executable_path": str(executable_path.resolve()),
        f"{prefix}executable_sha256": executable_sha256,
        f"{prefix}runtime_banner": runtime_banner,
        f"{prefix}supplied_by_package": package.package_name,
    }
