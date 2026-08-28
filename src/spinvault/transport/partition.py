"""Stage/workdir partitioning for the C-chain smoke path."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CChainWorkdirs:
    root: Path
    electrode: Path
    device: Path

    @classmethod
    def from_root(cls, root: Path) -> CChainWorkdirs:
        return cls(
            root=root,
            electrode=root / "electrode",
            device=root / "unconnected" / "0V",
        )
