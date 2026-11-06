from __future__ import annotations

from datetime import date
from typing import Any, cast

from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer

from statly.contract.types import SettingsGetResult
from statly.core.contract import Contract
from statly.core.reader import CollectionReader
from statly.modules.deck_overview import heatmap_grid, heatmap_payload
from statly.modules.deck_overview.heatmap_html import render_heatmap_markup
from statly.modules.deck_overview.styles import (
    counter_styles,
    wallpaper_styles,
    wallpaper_video,
)


def settings(**changes: Any) -> SettingsGetResult:
    defaults: dict[str, Any] = {**Contract().default_settings, **changes}
    return cast(SettingsGetResult, defaults)


def test_counter_colors_are_off_by_default() -> None:
    assert counter_styles(settings()) == ""


def test_counter_colors_cover_both_modes() -> None:
    css = counter_styles(settings(counterColorsEnabled=True))
    assert ".new-count{color:#0071D3!important}" in css
    assert ".nightMode .review-count{color:#63D471!important}" in css


def wallpaper(**changes: Any) -> dict[str, Any]:
    base = dict(Contract().default_settings["wallpaper"])
    return {**base, "enabled": True, **changes}


def test_no_wallpaper_styles_unless_enabled_with_a_source() -> None:
    assert wallpaper_styles(settings(), None) == ""
    assert wallpaper_styles(settings(wallpaper=wallpaper(source="none")), None) == ""


def test_missing_image_leaves_the_deck_overview_alone() -> None:
    """Prototype bug: a deleted wallpaper file crashed Anki's main screen."""
    assert wallpaper_styles(settings(wallpaper=wallpaper(source="image")), None) == ""


def test_wallpaper_applies_the_chosen_look() -> None:
    choice = wallpaper(source="image", blur=4, overlay=50, position="top", textColor="light")
    css = wallpaper_styles(settings(wallpaper=choice), "data:image/jpeg;base64,AA==")
    assert "data:image/jpeg;base64,AA==" in css
    assert "filter:blur(4px)" in css
    assert "rgba(0,0,0,0.5)" in css
    assert "center top" in css
    assert "#f6f7fb" in css


def test_sample_wallpaper_needs_no_file() -> None:
    css = wallpaper_styles(settings(wallpaper=wallpaper(source="aero")), None)
    assert 'url("data:image/jpeg;base64,' in css


def test_the_deck_overview_can_keep_its_own_look() -> None:
    choice = wallpaper(source="aero", deckOverview=False)
    assert wallpaper_styles(settings(wallpaper=choice), None) == ""


def test_a_video_plays_behind_the_page_with_the_chosen_look() -> None:
    choice = wallpaper(source="image", blur=4, overlay=50, position="top", loop=True)
    html = wallpaper_video(settings(wallpaper=choice), "/_addons/statly/video.webm")
    assert '<video src="/_addons/statly/video.webm" autoplay muted playsinline loop>' in html
    assert "filter:blur(4px)" in html
    assert "rgba(0,0,0,0.5)" in html
    assert "object-position:center top" in html


def test_a_video_can_play_once() -> None:
    choice = wallpaper(source="image", loop=False)
    assert " loop" not in wallpaper_video(settings(wallpaper=choice), "/video.webm")


def test_heatmap_grid_covers_whole_weeks_from_monday() -> None:
    grid = heatmap_grid(2026, [{"date": "2026-03-01", "count": 5}])
    assert len(grid) % 7 == 0
    assert date.fromisoformat(grid[0]["date"]).weekday() == 0
    assert date.fromisoformat(grid[-1]["date"]).weekday() == 6
    assert {"date": "2026-03-01", "value": 5} in grid


def test_heatmap_markup_from_a_real_collection(collection: Collection) -> None:
    # The fixture's card is still in its steps, so only the card answered Easy is a review.
    scheduler: Any = collection.sched
    card = scheduler.getCard()
    states = collection._backend.get_scheduling_states(card.id)
    scheduler.answer_card(scheduler.build_answer(card=card, states=states, rating=CardAnswer.EASY))
    payload = heatmap_payload(CollectionReader(collection))
    assert payload["todayReviews"] == 1
    html = render_heatmap_markup(payload, "de")
    assert "statly-deck-overview-heatmap" in html
    assert "Heute 1 Karte" in html
