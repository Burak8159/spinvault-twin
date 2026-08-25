"""Pin the C-chain fixture to exact docs/code hashes, not only a living URL."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
from typing import Mapping, Optional

TUTORIAL_TITLE = "Simple C-chain"
TUTORIAL_URL = (
    "https://docs.siesta-project.org/projects/siesta/en/latest/"
    "tutorials/advanced/transiesta/C_chain/index.html"
)
TUTORIAL_REPO = "https://gitlab.com/siesta-project/documentation/siesta-docs"
TUTORIAL_PATH = "docs/tutorials/advanced/transiesta/C_chain"
# HEAD of siesta-docs observed while pinning this fixture (2026-08-23).
# Replace with the container-pinned SIESTA/docs tag when DEVELOPER_1_VERY_GOOD_PLATFORM_AWS_INTEGRATION
# freezes the solver image.
TUTORIAL_DOCS_GIT_COMMIT = "ca6da4c46538bccce34776cdbb075fa4bfc2c6dc"
SIESTA_VERSION_PIN = None  # UNSET until the platform container pin exists
TBTRANS_VERSION_PIN = None


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


@dataclass(frozen=True)
class FixturePin:
    tutorial_title: str
    tutorial_url: str
    tutorial_repo: str
    tutorial_path: str
    docs_git_commit: str
    siesta_version: Optional[str]
    tbtrans_version: Optional[str]
    generator_git_commit: Optional[str]
    electrode_geometry_hash: str
    device_geometry_hash: str
    fdf_sha256: Mapping[str, str]
    diagnostic_transmission_sha256: Optional[str]


def generator_git_commit(repo_root: Path | None = None) -> str | None:
    root = repo_root or Path(__file__).resolve().parents[3]
    git_head = root / ".git" / "HEAD"
    if not git_head.is_file():
        return None
    text = git_head.read_text(encoding="utf-8").strip()
    if text.startswith("ref:"):
        ref = text.split(" ", 1)[1].strip()
        ref_path = root / ".git" / ref
        if ref_path.is_file():
            return ref_path.read_text(encoding="utf-8").strip()
        packed = root / ".git" / "packed-refs"
        if packed.is_file():
            for line in packed.read_text(encoding="utf-8").splitlines():
                if line.endswith(ref) and not line.startswith("#"):
                    return line.split()[0]
        return None
    return text


def pin_from_job(
    fdf_files: Mapping[str, Path],
    diagnostic_transmission: Path | None = None,
    repo_root: Path | None = None,
) -> FixturePin:
    from .geometry import build_electrode, build_unconnected_device
    electrode = build_electrode()
    device = build_unconnected_device()
    return FixturePin(
        tutorial_title=TUTORIAL_TITLE,
        tutorial_url=TUTORIAL_URL,
        tutorial_repo=TUTORIAL_REPO,
        tutorial_path=TUTORIAL_PATH,
        docs_git_commit=TUTORIAL_DOCS_GIT_COMMIT,
        siesta_version=SIESTA_VERSION_PIN,
        tbtrans_version=TBTRANS_VERSION_PIN,
        generator_git_commit=generator_git_commit(repo_root),
        electrode_geometry_hash=electrode.record.structure_hash,
        device_geometry_hash=device.record.structure_hash,
        fdf_sha256={name: sha256_file(path) for name, path in fdf_files.items()},
        diagnostic_transmission_sha256=(
            sha256_file(diagnostic_transmission) if diagnostic_transmission else None
        ),
    )
