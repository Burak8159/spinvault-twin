from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import zipfile
from unittest.mock import patch

import pytest


SCRIPT = Path(__file__).parents[1] / "build_local_package.py"
SPEC = importlib.util.spec_from_file_location("build_local_package", SCRIPT)
assert SPEC and SPEC.loader
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


def _controlled_repo(tmp_path: Path):
    (tmp_path / "README.md").write_text("fixture", encoding="utf-8")
    return (
        patch.object(builder, "ROOT", tmp_path),
        patch.object(builder, "_tracked_files", return_value=[("README.md", 0o100644)]),
        patch.object(
            builder.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, stdout="fixture-commit\n", stderr=""),
        ),
    )


def test_build_publishes_checksum_verified_package_without_replacing(tmp_path: Path) -> None:
    root_patch, files_patch, git_patch = _controlled_repo(tmp_path)
    output = tmp_path / "delivery.zip"
    with root_patch, files_patch, git_patch:
        result = builder.build(output)
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        assert result["sha256"] == digest
        assert Path(str(output) + ".sha256").read_text() == f"{digest}  delivery.zip\n"
        with zipfile.ZipFile(output) as archive:
            assert archive.testzip() is None
            manifest = json.loads(archive.read("spinvault-twin/PACKAGE_PROVENANCE.json"))
            assert manifest["source_commit"] == "fixture-commit"
            assert manifest["files"][0]["sha256"] == hashlib.sha256(b"fixture").hexdigest()

        package_before = output.read_bytes()
        sidecar_before = Path(str(output) + ".sha256").read_bytes()
        with pytest.raises(ValueError, match="refusing to overwrite"):
            builder.build(output)
        assert output.read_bytes() == package_before
        assert Path(str(output) + ".sha256").read_bytes() == sidecar_before


def test_build_refuses_existing_checksum_before_creating_archive(tmp_path: Path) -> None:
    root_patch, files_patch, git_patch = _controlled_repo(tmp_path)
    output = tmp_path / "delivery.zip"
    Path(str(output) + ".sha256").write_text("keep", encoding="ascii")
    with root_patch, files_patch, git_patch:
        with pytest.raises(ValueError, match="refusing to overwrite"):
            builder.build(output)
    assert not output.exists()
    assert Path(str(output) + ".sha256").read_text() == "keep"
