"""Static file server for apps/website.

Sends no-store headers so an edited simulator asset is picked up on reload
instead of being served from the browser disk cache.

When --api-proxy is set, /api and /health are forwarded to the Twin API so a
public HTTPS hostname can stay same-origin.
"""

from __future__ import annotations

import argparse
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[1]
WEBSITE_ROOT = REPO_ROOT / "apps" / "website"
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
    }
    api_origin = ""

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_request(self, code: object = "-", size: object = "-") -> None:
        # Keep the combined local log readable: only failures are worth printing.
        if not str(code).startswith(("2", "3")):
            super().log_request(code, size)

    def _proxied_path(self) -> bool:
        if not self.api_origin:
            return False
        path = self.path.split("?", 1)[0]
        return path == "/api" or path.startswith("/api/") or path == "/health"

    def do_GET(self) -> None:  # noqa: N802
        if self._proxied_path():
            self._proxy()
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if self._proxied_path():
            self._proxy()
            return
        super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802
        if self._proxied_path():
            self._proxy()
            return
        self.send_error(404, "POST is only accepted for /api")

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self._proxied_path():
            self._proxy()
            return
        self.send_response(204)
        self.end_headers()

    def _proxy(self) -> None:
        parsed = urlparse(self.api_origin)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length > 0 else None
        request = urllib.request.Request(
            self.api_origin.rstrip("/") + self.path,
            data=body,
            method=self.command,
        )
        for header in ("Accept", "Content-Type", "Authorization"):
            value = self.headers.get(header)
            if value:
                request.add_header(header, value)
        request.add_header("Host", parsed.netloc)
        forwarded = self.headers.get("X-Forwarded-For") or self.client_address[0]
        request.add_header("X-Forwarded-For", forwarded)
        try:
            with urllib.request.urlopen(request, timeout=600) as upstream:
                self.send_response(upstream.status)
                for key, value in upstream.headers.items():
                    if key.lower() in HOP_BY_HOP:
                        continue
                    self.send_header(key, value)
                self.end_headers()
                if self.command == "HEAD":
                    return
                while True:
                    chunk = upstream.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except urllib.error.HTTPError as exc:
            self.send_response(exc.code)
            for key, value in exc.headers.items():
                if key.lower() in HOP_BY_HOP:
                    continue
                self.send_header(key, value)
            self.end_headers()
            if self.command != "HEAD":
                payload = exc.read()
                if payload:
                    self.wfile.write(payload)
        except Exception as exc:
            self.send_error(502, f"API proxy failed: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4191)
    parser.add_argument("--root", type=Path, default=WEBSITE_ROOT)
    parser.add_argument(
        "--api-proxy",
        default="",
        help="Forward /api and /health to this Twin API origin, for example http://127.0.0.1:8001",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    if not (root / "simulator.html").is_file():
        raise SystemExit(f"simulator.html not found under {root}")

    api_origin = str(args.api_proxy or "").strip().rstrip("/")
    handler = partial(NoCacheHandler, directory=str(root))
    NoCacheHandler.api_origin = api_origin
    server = ThreadingHTTPServer((args.host, args.port), handler)
    server.daemon_threads = True
    extra = f" (API proxy {api_origin})" if api_origin else ""
    print(f"website: serving {root} at http://{args.host}:{args.port}{extra}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
