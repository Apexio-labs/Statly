"""Run Statly inside real Anki and check the parts a simulated bridge cannot prove."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / ".dev" / "smoke"
RESULT = BASE / "result.json"
TIMEOUT_SECONDS = 120


def prepare(collection: Path | None) -> None:
    shutil.rmtree(BASE, ignore_errors=True)
    if collection is not None:
        profile = BASE / "User 1"
        profile.mkdir(parents=True)
        shutil.copy(collection, profile / "collection.anki2")
    addons = BASE / "addons21"
    addons.mkdir(parents=True)
    (addons / "statly").symlink_to(ROOT / "addon/src/statly", target_is_directory=True)
    shutil.copytree(ROOT / "addon/tests/smoke/driver", addons / "statly_smoke_driver")


def check(result: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    expectations = {
        "window_survives_escape": True,
        "single_window": True,
        "closed_by_anki": True,
        "toolbar_link": True,
        "menu": True,
        "silenced": True,
        "survived_quit_while_recording": True,
        "action_fired_while_recording": False,
        "restored": True,
        "imported_widgets": 1,
        "phone_deck": True,
        "phone_card_cards": 1,
        "phone_backup": True,
        "phone_removed": True,
        "widget_saved": True,
        "widget_exported": True,
        "widget_media": True,
        "widget_imported": True,
        "widgets_listed": 2,
        "deck_heatmap": True,
        "deck_wallpaper": True,
        "deck_counters": True,
        "secret_store_persistent": True,
        "card_picture": True,
        "ai_answer": "Fertig.",
        "ai_tools": ["get_today", "propose_settings"],
        "ai_waiting": "pending",
        "ai_theme_applied": "dark",
        "ai_theme_restored": True,
        "key_lock_set": "unlocked",
        "key_lock_refused": "wrong_password",
        "key_lock_opened": "unlocked",
    }
    if "STATLY_SMOKE_KEYRING" in os.environ:
        expectations["secret_store_roundtrip"] = True
    for key, expected in expectations.items():
        if result.get(key) != expected:
            problems.append(f"{key}: expected {expected}, got {result.get(key)}")

    closed = result.get("while_closed")
    if not isinstance(closed, dict) or closed["error"]["code"] != "collection_unavailable":
        problems.append(f"Call with a closed collection answered: {closed}")
    reopened = result.get("after_reopen")
    if not (isinstance(reopened, dict) and reopened.get("ok") is True):
        problems.append(f"Call after reopening answered: {reopened}")
    if not result.get("conflict"):
        problems.append("A taken shortcut was not reported as a conflict.")
    if result.get("unexpected_imports"):
        problems.append(f"Anki tried to import: {result['unexpected_imports']}")
    bridge = result.get("mcp")
    if not (
        isinstance(bridge, dict) and bridge["tools"] > 5 and bridge["called"] and bridge["refused"]
    ):
        problems.append(f"The MCP bridge answered: {bridge}")
    statistics = result.get("statistics")
    if not statistics or not all(response.get("ok") for response in statistics):
        problems.append(f"Statistics calls answered: {statistics}")
    page = result.get("first_page")
    if not (isinstance(page, dict) and page.get("logoLoaded") is True):
        problems.append(f"Assets did not load: {page}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", default=sys.executable, help="Python of an installed Anki")
    parser.add_argument("--collection", type=Path, help="start with a copy of this collection")
    parser.add_argument("--screenshots", type=Path, help="save screenshots to this folder")
    options = parser.parse_args()

    prepare(options.collection)
    env = {
        **os.environ,
        "STATLY_SMOKE_OUT": str(RESULT),
        "STATLY_SMOKE_BRIDGE": str(ROOT / "packages/mcp-bridge/dist/index.mjs"),
    }
    if options.screenshots:
        env["STATLY_SMOKE_SCREENSHOTS"] = str(options.screenshots.resolve())
    try:
        subprocess.run(
            [options.python, str(ROOT / "scripts/run_anki.py"), str(BASE)],
            env=env,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print("Anki did not finish in time.")
        return 1
    if not RESULT.exists():
        print("Anki finished without a result.")
        return 1
    result = json.loads(RESULT.read_text(encoding="utf-8"))
    if "failure" in result:
        print(result["failure"])
        return 1
    problems = check(result)
    for problem in problems:
        print(problem)
    if not problems:
        print("Smoke test passed.")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
