"""Changes an AI asks for. They wait for a person, and each one can be taken back."""

from __future__ import annotations

import secrets
from collections.abc import Callable
from datetime import datetime
from typing import Any, cast

from ...core.contract import Contract
from ...core.errors import InvalidParams, NotAllowed
from ...core.settings import SettingsService
from ...core.storage import JsonStore
from ..dashboard import DashboardService, check_layout
from ..widgets.storage import WidgetStore, size_rules

_PROPOSALS = "ai-proposals"
_CHANGES = "ai-changes"
_MAX_PROPOSALS = 50
_MAX_CHANGES = 200
_MAX_AUTO_PER_MINUTE = 5
_CUSTOM_PREFIX = "custom:"
_GRID_COLUMNS = 12


class ChangeBook:
    def __init__(
        self,
        store: JsonStore,
        contract: Contract,
        settings: SettingsService,
        dashboard: DashboardService,
        widgets: WidgetStore,
        monotonic: Callable[[], float],
        on_applied: Callable[[], None],
    ) -> None:
        self._store = store
        self._contract = contract
        self._settings = settings
        self._dashboard = dashboard
        self._widgets = widgets
        self._monotonic = monotonic
        self._on_applied = on_applied
        self._setting_keys = frozenset(contract.ai["settingKeys"])
        self._auto_times: list[float] = []

    def _proposals(self) -> list[dict[str, Any]]:
        stored: Any = self._store.read(_PROPOSALS)
        return cast(list[dict[str, Any]], stored) if isinstance(stored, list) else []

    def changes(self) -> list[dict[str, Any]]:
        stored: Any = self._store.read(_CHANGES)
        return cast(list[dict[str, Any]], stored) if isinstance(stored, list) else []

    def visible_changes(self) -> list[dict[str, Any]]:
        """The log without the stored values, newest first."""
        hidden = {"before", "after"}
        return [
            {key: value for key, value in change.items() if key not in hidden}
            for change in reversed(self.changes())
        ]

    def proposals(self) -> list[dict[str, Any]]:
        return self._proposals()

    def _check(self, proposal: dict[str, Any]) -> None:
        """The same rules apply to every route, whatever a tool or a model claims."""
        kind = proposal["kind"]
        if kind == "settings":
            refused = set(proposal["patch"]) - self._setting_keys
            if refused:
                raise NotAllowed(f"These settings cannot be changed by AI: {sorted(refused)}")
        elif kind == "dashboard":
            rules = {item["id"]: size_rules(item) for item in self._widgets.list()}
            check_layout(proposal["layout"], self._contract.grid, rules)
        elif kind == "widget":
            self._contract.check_params("widgets.save", {"widget": proposal["widget"]})
        else:
            raise NotAllowed(f"Unknown kind of change: {kind}")

    def propose(self, fields: dict[str, Any], source: str) -> dict[str, Any]:
        proposal = {
            **fields,
            "id": secrets.token_hex(8),
            "source": source,
            "createdAt": datetime.now().isoformat(timespec="seconds"),
            "status": "pending",
        }
        self._check(proposal)
        kept = [item for item in self._proposals() if item["status"] == "pending"]
        self._store.write(_PROPOSALS, [*kept, proposal][-_MAX_PROPOSALS:])
        return proposal

    def may_apply_alone(self) -> bool:
        """Even the automatic mode stays bounded, so a runaway loop cannot do much."""
        now = self._monotonic()
        self._auto_times = [moment for moment in self._auto_times if now - moment < 60]
        if len(self._auto_times) >= _MAX_AUTO_PER_MINUTE:
            return False
        self._auto_times.append(now)
        return True

    def _set_status(self, proposal_id: str, status: str) -> None:
        proposals = self._proposals()
        for item in proposals:
            if item["id"] == proposal_id:
                item["status"] = status
        self._store.write(_PROPOSALS, proposals)

    def _find(self, proposal_id: str) -> dict[str, Any]:
        for item in self._proposals():
            if item["id"] == proposal_id and item["status"] == "pending":
                return item
        raise InvalidParams("This suggestion is no longer open.")

    def reject(self, proposal_id: str) -> None:
        self._find(proposal_id)
        self._set_status(proposal_id, "rejected")

    def apply(self, proposal_id: str, mode: str = "approved", widget: Any = None) -> None:
        """``widget`` is the suggestion as someone finished it in the editor."""
        proposal = self._find(proposal_id)
        if widget is not None:
            proposal = {**proposal, "widget": widget}
        self._check(proposal)
        before = self._current(proposal)
        after = self._write(proposal)
        log = [
            *self.changes(),
            {
                "id": secrets.token_hex(8),
                "at": datetime.now().isoformat(timespec="seconds"),
                "kind": proposal["kind"],
                "summary": proposal["summary"],
                "source": proposal["source"],
                "mode": mode,
                "rolledBack": False,
                "before": before,
                "after": after,
            },
        ]
        self._store.write(_CHANGES, log[-_MAX_CHANGES:])
        self._set_status(proposal_id, "applied")
        self._on_applied()

    def _current(self, proposal: dict[str, Any]) -> dict[str, Any]:
        kind = proposal["kind"]
        if kind == "settings":
            current = self._settings.get()
            return {"patch": {key: current[key] for key in proposal["patch"]}}
        if kind == "dashboard":
            return {"layout": self._dashboard.get()}
        layout = self._dashboard.get() if proposal.get("addToDashboard") else None
        return {"widget": self._widgets.get(proposal["widget"]["id"]), "layout": layout}

    def _write(self, proposal: dict[str, Any]) -> dict[str, Any]:
        kind = proposal["kind"]
        if kind == "settings":
            self._settings.update(proposal["patch"])
            return {"patch": proposal["patch"]}
        if kind == "dashboard":
            self._dashboard.store(cast(Any, {"layout": proposal["layout"]}))
            return {"layout": proposal["layout"]}
        widget = self._widgets.put(proposal["widget"])
        if not proposal.get("addToDashboard"):
            return {"widget": widget}
        layout = self._with_widget(self._dashboard.get(), widget)
        self._dashboard.store(cast(Any, {"layout": layout}))
        return {"widget": widget, "layout": layout}

    def _with_widget(self, layout: Any, widget: Any) -> dict[str, Any]:
        """New widgets go below everything else, where nothing has to move."""
        placed = list(layout["widgets"])
        kind = f"{_CUSTOM_PREFIX}{widget['id']}"
        if any(item["type"] == kind for item in placed):
            return {"widgets": placed}
        rows = max((item["y"] + item["h"] for item in placed), default=0)
        width = min(widget["size"]["w"], _GRID_COLUMNS)
        placed.append(
            {
                "id": f"{kind.replace(':', '-')}-{secrets.token_hex(3)}",
                "type": kind,
                "x": 0,
                "y": rows,
                "w": width,
                "h": widget["size"]["h"],
            }
        )
        return {"widgets": placed}

    def rollback(self, change_id: str) -> None:
        log = self.changes()
        change = next((item for item in log if item["id"] == change_id), None)
        if change is None or change["rolledBack"]:
            raise InvalidParams("This change can no longer be undone.")
        before = change["before"]
        if change["kind"] == "settings":
            self._settings.update(before["patch"])
        elif change["kind"] == "dashboard":
            self._dashboard.store(cast(Any, {"layout": before["layout"]}))
        else:
            self._restore_widget(change, before)
        change["rolledBack"] = True
        self._store.write(_CHANGES, log)
        self._on_applied()

    def _restore_widget(self, change: dict[str, Any], before: dict[str, Any]) -> None:
        if before.get("layout") is not None:
            self._dashboard.store(cast(Any, {"layout": before["layout"]}))
        widget = before.get("widget")
        if widget is not None:
            self._widgets.put(widget)
        else:
            self._widgets.delete(change["after"]["widget"]["id"])
