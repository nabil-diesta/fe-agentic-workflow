#!/usr/bin/env python3
"""
Example tool for the WAT framework.
Run deterministic tasks here; the agent orchestrates via workflows.
"""
from pathlib import Path
import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Example WAT tool")
    parser.add_argument("--message", "-m", default="Hello from WAT", help="Message to echo")
    parser.add_argument("--out", "-o", help="Optional: write message to this path (e.g. .tmp/out.txt)")
    args = parser.parse_args()

    print(args.message)

    if args.out:
        path = Path(args.out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args.message + "\n", encoding="utf-8")
        print(f"Wrote: {path}")


if __name__ == "__main__":
    main()
