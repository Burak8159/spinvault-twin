#!/usr/bin/env python3
"""Create or restore a hash-verified local job/queue database backup."""

import argparse
import json
from pathlib import Path

from app.storage.runtime_backup import backup_runtime_database, restore_runtime_database


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    create = commands.add_parser("backup")
    create.add_argument("database", type=Path)
    create.add_argument("destination", type=Path, help="new backup directory; must not exist")
    restore = commands.add_parser("restore")
    restore.add_argument("backup", type=Path)
    restore.add_argument("destination", type=Path, help="new database file; must not exist")
    args = parser.parse_args()
    if args.action == "backup":
        result = backup_runtime_database(args.database, args.destination)
    else:
        result = restore_runtime_database(args.backup, args.destination)
    print(json.dumps({"result": "PASS", **result}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
