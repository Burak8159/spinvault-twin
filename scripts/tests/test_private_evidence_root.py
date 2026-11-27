from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


SCRIPT = Path(__file__).parents[1] / "check_private_evidence_root.py"
SPEC = importlib.util.spec_from_file_location("check_private_evidence_root", SCRIPT)
assert SPEC and SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


def test_private_sibling_directory_is_accepted(tmp_path: Path) -> None:
    public = tmp_path / "website"
    public.mkdir()
    evidence = tmp_path / "private-evidence"
    evidence.mkdir()

    assert not checker.overlaps_public_tree(evidence, [public])


@pytest.mark.parametrize("relative", ["website", "website/private", "."])
def test_evidence_directory_overlapping_public_tree_is_rejected(
    tmp_path: Path, relative: str
) -> None:
    public = tmp_path / "website"
    public.mkdir()
    if relative == ".":
        evidence = tmp_path
    else:
        evidence = tmp_path / relative
        evidence.mkdir(parents=True, exist_ok=True)

    assert checker.overlaps_public_tree(evidence, [public])


def test_symlink_into_public_tree_is_rejected(tmp_path: Path) -> None:
    public = tmp_path / "website"
    public.mkdir()
    evidence_link = tmp_path / "evidence-link"
    try:
        evidence_link.symlink_to(public, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("platform does not allow creating directory symlinks")

    assert checker.overlaps_public_tree(evidence_link, [public])


def test_missing_evidence_root_is_not_silently_accepted(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        checker.overlaps_public_tree(tmp_path / "missing", [tmp_path / "website"])
