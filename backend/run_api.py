"""Convenience launcher: python -m app or python run_api.py"""

from __future__ import annotations

import uvicorn


def main() -> None:
    uvicorn.run("app.main:app", host="127.0.0.1", port=8001, reload=True)


if __name__ == "__main__":
    main()
