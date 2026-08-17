"""Static file server for apps/website.

Sends no-store headers so an edited simulator asset is picked up on reload
instead of being served from the browser disk cache.
"""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WEBSITE_ROOT = REPO_ROOT / "apps" / "website"


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_request(self, code: object = "-", size: object = "-") -> None:
        # Keep the combined local log readable: only failures are worth printing.
        if not str(code).startswith(("2", "3")):
            super().log_request(code, size)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4191)
    parser.add_argument("--root", type=Path, default=WEBSITE_ROOT)
    args = parser.parse_args()

    root = args.root.resolve()
    if not (root / "simulator.html").is_file():
        raise SystemExit(f"simulator.html not found under {root}")

    handler = partial(NoCacheHandler, directory=str(root))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    server.daemon_threads = True
    print(f"website: serving {root} at http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
