#!/usr/bin/env python3
"""Run TradingAgents Studio Web UI locally.

Usage:
    python run_web.py
    python run_web.py --port 8080
    python run_web.py --open-browser
"""

import argparse
import sys
import webbrowser
from pathlib import Path

# Ensure repository root is on sys.path
repo_root = Path(__file__).resolve().parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from tradingagents.web.server import run_server


def main():
    parser = argparse.ArgumentParser(description="TradingAgents Studio Web Cockpit")
    parser.add_argument("--host", default="127.0.0.1", help="Host address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port number (default: 8000)")
    parser.add_argument("--open-browser", action="store_true", help="Automatically open web browser on start")
    args = parser.parse_args()

    if args.open_browser:
        url = f"http://{args.host}:{args.port}"
        # Delayed open
        import threading
        import time

        def _open():
            time.sleep(1.2)
            webbrowser.open(url)

        threading.Thread(target=_open, daemon=True).start()

    run_server(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
