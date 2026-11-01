"""The card template. It stays free of anything Anki would rewrite while rendering."""

from __future__ import annotations

from pathlib import Path

MARKER = "statly-dashboard-card"
_FOLDER = Path(__file__).parent
_FORBIDDEN = ("{{", "[sound:", "</script")

_FRONT = f"""<!-- {MARKER} -->
<div id="statly-card" class="tappable"><div id="statly-root"></div></div>
<div id="statly-data" hidden>{{{{Data}}}}</div>
<script>__VIEWER__</script>
"""


def viewer_script() -> str:
    script = (_FOLDER / "viewer.js").read_text(encoding="utf-8")
    for token in _FORBIDDEN:
        if token in script:
            raise ValueError(f"The card script must not contain {token!r}.")
    return script


def front_template() -> str:
    return _FRONT.replace("__VIEWER__", viewer_script())


def card_styles() -> str:
    return (_FOLDER / "card.css").read_text(encoding="utf-8")
