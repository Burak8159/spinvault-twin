"""CLI entry point for Tier-2 C-chain smoke."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from spinvault.transport.tier2 import (
    Tier2SmokeError,
    build_cchain_fixture,
    execute_cchain_smoke,
    smoke_report,
    tier2_environment_configured,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="SpinVault Tier-2 C-chain smoke")
    sub = parser.add_subparsers(dest="command", required=True)

    fixture = sub.add_parser("fixture", help="write C-chain fixture inputs")
    fixture.add_argument("--workdir", type=Path, default=Path("tier2_cchain_fixture"))

    smoke = sub.add_parser("smoke", help="run electrode/device/tbtrans smoke")
    smoke.add_argument("--workdir", type=Path, required=True)
    smoke.add_argument("--siesta", default=None)
    smoke.add_argument("--tbtrans", default=None)
    smoke.add_argument("--parser", default="auto")

    args = parser.parse_args(argv)
    if args.command == "fixture":
        result = build_cchain_fixture(args.workdir)
        print(json.dumps({"status": result.status, "workdir": str(args.workdir)}, indent=2))
        return 0

    if not tier2_environment_configured() and args.siesta is None and args.tbtrans is None:
        raise Tier2SmokeError("siesta/tbtrans not configured; pass --siesta and --tbtrans")

    execution = execute_cchain_smoke(
        args.workdir,
        siesta_path=args.siesta,
        tbtrans_path=args.tbtrans,
        parser_preference=args.parser,
    )
    print(json.dumps(smoke_report(execution), indent=2))
    return 0 if execution.status == "parsed_fixture" else 1


if __name__ == "__main__":
    sys.exit(main())
