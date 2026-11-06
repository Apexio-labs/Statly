"""CSS for Anki's deck overview: counter colors and the wallpaper."""

from __future__ import annotations

import base64
from functools import cache
from html import escape
from pathlib import Path

from ...contract.types import SettingsGetResult

_COUNTERS = (("new", "new-count"), ("learning", "learn-count"), ("due", "review-count"))
_MODES = (("light", ""), ("dark", ".nightMode"))
_AERO = Path(__file__).parent / "aero-wallpaper.jpg"
_POSITIONS = {"center": "center center", "top": "center top", "bottom": "center bottom"}
_SUMMARY_COLORS = {"light": "#f6f7fb", "dark": "#202838"}
_SURFACE = "body{position:relative;isolation:isolate;background:transparent!important}"


@cache
def _aero_image() -> str:
    encoded = base64.b64encode(_AERO.read_bytes()).decode("ascii")
    return f'url("data:image/jpeg;base64,{encoded}")'


def shows_wallpaper(settings: SettingsGetResult) -> bool:
    wallpaper = settings["wallpaper"]
    return wallpaper["enabled"] and wallpaper["deckOverview"] and wallpaper["source"] != "none"


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
    if not shows_wallpaper(settings):
        return ""
    image = _aero_image() if wallpaper["source"] == "aero" else f'url("{image_url}")'
    if wallpaper["source"] == "image" and image_url is None:
        return ""
    blur, shade = wallpaper["blur"], wallpaper["overlay"] / 100
    return (
        f"{_SURFACE}"
        f"body::before{{content:'';position:fixed;inset:-{blur}px;z-index:-1;"
        "pointer-events:none;background-image:"
        f"linear-gradient(rgba(0,0,0,{shade}),rgba(0,0,0,{shade})),{image};"
        f"background-size:cover;background-position:{_POSITIONS[wallpaper['position']]};"
        f"background-repeat:no-repeat;filter:blur({blur}px)}}"
        f"#studiedToday,#studiedToday span{{color:{_SUMMARY_COLORS[wallpaper['textColor']]}}}"
    )


def wallpaper_video(settings: SettingsGetResult, url: str) -> str:
    """CSS cannot show a video, so this one is an element behind everything on the page."""
    wallpaper = settings["wallpaper"]
    blur, shade = wallpaper["blur"], wallpaper["overlay"] / 100
    loop = " loop" if wallpaper["loop"] else ""
    return (
        f"<style>{_SURFACE}"
        f"#statly-wallpaper{{position:fixed;inset:-{blur}px;z-index:-1;pointer-events:none;"
        f"filter:blur({blur}px)}}"
        "#statly-wallpaper video{display:block;width:100%;height:100%;object-fit:cover;"
        f"object-position:{_POSITIONS[wallpaper['position']]}}}"
        "#statly-wallpaper::after{content:'';position:absolute;inset:0;"
        f"background:rgba(0,0,0,{shade})}}"
        f"#studiedToday,#studiedToday span{{color:{_SUMMARY_COLORS[wallpaper['textColor']]}}}"
        "</style>"
        f'<div id="statly-wallpaper"><video src="{escape(url)}" autoplay muted playsinline'
        f"{loop}></video></div>"
    )
