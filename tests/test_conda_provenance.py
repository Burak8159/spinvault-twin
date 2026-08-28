"""Tests for conda package provenance resolution."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from spinvault.transport.conda_provenance import (
    CondaProvenanceError,
    load_conda_package_provenance,
    package_provenance_dependencies,
)
from spinvault.transport.tier2 import (
    Tier2SmokeError,
    probe_siesta_executable,
    probe_tbtrans_executable,
)


def _write_fake_conda_env(root: Path, *, package_version: str, build: str) -> tuple[Path, Path]:
    prefix = root / "env"
    bin_dir = prefix / "bin"
    meta_dir = prefix / "conda-meta"
    bin_dir.mkdir(parents=True)
    meta_dir.mkdir(parents=True)
    siesta = bin_dir / "siesta"
    tbtrans = bin_dir / "tbtrans"
    siesta.write_text("#!/bin/sh\necho 'Version : #SIESTA_VERSION#'\n", encoding="utf-8")
    tbtrans.write_text("#!/bin/sh\necho 'WELCOME TO TBtrans'\n", encoding="utf-8")
    siesta.chmod(0o755)
    tbtrans.chmod(0o755)
    meta = {
        "name": "siesta",
        "version": package_version,
        "build": build,
        "build_string": build,
        "channel": "conda-forge",
        "files": ["bin/siesta", "bin/tbtrans"],
    }
    meta_path = meta_dir / f"siesta-{package_version}-{build}.json"
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    return siesta, tbtrans


def test_load_conda_package_metadata_captures_exact_fields(tmp_path: Path):
    siesta, _ = _write_fake_conda_env(
        tmp_path,
        package_version="5.4.2",
        build="nompi_h7e5ea38_1003",
    )
    package = load_conda_package_provenance(siesta)
    assert package.package_name == "siesta"
    assert package.package_version == "5.4.2"
    assert package.package_build == "nompi_h7e5ea38_1003"
    assert package.package_channel == "conda-forge"


def test_siesta_probe_resolves_exact_package_version(tmp_path: Path):
    siesta, _ = _write_fake_conda_env(tmp_path, package_version="5.4.2", build="nompi_h7e5ea38_1003")
    info = probe_siesta_executable(str(siesta))
    assert info.version == "5.4.2"
    assert info.software_environment is not None
    assert info.software_environment.version == "5.4.2"
    assert info.runtime_banner is not None
    assert "5.4.2" not in (info.runtime_banner or "")


def test_tbtrans_probe_uses_same_siesta_package(tmp_path: Path):
    _, tbtrans = _write_fake_conda_env(tmp_path, package_version="5.4.2", build="nompi_h7e5ea38_1003")
    info = probe_tbtrans_executable(str(tbtrans))
    assert info.version == "5.4.2"
    assert info.package_provenance is not None
    assert info.package_provenance.package_name == "siesta"
    assert info.software_environment is not None
    assert info.software_environment.version == "5.4.2"


def test_dependencies_persist_build_channel_and_hash(tmp_path: Path):
    siesta, tbtrans = _write_fake_conda_env(tmp_path, package_version="5.4.2", build="nompi_h7e5ea38_1003")
    siesta_info = probe_siesta_executable(str(siesta))
    tbtrans_info = probe_tbtrans_executable(str(tbtrans))
    siesta_deps = dict(item.split("=", 1) for item in siesta_info.software_environment.dependencies)
    tbtrans_deps = dict(item.split("=", 1) for item in tbtrans_info.software_environment.dependencies)
    assert siesta_deps["package_build"] == "nompi_h7e5ea38_1003"
    assert siesta_deps["package_channel"] == "conda-forge"
    assert siesta_deps["executable_sha256"] == hashlib.sha256(siesta.read_bytes()).hexdigest()
    assert tbtrans_deps["package_version"] == "5.4.2"
    assert tbtrans_deps["executable_sha256"] == hashlib.sha256(tbtrans.read_bytes()).hexdigest()
    assert tbtrans_deps["supplied_by_package"] == "siesta"


def test_major_version_banner_without_conda_is_ambiguous(tmp_path: Path):
    script = tmp_path / "siesta"
    script.write_text("#!/bin/sh\necho 'Siesta V5'\n", encoding="utf-8")
    script.chmod(0o755)
    with pytest.raises(Tier2SmokeError) as exc:
        probe_siesta_executable(str(script))
    assert exc.value.args[0] == "PACKAGE_PROVENANCE_AMBIGUOUS"


def test_non_conda_precise_banner_remains_supported(tmp_path: Path):
    script = tmp_path / "siesta"
    script.write_text("#!/bin/sh\necho 'Siesta Version 4.1.5'\n", encoding="utf-8")
    script.chmod(0o755)
    info = probe_siesta_executable(str(script))
    assert info.version == "4.1.5"
    assert info.package_provenance is None


def test_package_provenance_dependencies_are_deterministic(tmp_path: Path):
    siesta, _ = _write_fake_conda_env(tmp_path, package_version="5.4.2", build="nompi_h7e5ea38_1003")
    package = load_conda_package_provenance(siesta)
    digest = hashlib.sha256(siesta.read_bytes()).hexdigest()
    first = package_provenance_dependencies(
        label="SIESTA",
        executable_path=siesta,
        executable_sha256=digest,
        package=package,
        runtime_banner="Siesta V5",
    )
    second = package_provenance_dependencies(
        label="SIESTA",
        executable_path=siesta,
        executable_sha256=digest,
        package=package,
        runtime_banner="Siesta V5",
    )
    assert first == second

