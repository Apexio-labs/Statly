"""Statly add-on entry point. Importing outside of Anki has no side effects."""

from __future__ import annotations

from aqt import mw

if mw is not None:  # pyright: ignore[reportUnnecessaryComparison]
    from .host.bootstrap import start

    start(mw)
