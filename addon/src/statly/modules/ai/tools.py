"""The one toolbox for the chat and for external apps."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from jsonschema import Draft202012Validator

from ...core.contract import Contract
from ...core.errors import StatlyError
from ...core.rpc import Router
from ...core.settings import SettingsService
from .changes import ChangeBook
from .providers import ToolDefinition

_MAX_RESULT_CHARS = 40_000
_MASKED_DECK_METHODS = {"statistics.decks", "statistics.deckActivity"}
_FIELDS = {
    "range": ("start", "end", "deckId"),
    "year": ("year", "deckId"),
    "deck": ("deckId",),
    "view": ("view", "deckId"),
}
_ANKI_VIEW_DEFAULTS = {"range": "month", "option": False}
_PROPOSING_TOOLS = {"propose_widget", "propose_dashboard", "propose_settings"}
_DENIED = "The person did not allow this."

type Answer = Callable[[dict[str, Any], bool], None]
type AskPermission = Callable[[str, Callable[[bool], None]], None]


@dataclass
class Session:
    """Who is asking. What a chat may see lasts only as long as that chat."""

    source: str
    granted: set[str] = field(default_factory=set[str])
    trusted: bool = True
    ask: AskPermission | None = None


def _masked(result: Any) -> Any:
    """Without permission a deck is only a number, so deck names stay on this computer."""
    masked: list[Any] = []
    for index, entry in enumerate(result, start=1):
        masked.append({**entry, "name": f"Deck {index}" if entry.get("name") else None})
    return masked


class ToolBox:
    def __init__(
        self,
        contract: Contract,
        router: Router,
        settings: SettingsService,
        changes: ChangeBook,
        permitted: Callable[[str, str], bool],
        may_act_alone: Callable[[str], bool],
        navigate: Callable[[dict[str, str]], None],
    ) -> None:
        self._router = router
        self._settings = settings
        self._changes = changes
        self._permitted = permitted
        self._may_act_alone = may_act_alone
        self._navigate = navigate
        self._tools: dict[str, Any] = contract.ai["tools"]
        self._statistics: dict[str, Any] = contract.ai["statistics"]
        self._pages: dict[str, str] = contract.ai["pages"]
        self._guide: str = contract.ai["widgetGuide"]
        self._setting_keys: list[str] = contract.ai["settingKeys"]
        self._validators = {
            name: Draft202012Validator(tool["input"]) for name, tool in self._tools.items()
        }

    def definitions(self, *, external: bool = False) -> list[ToolDefinition]:
        return [
            ToolDefinition(name, tool["description"], tool["shown"])
            for name, tool in self._tools.items()
            if not (external and tool["access"] == "guide")
        ]

    def reads_cards(self, name: str) -> bool:
        return self._tools.get(name, {}).get("permission") == "cards"

    def problem_with(self, name: str, arguments: Any) -> str | None:
        """Why a call cannot run. Failures go back to the model, which can correct itself."""
        if name not in self._tools:
            return f"Unknown tool: {name}"
        problem = next(self._validators[name].iter_errors(arguments), None)
        return f"Invalid input: {problem.message}"[:500] if problem else None

    def _allowed(self, scope: str, session: Session) -> bool:
        return scope in session.granted or self._permitted(scope, session.source)

    def run(self, name: str, arguments: Any, session: Session, answer: Answer) -> None:
        """Answers exactly once, unless a person is asked first and walks away from the chat."""
        problem = self.problem_with(name, arguments)
        tool = self._tools.get(name)
        if problem is not None or tool is None:
            answer({"error": problem}, True)
            return
        if tool["access"] == "guide" and session.source != "chat":
            answer({"error": f"Unknown tool: {name}"}, True)
            return
        scope = "decks" if self._reads_deck_names(name, arguments) else tool["permission"]
        if scope is None or self._allowed(scope, session):
            self._start(name, tool, arguments, session, answer)
        elif session.ask is None:
            self._without(scope, name, tool, arguments, session, answer)
        else:

            def decided(granted: bool) -> None:
                if granted:
                    self._start(name, tool, arguments, session, answer)
                else:
                    self._without(scope, name, tool, arguments, session, answer)

            session.ask(scope, decided)

    def _reads_deck_names(self, name: str, arguments: Any) -> bool:
        return name == "get_statistic" and arguments["name"] == "decks"

    def _without(
        self, scope: str, name: str, tool: Any, arguments: Any, session: Session, answer: Answer
    ) -> None:
        """Statistics work without deck names. Without permission for cards there is nothing."""
        if scope == "decks":
            self._start(name, tool, arguments, session, answer)
        else:
            answer({"error": _DENIED}, True)

    def _start(
        self, name: str, tool: Any, arguments: Any, session: Session, answer: Answer
    ) -> None:
        if tool["method"] is not None:
            self._read(tool["method"], arguments, session, answer)
        elif name == "get_statistic":
            self._read_statistic(arguments, session, answer)
        elif name == "get_widget_format":
            answer({"format": self._guide}, False)
        elif name == "get_settings":
            current = self._settings.get()
            answer({key: current[key] for key in self._setting_keys}, False)
        elif name == "open_page":
            self._open_page(arguments, answer)
        elif name in _PROPOSING_TOOLS:
            self._propose(name, arguments, session, answer)
        else:
            answer({"error": f"Unknown tool: {name}"}, True)

    def _open_page(self, arguments: Any, answer: Answer) -> None:
        target = {"path": self._pages[arguments["page"]]}
        if "highlight" in arguments:
            target["highlight"] = arguments["highlight"]
        self._navigate(target)
        answer({"status": "opened"}, False)

    def _read_statistic(self, arguments: Any, session: Session, answer: Answer) -> None:
        statistic = self._statistics[arguments["name"]]
        params = {key: arguments.get(key) for key in _FIELDS[statistic["needs"]]}
        missing = [key for key in ("start", "end", "view") if key in params and params[key] is None]
        if "view" in params:
            params |= _ANKI_VIEW_DEFAULTS
        if missing:
            answer({"error": f"{arguments['name']} needs {' and '.join(missing)}."}, True)
        else:
            self._read(statistic["method"], params, session, answer)

    def _read(self, method: str, arguments: Any, session: Session, answer: Answer) -> None:
        def done(result: Any) -> None:
            if method in _MASKED_DECK_METHODS and not self._allowed("decks", session):
                result = _masked(result)
            answer({"result": result}, False)

        self._router.call(method, arguments, done, lambda message: answer({"error": message}, True))

    def _propose(self, name: str, arguments: Any, session: Session, answer: Answer) -> None:
        fields: dict[str, Any] = dict(arguments)
        fields["kind"] = name.removeprefix("propose_")
        try:
            proposal = self._changes.propose(fields, session.source)
            alone = session.trusted and self._may_act_alone(session.source)
            if alone and self._changes.may_apply_alone():
                self._changes.apply(proposal["id"], "auto")
                answer({"status": "applied", "id": proposal["id"]}, False)
            else:
                answer({"status": "waiting_for_user", "id": proposal["id"]}, False)
        except StatlyError as error:
            answer({"error": str(error)}, True)


def encode_result(result: dict[str, Any]) -> str:
    text = json.dumps(result, ensure_ascii=False)
    if len(text) <= _MAX_RESULT_CHARS:
        return text
    return json.dumps({"error": "The result was too large. Ask for a shorter range."})
