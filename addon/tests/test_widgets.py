from __future__ import annotations

import json
import zlib
from io import BytesIO
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo

import pytest

from statly.core.contract import Contract
from statly.core.errors import InvalidParams, NotAllowed
from statly.core.settings import SettingsService
from statly.core.storage import JsonStore
from statly.modules.dashboard import DashboardService
from statly.modules.widgets.sharing import export_package, read_package
from statly.modules.widgets.storage import WidgetStore, check_size, media_references


def png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        crc = zlib.crc32(body).to_bytes(4, "big")
        return len(data).to_bytes(4, "big") + body + crc

    header = (1).to_bytes(4, "big") * 2 + b"\x08\x06\x00\x00\x00"
    pixels = zlib.compress(b"\x00\x00\x00\x00\x00")
    return (
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", pixels) + chunk(b"IEND", b"")
    )


def widget(**changes: Any) -> Any:
    base: dict[str, Any] = {
        "id": "goal",
        "name": "Daily goal",
        "description": "",
        "size": {"w": 4, "h": 6},
        "background": {"kind": "card"},
        "elements": [
            {
                "id": "a",
                "kind": "text",
                "x": 5,
                "y": 5,
                "w": 50,
                "h": 20,
                "opacity": 1,
                "size": 12,
                "bold": True,
                "align": "left",
                "color": "text",
                "text": "Hello",
            }
        ],
    }
    return {**base, **changes}


def image_element(asset_id: str) -> dict[str, Any]:
    return {
        "id": "picture",
        "kind": "media",
        "x": 0,
        "y": 0,
        "w": 100,
        "h": 100,
        "opacity": 1,
        "asset": {"id": asset_id, "type": "image/png"},
        "fit": "cover",
        "radius": 0,
    }


@pytest.fixture
def store(tmp_path: Path) -> WidgetStore:
    return WidgetStore(
        lambda: tmp_path,
        Contract(),
        lambda: tmp_path / "custom_widgets" / "media",
        lambda name: f"../media/{name}",
    )


def test_a_dashboard_background_is_not_thrown_away_as_unused(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    kept = media / ("a" * 64 + ".png")
    gone = media / ("b" * 64 + ".png")
    kept.write_bytes(b"x")
    gone.write_bytes(b"x")
    store = WidgetStore(
        lambda: tmp_path, Contract(), lambda: media, lambda name: name, lambda: {"a" * 64}
    )
    store.remove_unused_media()
    assert kept.exists()
    assert not gone.exists()


def test_round_trip(store: WidgetStore) -> None:
    store.put(widget())
    assert store.get("goal") == widget()


def test_definitions_are_sorted_by_name(store: WidgetStore) -> None:
    store.put(widget(id="b", name="Zebra"))
    store.put(widget(id="a", name="apple"))
    assert [item["name"] for item in store.list()] == ["apple", "Zebra"]


def test_one_damaged_file_does_not_hide_the_others(store: WidgetStore, tmp_path: Path) -> None:
    store.put(widget())
    (tmp_path / "custom_widgets" / "broken.json").write_text("{nope", encoding="utf-8")
    (tmp_path / "custom_widgets" / "odd.json").write_text('{"id": 1}', encoding="utf-8")
    assert [item["id"] for item in store.list()] == ["goal"]


def test_duplicate_element_ids_are_refused(store: WidgetStore) -> None:
    element = widget()["elements"][0]
    with pytest.raises(InvalidParams):
        store.put(widget(elements=[element, element]))


def test_widget_cannot_point_to_media_that_is_not_there(store: WidgetStore) -> None:
    with pytest.raises(InvalidParams):
        store.put(widget(elements=[image_element("a" * 64)]))


def test_media_is_checked_by_content(store: WidgetStore) -> None:
    with pytest.raises(ValueError, match="Unsupported"):
        store.add_media(b"<script>alert(1)</script>")


def test_media_round_trip_and_address(store: WidgetStore) -> None:
    asset = store.add_media(png())
    assert asset["type"] == "image/png"
    assert store.media_url(asset["id"]) == f"../media/{asset['id']}.png"


def test_videos_go_through_conversion(store: WidgetStore, tmp_path: Path) -> None:
    source = tmp_path / "clip.mov"
    source.write_bytes(b"not really a video")
    seen: list[Path] = []

    def convert(given: Path, target: Path) -> None:
        seen.append(given)
        target.write_bytes(png())

    asset = store.add_file(source, convert)
    assert seen == [source]
    assert asset["type"] == "image/png"


def test_files_with_a_wrong_extension_are_refused(store: WidgetStore, tmp_path: Path) -> None:
    source = tmp_path / "picture.png"
    source.write_bytes(b"<html>")
    with pytest.raises(InvalidParams):
        store.add_file(source, lambda _source, _target: None)


def test_sizes_must_make_sense() -> None:
    check_size({"w": 4, "h": 6, "minW": 2, "maxW": 8})
    with pytest.raises(InvalidParams):
        check_size({"w": 4, "h": 6, "minW": 5})
    with pytest.raises(InvalidParams):
        check_size({"w": 4, "h": 6, "maxH": 5})


def test_media_lookup_refuses_paths(store: WidgetStore) -> None:
    assert store.media_url("../../secret") is None


def test_deleting_a_widget_removes_only_media_nobody_uses(
    store: WidgetStore, tmp_path: Path
) -> None:
    asset = store.add_media(png())
    store.put(widget(id="one", elements=[image_element(asset["id"])]))
    store.put(widget(id="two", elements=[image_element(asset["id"])]))
    store.delete("one")
    assert store.read_media(asset["id"]) is not None
    store.delete("two")
    assert store.read_media(asset["id"]) is None
    assert list((tmp_path / "custom_widgets" / "media").iterdir()) == []


def test_delete_refuses_strange_ids(store: WidgetStore) -> None:
    with pytest.raises(InvalidParams):
        store.delete("../settings")


def test_limit_of_widgets(store: WidgetStore, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("statly.modules.widgets.storage.MAX_WIDGETS", 1)
    store.put(widget())
    store.put(widget(name="Still the same one"))
    with pytest.raises(NotAllowed):
        store.put(widget(id="second"))


def test_package_round_trip(store: WidgetStore) -> None:
    asset = store.add_media(png())
    definition = widget(elements=[image_element(asset["id"])])
    store.put(definition)
    package = export_package(definition, {asset["id"]: png()})

    restored, files = read_package(package, Contract())

    assert restored == definition
    assert files == {asset["id"]: png()}
    assert media_references(restored) == {asset["id"]: "image/png"}


def make_package(entries: dict[str, bytes], manifest: Any = None) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        document = manifest or {"format": "statly-widget", "version": 2, "widget": widget()}
        archive.writestr("manifest.json", json.dumps(document), compress_type=ZIP_DEFLATED)
        for name, data in entries.items():
            archive.writestr(name, data, compress_type=ZIP_STORED)
    return buffer.getvalue()


@pytest.mark.parametrize(
    "package",
    [
        b"",
        b"not a zip",
        make_package({"../evil.txt": b"x"}),
        make_package({"media/extra.png": png()}),
        make_package({}, {"format": "statly-widget", "version": 1, "widget": widget()}),
        make_package({}, {"format": "other", "version": 2, "widget": widget()}),
        make_package(
            {}, {"format": "statly-widget", "version": 2, "widget": widget(elements="html")}
        ),
    ],
)
def test_bad_packages_are_refused(package: bytes) -> None:
    with pytest.raises(InvalidParams):
        read_package(package, Contract())


def test_symbolic_links_in_packages_are_refused() -> None:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("manifest.json", "{}")
        link = ZipInfo("media/link.png")
        link.external_attr = 0o120777 << 16
        archive.writestr(link, "/etc/passwd")
    with pytest.raises(InvalidParams):
        read_package(buffer.getvalue(), Contract())


def test_media_with_a_wrong_hash_is_refused() -> None:
    claimed = "a" * 64
    definition = widget(elements=[image_element(claimed)])
    package = make_package(
        {f"media/{claimed}.png": png()},
        {"format": "statly-widget", "version": 2, "widget": definition},
    )
    with pytest.raises(InvalidParams):
        read_package(package, Contract())


def test_widget_on_the_dashboard_disappears_with_the_widget(tmp_path: Path) -> None:
    contract = Contract()
    json_store = JsonStore(lambda: tmp_path)
    custom = {"goal": {"minW": 2, "maxW": 6, "minH": 2, "maxH": 8}}
    service = DashboardService(json_store, contract, SettingsService(json_store, contract))
    service.add_source("custom:", lambda: custom)
    built_in: Any = {"id": "due-1", "type": "due-cards", "x": 0, "y": 0, "w": 3, "h": 4}
    mine: Any = {"id": "mine", "type": "custom:goal", "x": 3, "y": 0, "w": 4, "h": 6}
    service.store({"layout": {"widgets": [built_in, mine]}})
    assert len(service.get()["widgets"]) == 2

    custom.clear()

    assert service.get()["widgets"] == [built_in]


def test_a_widget_follows_new_size_limits(tmp_path: Path) -> None:
    contract = Contract()
    json_store = JsonStore(lambda: tmp_path)
    rules = {"goal": {"minW": 2, "maxW": 12, "minH": 2, "maxH": 16}}
    service = DashboardService(json_store, contract, SettingsService(json_store, contract))
    service.add_source("custom:", lambda: rules)
    mine: Any = {"id": "mine", "type": "custom:goal", "x": 0, "y": 0, "w": 10, "h": 10}
    service.store({"layout": {"widgets": [mine]}})

    rules["goal"] = {"minW": 2, "maxW": 6, "minH": 2, "maxH": 8}

    assert service.get()["widgets"][0] == {**mine, "w": 6, "h": 8}


def test_unknown_custom_widgets_cannot_be_saved(tmp_path: Path) -> None:
    contract = Contract()
    json_store = JsonStore(lambda: tmp_path)
    service = DashboardService(json_store, contract, SettingsService(json_store, contract))
    mine: Any = {"id": "mine", "type": "custom:ghost", "x": 0, "y": 0, "w": 4, "h": 6}
    with pytest.raises(InvalidParams):
        service.store({"layout": {"widgets": [mine]}})
