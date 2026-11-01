"""The Statly link in Anki's top toolbar, which takes the place of Anki's Stats link."""

from __future__ import annotations

_COLORS = {
    "light": ("#006b70", "#145a9e", "#4f347f"),
    "dark": ("#35c9bc", "#58a6f5", "#ac8aff"),
}

_ANIMATION = """
<style>
#stats .statly-brand-label {
    display: inline-block;
    background-image: linear-gradient(90deg, TEAL, BLUE, VIOLET, TEAL);
    background-size: 300% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: statly-brand-flow 10s ease-in-out forwards;
}
@keyframes statly-brand-flow {
    0% { background-position: 0 50%; }
    90% { background-position: 100% 50%; -webkit-text-fill-color: transparent; }
    100% { background-position: 100% 50%; -webkit-text-fill-color: currentColor; }
}
@media (prefers-reduced-motion: reduce) {
    #stats .statly-brand-label { animation: none; -webkit-text-fill-color: currentColor; }
}
</style>
"""


def animated(link: str, night_mode: bool) -> str:
    teal, blue, violet = _COLORS["dark" if night_mode else "light"]
    style = _ANIMATION.replace("TEAL", teal).replace("BLUE", blue).replace("VIOLET", violet)
    label = link.replace(">Statly</a>", '><span class="statly-brand-label">Statly</span></a>')
    return f"{style}{label}"
