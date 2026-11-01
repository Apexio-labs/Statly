from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from statly.core.contract import Contract
from statly.core.errors import InvalidParams, NotAllowed
from statly.core.settings import SettingsService
from statly.core.storage import JsonStore
from statly.modules.dashboard import DashboardService


@pytest.fixture
def store(tmp_path: Path) -> JsonStore:
    return JsonStore(lambda: tmp_path / "statly_data")


@pytest.fixture
def dashboard(store: JsonStore) -> DashboardService:
    contract = Contract()
    return DashboardService(store, contract, SettingsService(store, contract))


def data_file(tmp_path: Path, name: str) -> Path:
    return tmp_path / "statly_data" / f"{name}.json"


def test_store_round_trip_and_missing_file(store: JsonStore) -> None:
    assert store.read("thing") is None
    store.write("thing", {"ä": 1})
    assert store.read("thing") == {"ä": 1}


def test_failed_write_keeps_the_old_file(
    store: JsonStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store.write("thing", {"version": 1})

    def fail(*_args: Any) -> None:
        raise OSError("disk full")

    monkeypatch.setattr("os.replace", fail)
    with pytest.raises(OSError, match="disk full"):
        store.write("thing", {"version": 2})
    monkeypatch.undo()

    assert store.read("thing") == {"version": 1}
    assert [path.name for path in (tmp_path / "statly_data").iterdir()] == ["thing.json"]


def test_damaged_file_is_kept_aside_not_overwritten(store: JsonStore, tmp_path: Path) -> None:
    store.write("thing", {})
    data_file(tmp_path, "thing").write_text("{broken", encoding="utf-8")

    assert store.read("thing") is None
    assert (tmp_path / "statly_data" / "thing.damaged").read_text(encoding="utf-8") == "{broken"


def test_links_are_refused(store: JsonStore, tmp_path: Path) -> None:
    target = tmp_path / "elsewhere.json"
    target.write_text("{}", encoding="utf-8")
    folder = tmp_path / "statly_data"
    folder.mkdir()
    (folder / "thing.json").symlink_to(target)
    with pytest.raises(NotAllowed):
        store.write("thing", {"changed": True})
    assert target.read_text(encoding="utf-8") == "{}"


def test_new_dashboard_uses_the_default_layout(dashboard: DashboardService) -> None:
    assert [widget["id"] for widget in dashboard.get()["widgets"]][:4] == [
        "review-summary-1",
        "study-time-1",
        "success-rate-1",
        "due-cards-1",
    ]


def test_saved_layout_survives_a_restart(dashboard: DashboardService, store: JsonStore) -> None:
    layout = deepcopy(dashboard.get())
    layout["widgets"][0]["y"] = 40
    dashboard.store({"layout": layout})
    contract = Contract()
    assert DashboardService(store, contract, SettingsService(store, contract)).get() == layout


@pytest.mark.parametrize(
    "change",
    [
        {"w": 1},  # below the minimum
        {"w": 12},  # above a tile's maximum
        {"x": 11},  # outside the grid
        {"h": 50},
    ],
)
def test_impossible_sizes_are_rejected(dashboard: DashboardService, change: dict[str, int]) -> None:
    layout = deepcopy(dashboard.get())
    layout["widgets"][0].update(change)  # type: ignore[typeddict-item]
    with pytest.raises(InvalidParams):
        dashboard.store({"layout": layout})


def test_duplicate_ids_are_rejected(dashboard: DashboardService) -> None:
    layout = deepcopy(dashboard.get())
    layout["widgets"][1]["id"] = layout["widgets"][0]["id"]
    with pytest.raises(InvalidParams):
        dashboard.store({"layout": layout})


@pytest.mark.parametrize(
    "content",
    [
        {"widgets": [{"id": "a", "type": "removed-widget", "x": 0, "y": 0, "w": 3, "h": 4}]},
        {"unexpected": True},
        [1, 2, 3],
    ],
)
def test_unusable_stored_layout_falls_back(
    dashboard: DashboardService, tmp_path: Path, content: Any
) -> None:
    folder = tmp_path / "statly_data"
    folder.mkdir()
    (folder / "dashboard.json").write_text(json.dumps(content), encoding="utf-8")
    assert dashboard.get()["widgets"]


def test_an_unreadable_layout_stays_around_for_a_rescue(
    dashboard: DashboardService, store: JsonStore
) -> None:
    unreadable = {"widgets": [{"format": "of a later version"}]}
    store.write("dashboard", unreadable)
    dashboard.get()
    assert store.read("dashboard-unreadable") == unreadable


def test_reset_replaces_the_layout(dashboard: DashboardService) -> None:
    default = deepcopy(dashboard.get())
    layout = deepcopy(default)
    layout["widgets"].pop()
    dashboard.store({"layout": layout})
    assert dashboard.reset() == default
    assert dashboard.get() == default


def test_listeners_hear_only_real_changes(store: JsonStore) -> None:
    service = SettingsService(store, Contract())
    changes: list[set[str]] = []
    service.subscribe(changes.append)
    service.update({"theme": "dark"})
    service.update({"theme": "dark"})
    assert changes == [{"theme"}]


def test_settings_merge_and_persist(store: JsonStore) -> None:
    service = SettingsService(store, Contract())
    assert service.get()["theme"] == "system"
    assert service.update({"theme": "dark"})["theme"] == "dark"
    assert SettingsService(store, Contract()).get()["theme"] == "dark"
    assert SettingsService(store, Contract()).get()["language"] == "auto"


def test_unusable_settings_fall_back_to_defaults(store: JsonStore) -> None:
    store.write("settings", {"theme": "neon"})
    assert SettingsService(store, Contract()).get()["theme"] == "system"


PROTOTYPE_SETTINGS: dict[str, Any] = {
    "schema_version": 2,
    "theme": "frutiger_aero",
    "language": "de",
    "counter_colors_enabled": True,
    "counter_colors": {
        "light": {"new": "#111111", "learning": "#222222", "due": "#333333"},
        "dark": {"new": "#444444", "learning": "#555555", "due": "#666666"},
    },
    "wallpaper_enabled": True,
    "wallpaper_file": "wallpaper.jpg",
    "wallpaper_preset": "",
    "wallpaper_blur": 4,
    "wallpaper_overlay": 10,
    "wallpaper_position": "top",
    "wallpaper_text_color": "light",
    "shortcuts": {"dashboard": "Ctrl+Alt+D", "anki_statistics": "Ctrl+Alt+S"},
    "show_heatmap_on_deck_overview": True,
    "animate_brand_on_deck_overview": False,
    "onboarding_completed": True,
    "onboarding_answers": {"user_category": "medical_student", "discovery_source": "ankiweb"},
    "dashboard_layout": {
        "schema_version": 2,
        "widgets": [
            {"id": "due-cards-1", "type": "due-cards", "x": 9, "y": 0, "w": 3, "h": 4},
            {"id": "custom-x-1", "type": "custom-x", "x": 0, "y": 4, "w": 6, "h": 8},
            {"id": "answer-buttons-1", "type": "answer-buttons", "x": 0, "y": 4, "w": 4, "h": 5},
        ],
    },
}


def test_one_setting_that_no_longer_fits_costs_only_that_setting(store: JsonStore) -> None:
    """Falling back to defaults here would wipe every choice with the next save."""
    settings = SettingsService(store, Contract())
    store.write("settings", {"theme": "dark", "language": "not a language", "gone": 1})
    current = settings.get()
    assert current["theme"] == "dark"
    assert current["language"] == settings.defaults["language"]
    assert "gone" not in current


def test_takes_over_settings_from_the_first_version(store: JsonStore) -> None:
    store.write("settings", PROTOTYPE_SETTINGS)
    result = SettingsService(store, Contract()).get()

    assert result["theme"] == "frutiger-aero"
    assert result["language"] == "de"
    assert result["counterColors"]["dark"]["due"] == "#666666"
    assert result["wallpaper"]["source"] == "image"
    assert result["wallpaper"]["position"] == "top"
    assert result["shortcuts"]["ankiStatistics"] == "Ctrl+Alt+S"
    assert result["deckHeatmap"] is True
    assert result["brandAnimation"] is False
    assert result["onboardingDone"] is True
    assert result["onboardingAnswers"] == {"role": "medical_student", "discovery": "ankiweb"}


def test_takes_over_the_layout_and_keeps_a_backup(store: JsonStore) -> None:
    store.write("settings", PROTOTYPE_SETTINGS)
    contract = Contract()
    layout = DashboardService(store, contract, SettingsService(store, contract)).get()

    assert [widget["id"] for widget in layout["widgets"]] == ["due-cards-1", "answer-buttons-1"]
    assert layout["widgets"][1]["h"] == 6
    assert store.read("settings.prototype") == PROTOTYPE_SETTINGS


def test_taking_over_happens_once(store: JsonStore) -> None:
    store.write("settings", PROTOTYPE_SETTINGS)
    service = SettingsService(store, Contract())
    service.get()
    service.update({"theme": "dark"})
    assert SettingsService(store, Contract()).get()["theme"] == "dark"


def test_unusable_old_settings_do_not_stop_statly(store: JsonStore) -> None:
    store.write("settings", {"schema_version": 2, "theme": 7, "dashboard_layout": {"widgets": [1]}})
    assert SettingsService(store, Contract()).get()["theme"] == "system"
