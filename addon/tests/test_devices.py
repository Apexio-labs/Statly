"""The dashboard on phones and tablets, worked out from the desktop."""

from __future__ import annotations

from typing import Any

import pytest

from statly.core.contract import Contract
from statly.core.errors import InvalidParams
from statly.core.settings import SettingsService
from statly.core.storage import JsonStore
from statly.modules.dashboard import DashboardService, check_device
from statly.modules.dashboard.devices import arrange, default_period, follow_desktop, resolve

RULES = Contract().grid["widgets"]
PHONE = 4
TABLET = 8


def rules_of(kind: str) -> dict[str, int] | None:
    if kind == "custom:wide":
        return {"minW": 6, "maxW": 12, "minH": 2, "maxH": 16, "w": 6, "h": 6}
    return RULES.get(kind)


def widget(kind: str, x: int, y: int, w: int, h: int, name: str | None = None) -> dict[str, Any]:
    return {"id": name or kind, "type": kind, "x": x, "y": y, "w": w, "h": h}


DEFAULT = Contract().grid["defaultLayout"]["widgets"]


def boxes(widgets: list[dict[str, Any]]) -> list[tuple[int, int, int, int]]:
    return [(item["x"], item["y"], item["w"], item["h"]) for item in widgets]


def no_overlaps(widgets: list[dict[str, Any]]) -> bool:
    cells = [
        (x, y)
        for item in widgets
        for x in range(item["x"], item["x"] + item["w"])
        for y in range(item["y"], item["y"] + item["h"])
    ]
    return len(cells) == len(set(cells))


def test_tiles_pair_up_and_charts_fill_a_phone() -> None:
    assert boxes(arrange(DEFAULT, PHONE, rules_of)) == [
        (0, 0, 2, 3),
        (2, 0, 2, 3),
        (0, 3, 2, 3),
        (2, 3, 2, 3),
        (0, 6, 4, 4),
        (0, 10, 4, 6),
    ]


def test_a_tablet_keeps_more_side_by_side() -> None:
    arranged = arrange(DEFAULT, TABLET, rules_of)
    assert boxes(arranged)[:4] == [(0, 0, 2, 3), (2, 0, 2, 3), (4, 0, 2, 3), (6, 0, 2, 3)]
    assert no_overlaps(arranged)
    assert max(item["x"] + item["w"] for item in arranged) == TABLET


def test_reading_order_survives() -> None:
    desktop = [
        widget("study-time", 6, 0, 3, 4),
        widget("review-summary", 0, 0, 3, 4),
        widget("due-cards", 0, 6, 3, 4),
    ]
    arranged = arrange(desktop, PHONE, rules_of)
    assert [item["type"] for item in arranged] == ["review-summary", "study-time", "due-cards"]


def test_a_row_is_filled_instead_of_leaving_a_hole() -> None:
    arranged = arrange([widget("due-cards", 0, 0, 3, 4)], PHONE, rules_of)
    assert boxes(arranged) == [(0, 0, 4, 3)]


def test_a_widget_too_wide_for_the_device_shrinks_to_fit() -> None:
    arranged = arrange([widget("custom:wide", 0, 0, 6, 6)], PHONE, rules_of)
    assert boxes(arranged) == [(0, 0, 4, 6)]


def test_heights_follow_the_content_instead_of_the_desktop() -> None:
    desktop = [widget("review-heatmap", 0, 0, 12, 8), widget("answer-buttons", 0, 8, 6, 12)]
    assert [item["h"] for item in arrange(desktop, PHONE, rules_of)] == [3, 4]
    assert arrange(desktop, TABLET, rules_of)[0]["h"] == 5


def test_custom_widgets_keep_the_height_they_were_built_with() -> None:
    assert arrange([widget("custom:wide", 0, 0, 6, 9)], PHONE, rules_of)[0]["h"] == 9


def test_unknown_widgets_are_left_out() -> None:
    assert arrange([widget("gone", 0, 0, 3, 4)], PHONE, rules_of) == []


@pytest.mark.parametrize(
    ("kind", "period"),
    [
        ("due-cards", "today"),
        ("review-timeline", "last30"),
        ("custom:x", "last7"),
    ],
)
def test_periods_start_sensibly(kind: str, period: str) -> None:
    assert default_period(kind) == period


def test_every_default_widget_fits_both_devices() -> None:
    for columns in (PHONE, TABLET):
        arranged = arrange(DEFAULT, columns, rules_of)
        assert no_overlaps(arranged)
        check_device(arranged, columns, rules_of)


def test_a_device_without_arrangement_follows_the_desktop() -> None:
    assert resolve(DEFAULT, None, PHONE, rules_of)["automatic"] is True


def stored(*widgets: dict[str, Any], known: list[str]) -> dict[str, Any]:
    return {"widgets": [{**item, "period": "today"} for item in widgets], "known": known}


def test_an_arranged_device_keeps_its_arrangement() -> None:
    desktop = [widget("due-cards", 0, 0, 3, 4)]
    mine = widget("due-cards", 2, 9, 2, 4)
    result = resolve(desktop, stored(mine, known=["due-cards"]), PHONE, rules_of)
    assert result["automatic"] is False
    assert boxes(result["widgets"]) == [(2, 9, 2, 4)]


def test_a_new_desktop_widget_joins_at_the_bottom() -> None:
    desktop = [widget("due-cards", 0, 0, 3, 4), widget("study-time", 3, 0, 3, 4)]
    mine = stored(widget("due-cards", 0, 0, 2, 4), known=["due-cards"])
    joined = follow_desktop(desktop, mine, PHONE, rules_of)
    assert [item["type"] for item in joined] == ["due-cards", "study-time"]
    assert joined[1]["y"] == 4


def test_a_widget_deleted_on_the_desktop_leaves_the_device() -> None:
    mine = stored(widget("due-cards", 0, 0, 2, 4), known=["due-cards"])
    assert follow_desktop([], mine, PHONE, rules_of) == []


def test_a_widget_removed_from_the_device_stays_away() -> None:
    desktop = [widget("due-cards", 0, 0, 3, 4)]
    assert follow_desktop(desktop, stored(known=["due-cards"]), PHONE, rules_of) == []


def test_a_widget_added_only_on_the_device_stays() -> None:
    mine = stored(widget("study-time", 0, 0, 2, 4, "only-here"), known=[])
    assert [item["id"] for item in follow_desktop([], mine, PHONE, rules_of)] == ["only-here"]


def test_a_deleted_custom_widget_leaves_an_arranged_device() -> None:
    mine = stored(widget("custom:gone", 0, 0, 2, 4, "x"), known=[])
    assert follow_desktop([], mine, PHONE, rules_of) == []


def test_device_checks() -> None:
    fine = [widget("due-cards", 2, 0, 2, 4)]
    check_device(fine, PHONE, rules_of)
    with pytest.raises(InvalidParams):
        check_device([widget("due-cards", 3, 0, 2, 4)], PHONE, rules_of)
    with pytest.raises(InvalidParams):
        check_device([*fine, *fine], PHONE, rules_of)
    with pytest.raises(InvalidParams):
        check_device([widget("gone", 0, 0, 2, 4)], PHONE, rules_of)


def service_in(tmp_path: Any) -> DashboardService:
    contract = Contract()
    store = JsonStore(lambda: tmp_path)
    return DashboardService(store, contract, SettingsService(store, contract))


def test_arrangements_are_stored_and_reset_with_the_dashboard(tmp_path: Any) -> None:
    service = service_in(tmp_path)
    layout = service.get()
    phone: dict[str, Any] = {"widgets": service.devices(layout)["phone"]["widgets"], "known": []}
    params: Any = {"layout": layout, "devices": {"tablet": None, "phone": phone}}
    service.store(params)
    assert service.devices(layout)["phone"]["automatic"] is False
    assert service.devices(layout)["tablet"]["automatic"] is True

    service.reset()
    assert service.devices(service.get())["phone"]["automatic"] is True


def test_a_draft_can_be_previewed_without_saving(tmp_path: Any) -> None:
    service = service_in(tmp_path)
    draft = {"widgets": [widget("due-cards", 0, 0, 3, 4)]}
    assert len(service.devices(draft)["phone"]["widgets"]) == 1
    assert len(service.get()["widgets"]) > 1


def test_a_damaged_arrangement_only_costs_the_arrangement(tmp_path: Any) -> None:
    service = service_in(tmp_path)
    (tmp_path / "dashboard-devices.json").write_text('{"phone": 3}', encoding="utf-8")
    assert service.stored_devices() == {"tablet": None, "phone": None}
