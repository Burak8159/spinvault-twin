#!/usr/bin/env python3
"""Reject evidence roots that overlap files served as public website assets."""
from __future__ import annotations

import argparse
from pathlib import Path


def overlaps_public_tree(evidence_root: Path, public_roots: list[Path]) -> bool:
    root = evidence_root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Evidence root must be a directory")
    for public in public_roots:
        public = public.resolve(strict=False)
        if root == public or root.is_relative_to(public) or public.is_relative_to(root):
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence_root", type=Path)
    parser.add_argument("public_roots", nargs="+", type=Path)
    args = parser.parse_args()
    try:
        unsafe = overlaps_public_tree(args.evidence_root, args.public_roots)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    if unsafe:
        print("Evidence root overlaps a directory served as public application content.")
        return 1
    print("Evidence root is outside configured public application directories.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
