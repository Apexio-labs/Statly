"""Start a development Anki with Statly linked in from this repository."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / ".dev" / "anki"
DEMO_COLLECTION = ROOT / ".dev" / "bench" / "collection.anki2"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="start with one million fake reviews")
    options = parser.parse_args()

    if not (ROOT / "addon/src/statly/web/index.html").exists():
        raise SystemExit("Run `pnpm build` first.")
    collection = BASE / "User 1" / "collection.anki2"
    if options.demo and not collection.exists():
        if not DEMO_COLLECTION.exists():
            subprocess.run([sys.executable, str(ROOT / "scripts/bench_statistics.py")], check=False)
        collection.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(DEMO_COLLECTION, collection)
    addons = BASE / "addons21"
    addons.mkdir(parents=True, exist_ok=True)
    link = addons / "statly"
    if not link.exists():
        link.symlink_to(ROOT / "addon/src/statly", target_is_directory=True)
    env = {**os.environ, "ANKIDEV": "1"}
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/run_anki.py"), str(BASE)], env=env, check=False
    )


if __name__ == "__main__":
    main()
