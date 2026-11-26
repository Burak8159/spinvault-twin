#!/usr/bin/env python3
"""Print a read-only reconciliation report for local solver job artifacts."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.workers.artifact_reconciliation import audit_job_artifacts


def main() -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=settings.job_database)
    parser.add_argument("--artifact-root", type=Path, default=settings.job_root)
    parser.add_argument("--output", type=Path, help="Optional report file; existing files are refused")
    args = parser.parse_args()

    try:
        report = audit_job_artifacts(args.database, args.artifact_root)
        rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("x", encoding="utf-8") as stream:
                stream.write(rendered)
        else:
            sys.stdout.write(rendered)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    return 1 if report["issues"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
