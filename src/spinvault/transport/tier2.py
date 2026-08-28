"""Tier-2 C-chain smoke: pinned siesta + tbtrans execution and provenance."""

from __future__ import annotations

from dataclasses import dataclass
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Callable

from spinvault.core.contracts import CalculationSpec, ZERO_BIAS
from spinvault.core.identity import sha256_file
from spinvault.core.taxonomy import ArtifactRole, ParameterOrigin, ParameterStatus
from spinvault.core.validation import require_executable
from spinvault.transport.cchain.fdf import write_cchain_job
from spinvault.transport.cchain.geometry import build_unconnected_device
from spinvault.transport.executables import probe_environment, version_line
from spinvault.transport.partition import CChainWorkdirs
from spinvault.transport.parsers.api import ParsedTransmission, select_parser
from spinvault.transport.result_builders import build_transport_result
from spinvault.core.contracts import SoftwareEnvironmentRecord, TransportResult
from spinvault.transport.conda_provenance import (
    CondaProvenanceError,
    CondaPackageProvenance,
    load_conda_package_provenance,
    package_provenance_dependencies,
    package_provenance_report_fields,
)

TIER2_BASELINE = "f055273f81c1a6fd0543dcb813ce28d57faea763"
TIER2_CALCULATION_ID = "calc.fixture.cchain.unconnected.0V.tier2"
C_PSF_SOURCE = (
    "https://gitlab.com/siesta-project/siesta/-/raw/master/Tests/Pseudos/C.psf"
)


class Tier2SmokeError(RuntimeError):
    """Raised when Tier-2 smoke preconditions or solver stages fail."""


@dataclass(frozen=True)
class ExecutableInfo:
    path: str
    version: str | None
    sha256: str | None
    runtime_banner: str | None = None
    package_provenance: CondaPackageProvenance | None = None
    software_environment: SoftwareEnvironmentRecord | None = None


@dataclass(frozen=True)
class StageResult:
    name: str
    command: tuple[str, ...]
    cwd: Path
    returncode: int
    stdout: str
    stderr: str
    succeeded: bool
    duration_s: float


@dataclass(frozen=True)
class CChainSmokeExecution:
    workdir: Path
    calculation_id: str
    run_id: str
    siesta: ExecutableInfo
    tbtrans: ExecutableInfo
    stages: tuple[StageResult, ...]
    transmission_path: Path | None
    parsed: ParsedTransmission | None
    transport: TransportResult | None
    status: str
    pseudo_path: Path | None = None


_SIESTA_VERSION_RE = re.compile(
    r"(?:Siesta\s+(?:Version\s+)?(?P<v>[0-9][^\s,;]*))|(Siesta\s+V5)",
    re.IGNORECASE,
)
_TBTRANS_VERSION_RE = re.compile(
    r"(?:TBtrans\s+(?:Version\s+)?(?P<v>[0-9][^\s,;]*))|(WELCOME\s+TO\s+TBtrans)",
    re.IGNORECASE,
)


def parse_siesta_version(text: str) -> str | None:
    for match in _SIESTA_VERSION_RE.finditer(text):
        if match.group("v"):
            return f"Siesta {match.group('v')}"
        if match.group(2):
            return "Siesta V5"
    if "Siesta V5" in text:
        return "Siesta V5"
    return None


def parse_tbtrans_version(text: str) -> str | None:
    for match in _TBTRANS_VERSION_RE.finditer(text):
        if match.group("v"):
            return f"TBtrans {match.group('v')}"
        if match.group(2):
            return "WELCOME TO TBtrans"
    if "WELCOME TO TBtrans" in text:
        return "WELCOME TO TBtrans"
    return None


def _executable_sha256(path: str) -> str | None:
    resolved = Path(path)
    if not resolved.is_file():
        return None
    return sha256_file(resolved)


def _runtime_platform_string() -> str:
    import platform

    parts = (platform.system(), platform.release(), platform.machine())
    normalized = tuple(str(part).strip() for part in parts if str(part).strip())
    return "-".join(normalized) or "unknown"


def _probe_text(resolved: str) -> str:
    chunks: list[str] = []
    version_text = version_line(resolved) or ""
    if version_text:
        chunks.append(version_text)
    try:
        completed = subprocess.run(
            [resolved, "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        chunks.append((completed.stdout or "") + (completed.stderr or ""))
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        completed = subprocess.run(
            [resolved],
            input="\n",
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        chunks.append((completed.stdout or "") + (completed.stderr or ""))
    except (OSError, subprocess.TimeoutExpired):
        pass
    return "\n".join(chunk for chunk in chunks if chunk)


def tier2_calculation_spec() -> CalculationSpec:
    device = build_unconnected_device()
    return CalculationSpec(
        calculation_id=TIER2_CALCULATION_ID,
        campaign_id="dev2_tier2_cchain",
        structure_id=device.record.structure_id,
        engine="siesta",
        calculation_type="transiesta_zero_bias",
        applied_bias=ZERO_BIAS,
        physics={"soc": False},
        numerical={},
        resources={},
        origin=ParameterOrigin.PROJECT_METHOD,
        status=ParameterStatus.PROPOSED,
        artifact_role=ArtifactRole.TEST_FIXTURE,
    )


def new_tier2_run_id() -> str:
    return f"tier2.{uuid.uuid4().hex}"


def fixture_provenance_report(*, pseudo_path: Path | None = None) -> dict[str, str]:
    from spinvault.transport.cchain.pinning import (
        TUTORIAL_DOCS_GIT_COMMIT,
        TUTORIAL_PATH,
        TUTORIAL_REPO,
    )

    device = build_unconnected_device()
    report = {
        "artifact_role": ArtifactRole.TEST_FIXTURE.value,
        "geometry_fdf_source": (
            f"SIESTA documentation repository {TUTORIAL_REPO} "
            f"at commit {TUTORIAL_DOCS_GIT_COMMIT}, path {TUTORIAL_PATH}"
        ),
        "structure_id": device.record.structure_id,
        "scientific_role": (
            "software/integration validation only; does not validate production "
            "SpinVault transport physics"
        ),
    }
    if pseudo_path is not None and pseudo_path.is_file():
        report["c_psf_source"] = C_PSF_SOURCE
        report["c_psf_sha256"] = sha256_file(pseudo_path)
    return report


def _runtime_banner(resolved: str, parse_fn: Callable[[str], str | None]) -> str:
    text = _probe_text(resolved)
    parsed = parse_fn(text)
    if parsed:
        return parsed
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""


def _resolve_non_conda_exact_version(label: str, runtime_banner: str | None) -> str | None:
    if not runtime_banner:
        return None
    if label == "SIESTA":
        parsed = parse_siesta_version(runtime_banner)
        if parsed and parsed.startswith("Siesta "):
            token = parsed.removeprefix("Siesta ").strip()
            if token and token != "V5" and "." in token and "#" not in token:
                return token
    if label == "TBtrans":
        parsed = parse_tbtrans_version(runtime_banner)
        if parsed and parsed.startswith("TBtrans "):
            token = parsed.removeprefix("TBtrans ").strip()
            if token and "WELCOME" not in token.upper() and "." in token and "#" not in token:
                return token
    return None


def _build_executable_info(
    resolved: str,
    *,
    label: str,
    package_name: str,
    parse_banner: Callable[[str], str | None],
) -> ExecutableInfo:
    path = Path(resolved)
    digest = _executable_sha256(resolved)
    runtime_banner = _runtime_banner(resolved, parse_banner)

    try:
        package = load_conda_package_provenance(path, package_name=package_name)
    except CondaProvenanceError as exc:
        exact = _resolve_non_conda_exact_version(label, runtime_banner)
        if exact:
            env = SoftwareEnvironmentRecord(
                software_environment_id=f"{label.lower()}-{exact}-{digest[:16] if digest else 'unknown'}",
                software_name=label,
                version=exact,
                platform=_runtime_platform_string(),
                dependencies=(
                    f"executable_path={path.resolve()}",
                    *((
                        f"executable_sha256={digest}",
                    ) if digest else ()),
                    f"runtime_banner={runtime_banner}",
                    "package_provenance=non_conda_runtime_banner",
                ),
            )
            return ExecutableInfo(
                path=resolved,
                version=exact,
                sha256=digest,
                runtime_banner=runtime_banner,
                package_provenance=None,
                software_environment=env,
            )
        raise Tier2SmokeError(exc.category, str(exc)) from exc

    dependencies = package_provenance_dependencies(
        label=label,
        executable_path=path,
        executable_sha256=digest or "",
        package=package,
        runtime_banner=runtime_banner,
    )
    env = SoftwareEnvironmentRecord(
        software_environment_id=(
            f"{package.package_name}-{package.package_version}-{package.package_build}-"
            f"{label.lower()}-{digest[:16] if digest else 'unknown'}"
        ),
        software_name=label,
        version=package.package_version,
        platform=_runtime_platform_string(),
        dependencies=dependencies,
    )
    return ExecutableInfo(
        path=resolved,
        version=package.package_version,
        sha256=digest,
        runtime_banner=runtime_banner,
        package_provenance=package,
        software_environment=env,
    )


def probe_siesta_executable(path: str | None = None) -> ExecutableInfo:
    resolved = path or shutil.which("siesta")
    if not resolved:
        raise Tier2SmokeError("siesta executable not found on PATH")
    if not Path(resolved).is_file():
        raise Tier2SmokeError(f"siesta executable not found: {resolved}")
    return _build_executable_info(
        resolved,
        label="SIESTA",
        package_name="siesta",
        parse_banner=parse_siesta_version,
    )


def probe_tbtrans_executable(path: str | None = None) -> ExecutableInfo:
    resolved = path or shutil.which("tbtrans")
    if not resolved:
        raise Tier2SmokeError("tbtrans executable not found on PATH")
    if not Path(resolved).is_file():
        raise Tier2SmokeError(f"tbtrans executable not found: {resolved}")
    return _build_executable_info(
        resolved,
        label="TBtrans",
        package_name="siesta",
        parse_banner=parse_tbtrans_version,
    )


def _siesta_process_succeeded(stdout: str, stderr: str, returncode: int) -> bool:
    combined = f"{stdout}\n{stderr}"
    return returncode == 0 and "Job completed" in combined


def _find_transmission_artifact(root: Path) -> Path | None:
    avtrans = sorted(root.rglob("*TBT.AVTRANS*"))
    if avtrans:
        return avtrans[0]
    netcdf = sorted(root.rglob("*.TBT.nc"))
    if netcdf:
        return netcdf[0]
    return None


def _tests_negf_transport():
    import sys

    tests_root = Path(__file__).resolve().parents[3] / "tests"
    if str(tests_root) not in sys.path:
        sys.path.insert(0, str(tests_root))
    return tests_root


def build_cchain_fixture(workdir: Path | None = None):
    """Write the C-chain fixture inputs via the migrated negf_transport pipeline."""
    _tests_negf_transport()
    from negf_transport.pipeline import run_cchain_fixture

    target = workdir or Path("tier2_cchain_fixture")
    return run_cchain_fixture(target)


def _run_stage(
    name: str,
    command: tuple[str, ...],
    cwd: Path,
    *,
    success_check: Callable[[str, str, int], bool],
    timeout: float = 3600.0,
) -> StageResult:
    start = time.monotonic()
    if len(command) == 3 and command[1] == "<":
        input_fdf = cwd / command[2]
        with input_fdf.open("r", encoding="utf-8") as handle:
            completed = subprocess.run(
                [command[0]],
                cwd=cwd,
                stdin=handle,
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
    else:
        completed = subprocess.run(
            list(command),
            cwd=cwd,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    duration = time.monotonic() - start
    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    return StageResult(
        name=name,
        command=command,
        cwd=cwd,
        returncode=completed.returncode,
        stdout=stdout,
        stderr=stderr,
        succeeded=success_check(stdout, stderr, completed.returncode),
        duration_s=duration,
    )


def execute_cchain_smoke(
    workdir: Path,
    *,
    siesta_path: str | None = None,
    tbtrans_path: str | None = None,
    parser_preference: str = "auto",
    timeout: float = 3600.0,
    pseudo_dir: str | Path | None = None,
) -> CChainSmokeExecution:
    import os

    workdir = workdir.resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    calculation_id = tier2_calculation_spec().calculation_id
    run_id = new_tier2_run_id()
    siesta = probe_siesta_executable(siesta_path)
    tbtrans = probe_tbtrans_executable(tbtrans_path)
    require_executable(siesta.path, "siesta")
    require_executable(tbtrans.path, "tbtrans")

    write_cchain_job(workdir)
    dirs = CChainWorkdirs.from_root(workdir)
    pseudo_root = Path(pseudo_dir or os.environ.get("SPINVAULT_CCHAIN_PSEUDO_DIR", "")).expanduser()
    pseudo_file = pseudo_root / "C.psf"
    pseudo_path = pseudo_file if pseudo_file.is_file() else None
    if pseudo_path is not None:
        for target_dir in (dirs.electrode, dirs.device):
            target_dir.mkdir(parents=True, exist_ok=True)
            target_dir.joinpath("C.psf").write_bytes(pseudo_file.read_bytes())
    stages: list[StageResult] = []

    stages.append(
        _run_stage(
            "electrode_siesta",
            (siesta.path, "<", "RUN.fdf"),
            dirs.electrode,
            success_check=_siesta_process_succeeded,
            timeout=timeout,
        )
    )
    stages.append(
        _run_stage(
            "device_siesta",
            (siesta.path, "<", "RUN.fdf"),
            dirs.device,
            success_check=_siesta_process_succeeded,
            timeout=timeout,
        )
    )
    stages.append(
        _run_stage(
            "tbtrans",
            (tbtrans.path, "<", "RUN.fdf"),
            dirs.device,
            success_check=lambda stdout, stderr, code: code == 0,
            timeout=timeout,
        )
    )

    if not all(stage.succeeded for stage in stages):
        return CChainSmokeExecution(
            workdir=workdir,
            calculation_id=calculation_id,
            run_id=run_id,
            siesta=siesta,
            tbtrans=tbtrans,
            stages=tuple(stages),
            transmission_path=None,
            parsed=None,
            transport=None,
            status="failed",
            pseudo_path=pseudo_path,
        )

    transmission_path = _find_transmission_artifact(workdir)
    if transmission_path is None:
        return CChainSmokeExecution(
            workdir=workdir,
            calculation_id=calculation_id,
            run_id=run_id,
            siesta=siesta,
            tbtrans=tbtrans,
            stages=tuple(stages),
            transmission_path=None,
            parsed=None,
            transport=None,
            status="missing_transmission",
            pseudo_path=pseudo_path,
        )

    parser = select_parser(parser_preference, transmission_path)
    parsed = parser.parse_file(transmission_path)
    device = build_unconnected_device()
    transport = build_transport_result(
        parsed,
        device.metadata,
        run_id=run_id,
        siesta_version=siesta.version,
        tbtrans_version=tbtrans.version,
    )
    return CChainSmokeExecution(
        workdir=workdir,
        calculation_id=calculation_id,
        run_id=run_id,
        siesta=siesta,
        tbtrans=tbtrans,
        stages=tuple(stages),
        transmission_path=transmission_path,
        parsed=parsed,
        transport=transport,
        status="parsed_fixture",
        pseudo_path=pseudo_path,
    )


def smoke_report(execution: CChainSmokeExecution) -> dict:
    overall = "PASS" if execution.status == "parsed_fixture" else "FAIL"
    report = {
        "baseline_git_commit": TIER2_BASELINE,
        "calculation_id": execution.calculation_id,
        "run_id": execution.run_id,
        "fixture_provenance": fixture_provenance_report(pseudo_path=execution.pseudo_path),
        "siesta_version": execution.siesta.version,
        "tbtrans_version": execution.tbtrans.version,
        "siesta_runtime_banner": execution.siesta.runtime_banner,
        "tbtrans_runtime_banner": execution.tbtrans.runtime_banner,
        "siesta_sha256": execution.siesta.sha256,
        "tbtrans_sha256": execution.tbtrans.sha256,
        "stages": [
            {
                "name": stage.name,
                "command": stage.command,
                "returncode": stage.returncode,
                "succeeded": stage.succeeded,
                "duration_s": stage.duration_s,
            }
            for stage in execution.stages
        ],
        "transmission_path": str(execution.transmission_path) if execution.transmission_path else None,
        "status": execution.status,
        "overall": overall,
    }
    if execution.siesta.package_provenance is not None:
        report.update(
            package_provenance_report_fields(
                role="siesta",
                package=execution.siesta.package_provenance,
                executable_path=Path(execution.siesta.path),
                executable_sha256=execution.siesta.sha256 or "",
                runtime_banner=execution.siesta.runtime_banner or "",
            )
        )
    if execution.tbtrans.package_provenance is not None:
        report.update(
            package_provenance_report_fields(
                role="tbtrans",
                package=execution.tbtrans.package_provenance,
                executable_path=Path(execution.tbtrans.path),
                executable_sha256=execution.tbtrans.sha256 or "",
                runtime_banner=execution.tbtrans.runtime_banner or "",
            )
        )
    if execution.siesta.software_environment is not None:
        report["siesta_software_environment"] = {
            "software_environment_id": execution.siesta.software_environment.software_environment_id,
            "software_name": execution.siesta.software_environment.software_name,
            "version": execution.siesta.software_environment.version,
            "platform": execution.siesta.software_environment.platform,
            "dependencies": list(execution.siesta.software_environment.dependencies),
        }
    if execution.tbtrans.software_environment is not None:
        report["tbtrans_software_environment"] = {
            "software_environment_id": execution.tbtrans.software_environment.software_environment_id,
            "software_name": execution.tbtrans.software_environment.software_name,
            "version": execution.tbtrans.software_environment.version,
            "platform": execution.tbtrans.software_environment.platform,
            "dependencies": list(execution.tbtrans.software_environment.dependencies),
        }
    return report


def write_smoke_report(execution: CChainSmokeExecution, path: Path | None = None) -> Path:
    import json

    target = path or (execution.workdir / "tier2-report.json")
    target.write_text(json.dumps(smoke_report(execution), sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return target


def tier2_environment_configured() -> bool:
    import os

    siesta = os.environ.get("SPINVAULT_SIESTA") or shutil.which("siesta")
    tbtrans = os.environ.get("SPINVAULT_TBTRANS") or shutil.which("tbtrans")
    return bool(siesta and tbtrans)
