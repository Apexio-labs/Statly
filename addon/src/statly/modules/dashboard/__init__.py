"""The user's dashboard layout."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from copy import deepcopy
from typing import Any, cast

from ...contract.types import DashboardGetResult, DashboardSaveParams
from ...core.contract import Contract
from ...core.errors import InvalidParams
from ...core.module import Context
from ...core.settings import SettingsService
from ...core.storage import JsonStore
from ..widgets.storage import size_rules
from .devices import DEVICE_MIN_HEIGHT, resolve

_FILE = "dashboard"
_DEVICES_FILE = "dashboard-devices"
_UNREADABLE_FILE = "dashboard-unreadable"
_DEVICES = ("tablet", "phone")
_PICTURE_FILTER = "Images (*.png *.jpg *.jpeg *.webp)"


_CUSTOM_PREFIX = "custom:"


def check_layout(
    layout: DashboardGetResult,
    grid: dict[str, Any],
    custom_rules: Mapping[str, dict[str, int]] | None = None,
) -> None:
    """Apply the rules a schema cannot express, using the sizes shared with the web app."""
    identifiers = [widget["id"] for widget in layout["widgets"]]
    if len(set(identifiers)) != len(identifiers):
        raise InvalidParams("Widget ids must be unique.")
    for widget in layout["widgets"]:
        kind = widget["type"]
        if kind.startswith(_CUSTOM_PREFIX):
            rules = (custom_rules or {}).get(kind.removeprefix(_CUSTOM_PREFIX))
            if rules is None:
                raise InvalidParams(f"Widget {widget['id']} no longer exists.")
        elif kind in grid["widgets"]:
            rules = grid["widgets"][kind]
        else:
            raise InvalidParams(f"Widget {widget['id']} has an unknown type.")
        fits_grid = widget["x"] + widget["w"] <= grid["columns"]
        fits_rules = (
            rules["minW"] <= widget["w"] <= rules["maxW"]
            and rules["minH"] <= widget["h"] <= rules["maxH"]
        )
        if not fits_grid or not fits_rules:
            raise InvalidParams(f"Widget {widget['id']} has an invalid size.")


def check_device(widgets: Any, columns: int, rules_of: Callable[[str], Any]) -> None:
    """Device layouts keep the widget's limits, as far as the device has room for them."""
    identifiers = [widget["id"] for widget in widgets]
    if len(set(identifiers)) != len(identifiers):
        raise InvalidParams("Widget ids must be unique.")
    for widget in widgets:
        rules = rules_of(widget["type"])
        if rules is None:
            raise InvalidParams(f"Widget {widget['id']} no longer exists.")
        fits = widget["x"] + widget["w"] <= columns
        wide_enough = min(rules["minW"], columns) <= widget["w"] <= min(rules["maxW"], columns)
        lowest = min(rules["minH"], DEVICE_MIN_HEIGHT)
        high_enough = lowest <= widget["h"] <= rules["maxH"]
        if not fits or not wide_enough or not high_enough:
            raise InvalidParams(f"Widget {widget['id']} has an invalid size.")


def _fit_custom_widgets(
    layout: DashboardGetResult, rules: Mapping[str, dict[str, int]]
) -> DashboardGetResult:
    """Follow changes to a custom widget: gone means removed, new limits mean a new size."""
    fitted: list[Any] = []
    for widget in layout["widgets"]:
        if not widget["type"].startswith(_CUSTOM_PREFIX):
            fitted.append(widget)
            continue
        limits = rules.get(widget["type"].removeprefix(_CUSTOM_PREFIX))
        if limits is not None:
            w = max(limits["minW"], min(limits["maxW"], widget["w"]))
            h = max(limits["minH"], min(limits["maxH"], widget["h"]))
            x = min(widget["x"], 12 - w)
            fitted.append({**widget, "x": x, "w": w, "h": h})
    return cast(DashboardGetResult, {"widgets": fitted})


class DashboardService:
    def __init__(
        self,
        store: JsonStore,
        contract: Contract,
        settings: SettingsService,
        custom_rules: Callable[[], dict[str, dict[str, int]]] = dict,
    ) -> None:
        self._store = store
        self._contract = contract
        self._settings = settings
        self._custom_rules = custom_rules

    def get(self) -> DashboardGetResult:
        # Reading settings first takes over a layout from Statly's first version, if there is one.
        self._settings.get()
        stored = self._store.read(_FILE)
        if stored is not None:
            try:
                self._contract.check_result("dashboard.get", stored)
                rules = self._custom_rules()
                layout = _fit_custom_widgets(stored, rules)
                check_layout(layout, self._contract.grid, rules)
                return layout
            except (ValueError, InvalidParams):
                # A layout from another version must not keep the dashboard from opening, and
                # the next save would overwrite it, so it stays around for a later rescue.
                self._store.write(_UNREADABLE_FILE, stored)
        return self._default()

    def store(self, params: DashboardSaveParams) -> None:
        check_layout(params["layout"], self._contract.grid, self._custom_rules())
        devices = params.get("devices")
        if devices is not None:
            for name in _DEVICES:
                stored = devices[name]
                if stored is not None:
                    check_device(stored["widgets"], self._columns(name), self._rules_of())
        self._store.write(_FILE, params["layout"])
        if devices is not None:
            self._store.write(_DEVICES_FILE, devices)

    def reset(self) -> DashboardGetResult:
        layout = self._default()
        self._store.write(_FILE, layout)
        self._store.write(_DEVICES_FILE, None)
        return layout

    def _columns(self, device: str) -> int:
        return self._contract.grid["deviceColumns"][device]

    def _rules_of(self) -> Callable[[str], dict[str, int] | None]:
        custom = self._custom_rules()
        built_in = self._contract.grid["widgets"]

        def rules_of(kind: str) -> dict[str, int] | None:
            if kind.startswith(_CUSTOM_PREFIX):
                return custom.get(kind.removeprefix(_CUSTOM_PREFIX))
            return built_in.get(kind)

        return rules_of

    def stored_devices(self) -> dict[str, Any]:
        """Layouts arranged by hand. A damaged file only costs the arrangement."""
        empty: dict[str, Any] = {name: None for name in _DEVICES}
        stored = self._store.read(_DEVICES_FILE)
        if stored is None:
            return empty
        try:
            self._contract.check_result("dashboard.storedDevices", stored)
        except ValueError:
            return empty
        return stored

    def devices(self, layout: Any, stored: Any = None) -> dict[str, Any]:
        arranged = self.stored_devices() if stored is None else stored
        rules_of = self._rules_of()
        return {
            name: resolve(layout["widgets"], arranged[name], self._columns(name), rules_of)
            for name in _DEVICES
        }

    def _default(self) -> DashboardGetResult:
        return deepcopy(self._contract.grid["defaultLayout"])


class DashboardModule:
    def register(self, context: Context) -> None:
        widgets: Any = context.services["widgets"]
        service = DashboardService(
            JsonStore(context.host.data_folder),
            context.contract,
            context.settings,
            lambda: {widget["id"]: size_rules(widget) for widget in widgets.list()},
        )
        context.services["dashboard"] = service
        context.router.local("dashboard.get", lambda _params: service.get())

        def save(params: DashboardSaveParams) -> None:
            service.store(params)
            context.events.publish("dashboard.saved", params["layout"])

        context.router.local("dashboard.save", save)
        context.router.local("dashboard.reset", lambda _params: service.reset())
        context.router.local(
            "dashboard.devices",
            lambda params: service.devices(params["layout"], params.get("devices")),
        )
        context.router.local("dashboard.storedDevices", lambda _params: service.stored_devices())

        def set_background(device: str, asset: Any) -> Any:
            chosen = {**context.settings.get()["dashboardBackgrounds"], device: asset}
            return context.settings.update(cast(Any, {"dashboardBackgrounds": chosen}))

        def choose_background(
            params: Any, finish: Callable[[Any], None], fail: Callable[[Exception], None]
        ) -> None:
            source = context.host.pick_path(_PICTURE_FILTER)
            if source is None:
                finish(context.settings.get())
                return
            context.host.run_task(
                lambda: widgets.add_file(source, context.host.convert_video),
                lambda asset: finish(set_background(params["device"], asset)),
                fail,
            )

        def remove_background(params: Any) -> Any:
            updated = set_background(params["device"], None)
            widgets.remove_unused_media()
            return updated

        context.router.deferred("dashboard.chooseBackground", choose_background)
        context.router.local("dashboard.removeBackground", remove_background)
