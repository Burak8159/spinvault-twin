"""Security and integrity checks for the local artifact catalogue API."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings


@pytest.fixture
def artifact_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "research"
    root.mkdir()
    monkeypatch.setenv("SPINVAULT_ARTIFACT_ROOT", str(root))
    monkeypatch.setenv("SPINVAULT_ARTIFACT_MANIFEST", "artifact-manifest.json")
    get_settings.cache_clear()
    yield root
    get_settings.cache_clear()


def write_manifest(root: Path, records: list[dict]) -> None:
    (root / "artifact-manifest.json").write_text(
        json.dumps({"schema_version": "1.0", "artifacts": records}), encoding="utf-8"
    )


def record(identifier: str, path: str, content: bytes, **overrides: object) -> dict:
    value = {
        "id": identifier,
        "relative_path": path,
        "sha256": hashlib.sha256(content).hexdigest(),
        "size_bytes": len(content),
        "availability": "present",
        "access": "reviewed_public",
        "source_revision": "git:abc123",
    }
    value.update(overrides)
    return value


def test_missing_configuration_is_unavailable(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SPINVAULT_ARTIFACT_ROOT", raising=False)
    get_settings.cache_clear()
    assert client.get("/api/artifacts").status_code == 503


def test_lists_metadata_and_streams_hash_verified_content(
    client: TestClient, artifact_root: Path
) -> None:
    content = b"verified research artifact\n"
    (artifact_root / "reports").mkdir()
    (artifact_root / "reports" / "summary.txt").write_bytes(content)
    write_manifest(artifact_root, [record("summary-1", "reports/summary.txt", content)])

    listed = client.get("/api/artifacts")
    assert listed.status_code == 200
    item = listed.json()["artifacts"][0]
    assert item["id"] == "summary-1"
    assert item["downloadable"] is True
    assert "relative_path" not in item

    response = client.get("/api/artifacts/summary-1/content")
    assert response.status_code == 200
    assert response.content == content
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_private_artifact_is_not_disclosed_by_the_browser_api(
    client: TestClient, artifact_root: Path
) -> None:
    content = b"private"
    (artifact_root / "private.txt").write_bytes(content)
    write_manifest(artifact_root, [record("private-1", "private.txt", content, access="private")])
    assert client.get("/api/artifacts").json()["artifacts"] == []
    assert client.get("/api/artifacts/private-1").status_code == 404
    assert client.get("/api/artifacts/private-1/content").status_code == 404


def test_missing_entry_and_unlisted_file_are_not_served(client: TestClient, artifact_root: Path) -> None:
    content = b"still catalogued as missing"
    (artifact_root / "not-really-there.txt").write_bytes(content)
    write_manifest(artifact_root, [record(
        "missing-1", "not-really-there.txt", content, availability="missing"
    )])
    assert client.get("/api/artifacts/unlisted/content").status_code == 404
    assert client.get("/api/artifacts/missing-1/content").status_code == 404


@pytest.mark.parametrize("unsafe", ["../secret.txt", "/etc/passwd", "folder\\secret.txt", "a/../b"])
def test_manifest_rejects_unsafe_paths(
    client: TestClient, artifact_root: Path, unsafe: str
) -> None:
    write_manifest(artifact_root, [record("unsafe-1", unsafe, b"")])
    assert client.get("/api/artifacts").status_code == 503


def test_manifest_rejects_duplicate_ids(client: TestClient, artifact_root: Path) -> None:
    entry = record("same", "file.txt", b"")
    write_manifest(artifact_root, [entry, entry])
    assert client.get("/api/artifacts").status_code == 503


def test_symlink_cannot_escape_artifact_root(client: TestClient, artifact_root: Path, tmp_path: Path) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    (artifact_root / "escape.txt").symlink_to(outside)
    write_manifest(artifact_root, [record(
        "escape", "escape.txt", b"secret"
    )])
    assert client.get("/api/artifacts/escape/content").status_code == 404


def test_size_and_hash_mismatches_are_rejected(client: TestClient, artifact_root: Path) -> None:
    target = artifact_root / "payload.bin"
    target.write_bytes(b"changed")
    write_manifest(artifact_root, [record("changed", "payload.bin", b"expected")])
    assert client.get("/api/artifacts/changed/content").status_code == 409


def test_configured_download_size_limit(client: TestClient, artifact_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    content = b"123456"
    (artifact_root / "large.bin").write_bytes(content)
    write_manifest(artifact_root, [record("large", "large.bin", content)])
    monkeypatch.setenv("SPINVAULT_ARTIFACT_MAX_FILE_BYTES", "5")
    get_settings.cache_clear()
    assert client.get("/api/artifacts/large/content").status_code == 413
