"""CSS for Anki's deck overview: counter colors and the wallpaper."""

from __future__ import annotations

from ...contract.types import SettingsGetResult

_COUNTERS = (("new", "new-count"), ("learning", "learn-count"), ("due", "review-count"))
_MODES = (("light", ""), ("dark", ".nightMode"))
_AERO = (
    "radial-gradient(ellipse at 70% 22%, rgba(101,219,255,.70), transparent 40%),"
    "linear-gradient(135deg,#123f75,#1689bb 55%,#81d8e8)"
)
_POSITIONS = {"center": "center center", "top": "center top", "bottom": "center bottom"}
_SUMMARY_COLORS = {"light": "#f6f7fb", "dark": "#202838"}


def counter_styles(settings: SettingsGetResult) -> str:
    if not settings["counterColorsEnabled"]:
        return ""
    return "".join(
        f"{selector} .{css_class}{{color:{settings['counterColors'][mode][counter]}!important}}"
        for mode, selector in _MODES
        for counter, css_class in _COUNTERS
    )


def wallpaper_styles(settings: SettingsGetResult, image_url: str | None) -> str:
    wallpaper = settings["wallpaper"]
    if not wallpaper["enabled"] or wallpaper["source"] == "none":
        return ""
    image = _AERO if wallpaper["source"] == "aero" else f'url("{image_url}")'
    if wallpaper["source"] == "image" and image_url is None:
        return ""
    blur, shade = wallpaper["blur"], wallpaper["overlay"] / 100
    return (
        "body{position:relative;isolation:isolate;background:transparent!important}"
        f"body::before{{content:'';position:fixed;inset:-{blur}px;z-index:-1;"
        "pointer-events:none;background-image:"
        f"linear-gradient(rgba(0,0,0,{shade}),rgba(0,0,0,{shade})),{image};"
        f"background-size:cover;background-position:{_POSITIONS[wallpaper['position']]};"
        f"background-repeat:no-repeat;filter:blur({blur}px)}}"
        f"#studiedToday,#studiedToday span{{color:{_SUMMARY_COLORS[wallpaper['textColor']]}}}"
    )
