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
from ..widgets.storage import WidgetStore

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
        goals: Any = None,
    ) -> None:
        self._goals = goals
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
            check_layout(proposal["layout"], self._contract.grid, self._dashboard.stored_rules())
        elif kind == "widget":
            self._contract.check_params("widgets.save", {"widget": proposal["widget"]})
        elif kind == "goal":
            if self._goals is None:
                raise NotAllowed("Goals are not available.")
            self._contract.check_params("goals.save", {"goal": proposal["goal"]})
        else:
            raise NotAllowed(f"Unknown kind of change: {kind}")

    def propose(self, fields: dict[str, Any], source: str) -> dict[str, Any]:
        proposal: dict[str, Any] = {
            **fields,
            "id": secrets.token_hex(8),
            "source": source,
            "createdAt": datetime.now().isoformat(timespec="seconds"),
            "status": "pending",
        }
        self._check(proposal)
        if proposal["kind"] == "goal":
            # The goal as it was, so undoing the suggestion later can put it back.
            existing = proposal["goal"]["id"]
            proposal["previous"] = self._goals.get(existing) if existing else None
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

    def apply(
        self, proposal_id: str, mode: str = "approved", widget: Any = None, goal: Any = None
    ) -> None:
        """``widget`` is the suggestion as someone finished it in the editor.

        A goal is never written here. ``goal`` is the one the person saved on the setup page,
        through the normal call, after seeing every setting; this only marks the suggestion.
        """
        proposal = self._find(proposal_id)
        if widget is not None:
            proposal = {**proposal, "widget": widget}
        self._check(proposal)
        if proposal["kind"] == "goal":
            before, after = self._settle_goal(proposal, mode, goal)
        else:
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

    def _settle_goal(
        self, proposal: dict[str, Any], mode: str, goal: Any
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if mode != "approved" or not isinstance(goal, dict):
            raise NotAllowed("A suggested goal is saved by the person on the setup page.")
        stored = self._goals.get(goal.get("id", ""))
        wanted = proposal["goal"]["id"]
        if stored is None or stored != goal or (wanted is not None and wanted != stored["id"]):
            raise InvalidParams("This goal was not saved from the suggestion.")
        return {"goal": proposal.get("previous")}, {"goal": stored}

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
        elif change["kind"] == "goal":
            self._restore_goal(change, before)
        elif change["kind"] == "dashboard":
            self._dashboard.store(cast(Any, {"layout": before["layout"]}))
        else:
            self._restore_widget(change, before)
        change["rolledBack"] = True
        self._store.write(_CHANGES, log)
        self._on_applied()

    def _restore_goal(self, change: dict[str, Any], before: dict[str, Any]) -> None:
        """A new goal goes again, a changed one gets its earlier settings back."""
        if before.get("goal") is not None:
            self._goals.restore(before["goal"])
        elif self._goals.get(change["after"]["goal"]["id"]) is not None:
            self._goals.delete(change["after"]["goal"]["id"])

    def _restore_widget(self, change: dict[str, Any], before: dict[str, Any]) -> None:
        if before.get("layout") is not None:
            self._dashboard.store(cast(Any, {"layout": before["layout"]}))
        widget = before.get("widget")
        if widget is not None:
            self._widgets.put(widget)
        else:
            self._widgets.delete(change["after"]["widget"]["id"])
