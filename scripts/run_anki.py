"""Start Anki on a separate data folder. Your real collection is never opened."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import aqt
from aqt.profiles import ProfileManager
from aqt.qt import QEvent, QFileOpenEvent


def ignore_own_command_line() -> None:
    """macOS hands a program's arguments over as files to open, and Anki would import them."""
    own = {Path(argument).resolve() for argument in sys.argv}
    original = aqt.AnkiApp.event

    def event(self: aqt.AnkiApp, evt: QEvent | None) -> bool:
        if isinstance(evt, QFileOpenEvent) and Path(evt.file()).resolve() in own:
            return True
        return original(self, evt)

    aqt.AnkiApp.event = event  # type: ignore[method-assign]


def main() -> None:
    base = Path(sys.argv[1]).resolve()
    if "Anki2" in base.parts:
        raise SystemExit("Refusing to run on a real Anki data folder.")
    base.mkdir(parents=True, exist_ok=True)

    # Anki allows one instance per user, not per data folder. Without this, the call would
    # only bring an already running Anki to the front.
    aqt.AnkiApp.KEY = f"statly-{hashlib.sha256(str(base).encode()).hexdigest()[:16]}"
    # A new data folder would otherwise stop at the language dialog.
    ProfileManager.setDefaultLang = lambda self, idx: self.setLang("en_US")  # type: ignore[method-assign]

    ignore_own_command_line()
    # No "-p": with it, Anki opens the profile before add-ons load, which no real start does.
    # A folder with one profile opens it on its own after that, like Anki does for most people.
    sys.argv = ["Anki", "-b", str(base)]
    aqt.run()


if __name__ == "__main__":
    main()
