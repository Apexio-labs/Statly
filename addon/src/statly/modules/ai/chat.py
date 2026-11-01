"""One conversation: the model talks, tools run, and the web app follows along."""

from __future__ import annotations

import json
import logging
import re
import secrets
import time
from collections.abc import Callable
from datetime import datetime
from threading import Event
from typing import Any

from ...core.module import Host
from .changes import ChangeBook
from .errors import AiError, Stopped
from .history import ChatHistory
from .prompt import TITLE_PROMPT
from .providers import Client, ToolCall, ToolResult, Turn
from .tools import Session, ToolBox, encode_result

logger = logging.getLogger(__name__)

_MAX_TOOL_ROUNDS = 8
_MAX_MESSAGES = 120
_TEXT_INTERVAL_SECONDS = 0.05
_FALLBACK_TITLE_CHARS = 48
_MAX_TITLE_CHARS = 60
_REASONING = re.compile(r"<think>.*?(</think>|$)", re.DOTALL)
_ASK_USER = "ask_user"


class _TextBatch:
    """Models write faster than a page needs updating."""

    def __init__(self, deliver: Callable[[str], None]) -> None:
        self._deliver = deliver
        self._waiting = ""
        self._last = 0.0

    def add(self, text: str) -> None:
        self._waiting += text
        now = time.monotonic()
        if now - self._last >= _TEXT_INTERVAL_SECONDS:
            self._last = now
            self.finish()

    def finish(self) -> None:
        if self._waiting:
            self._deliver(self._waiting)
            self._waiting = ""


def _clean_title(text: str) -> str:
    plain = _REASONING.sub("", text).strip().splitlines()
    return plain[0].strip(" \"'“”.")[:_MAX_TITLE_CHARS] if plain else ""


class Chat:
    def __init__(
        self,
        host: Host,
        connect: Callable[[], Client],
        toolbox: ToolBox,
        changes: ChangeBook,
        history: ChatHistory,
        keep_chats: Callable[[], bool],
        remember_permission: Callable[[str], None],
        review_due: Callable[[str], bool],
    ) -> None:
        self._host = host
        self._connect = connect
        self._toolbox = toolbox
        self._changes = changes
        self._history = history
        self._keep_chats = keep_chats
        self._remember_permission = remember_permission
        self._review_due = review_due
        self._client: Client | None = None
        self._provider: str | None = None
        self._chat_id: str | None = None
        self._title = ""
        self._named = False
        self._native: list[dict[str, Any]] = []
        self._messages: list[dict[str, Any]] = []
        self._session = Session("chat")
        self._waiting: dict[str, Any] | None = None
        self._resume: Callable[[Any], None] | None = None
        self._ask_review = False
        self._error: dict[str, str] | None = None
        self._cancel = Event()
        self._running = False
        self._streaming = False
        self._rounds = 0
        self._run = 0

    def conversation(self) -> dict[str, Any]:
        wanted = {identifier for item in self._messages for identifier in item["proposals"]}
        shown = [
            item
            for item in self._changes.proposals()
            if item["id"] in wanted or item["status"] == "pending"
        ]
        return {
            "chatId": self._chat_id,
            "title": self._title,
            "running": self._running,
            "waiting": self._waiting,
            "messages": self._messages,
            "proposals": shown,
            "askReview": self._ask_review,
            "error": self._error,
        }

    def _changed(self) -> None:
        self._host.emit("ai.changed", {})

    def _new_message(self, role: str, text: str) -> dict[str, Any]:
        message: dict[str, Any] = {
            "id": secrets.token_hex(6),
            "role": role,
            "text": text,
            "tools": [],
            "proposals": [],
            "notice": None,
        }
        self._messages.append(message)
        return message

    def _plain_history(self) -> list[dict[str, Any]]:
        """Services store histories differently, so a chat moves over as plain text."""
        return [
            {"role": item["role"], "content": item["text"]}
            for item in self._messages
            if item["text"]
        ]

    def send(self, text: str) -> None:
        if self._waiting is not None and self._waiting["kind"] == "question":
            self.answer_question(text)
            return
        if self._running:
            return
        self._error = None
        self._ask_review = False
        try:
            if len(self._native) >= _MAX_MESSAGES:
                raise AiError("chat_too_long")
            client = self._connect()
        except AiError as error:
            self._fail(error)
            return
        self._client = client
        if self._provider not in (None, client.provider):
            self._native = self._plain_history()
        self._provider = client.provider
        if self._chat_id is None:
            self._chat_id = secrets.token_hex(8)
            self._title = text[:_FALLBACK_TITLE_CHARS]
        self._new_message("user", text)
        self._native.append(client.user_message(text))
        self._running = True
        self._rounds = 0
        self._cancel = Event()
        self._run += 1
        self._changed()
        self._next_turn(self._new_message("assistant", ""))

    def _next_turn(self, message: dict[str, Any]) -> None:
        client, cancel, run = self._require_client(), self._cancel, self._run
        messages = list(self._native)
        tools = self._toolbox.definitions()

        def deliver(delta: str) -> None:
            def show() -> None:
                if run == self._run:
                    message["text"] += delta
                    self._host.emit("ai.text", {"messageId": message["id"], "delta": delta})

            self._host.run_on_main(show)

        batch = _TextBatch(deliver)
        self._streaming = True

        def work() -> Turn:
            turn = client.complete(messages, tools, batch.add, cancel)
            batch.finish()
            return turn

        self._host.run_task(
            work,
            lambda turn: self._turn_done(run, message, turn),
            lambda error: self._turn_failed(run, message, error),
        )

    def _turn_failed(self, run: int, message: dict[str, Any], error: Exception) -> None:
        if run != self._run:
            return
        self._streaming = False
        if isinstance(error, Stopped):
            message["notice"] = "stopped"
            self._finish()
        elif isinstance(error, AiError):
            self._fail(error)
        else:
            logger.warning("Statly's chat failed: %s", type(error).__name__)
            self._fail(AiError("bad_response"))

    def _fail(self, error: AiError) -> None:
        self._error = {"code": error.code, "detail": error.detail}
        self._finish()

    def _finish(self) -> None:
        client = self._client
        self._running = False
        self._waiting = None
        self._resume = None
        # The key stays in memory only as long as an answer needs it.
        self._client = None
        if (
            self._messages
            and not self._messages[-1]["text"]
            and not self._notable(self._messages[-1])
        ):
            self._messages.pop()
        answered = self._error is None and self._messages[-1:] != []
        if answered and self._messages[-1]["role"] == "assistant":
            if self._provider and self._review_due(self._provider):
                self._ask_review = True
            if client is not None and not self._named:
                self._name_chat(client)
        self._persist()
        self._changed()

    def _name_chat(self, client: Client) -> None:
        """Runs beside the conversation: a name is nice to have, never worth a failure."""
        self._named = True
        first = [{"role": "user", "content": self._messages[0]["text"]}]
        chat_id = self._chat_id

        def named(turn: Turn) -> None:
            title = _clean_title(turn.text)
            if title and chat_id == self._chat_id:
                self._title = title
                self._persist()
                self._changed()

        def failed(error: Exception) -> None:
            logger.info("Statly could not name a chat: %s", type(error).__name__)

        self._host.run_task(
            lambda: client.complete(first, [], lambda _text: None, Event(), TITLE_PROMPT),
            named,
            failed,
        )

    def _persist(self) -> None:
        if self._chat_id is None or not self._messages or not self._keep_chats():
            return
        self._history.put(
            {
                "id": self._chat_id,
                "title": self._title,
                "updatedAt": datetime.now().isoformat(timespec="seconds"),
                "provider": self._provider,
                "messages": self._messages,
                "native": self._native,
            }
        )

    def _notable(self, message: dict[str, Any]) -> bool:
        return bool(
            message["role"] == "user"
            or message["tools"]
            or message["proposals"]
            or message["notice"]
        )

    def _turn_done(self, run: int, message: dict[str, Any], turn: Turn) -> None:
        if run != self._run:
            return
        self._streaming = False
        if turn.stop == "refusal":
            message["notice"] = "refused"
            self._finish()
            return
        if turn.stop == "length":
            message["notice"] = "length"
            if turn.text:
                self._native.append(turn.message)
            self._finish()
            return
        # A service rejects an empty message, and one would block every later question.
        if turn.text or turn.calls:
            self._native.append(turn.message)
        if turn.stop != "tool":
            self._finish()
            return
        self._rounds += 1
        if self._rounds > _MAX_TOOL_ROUNDS:
            message["notice"] = "steps"
            # The model asked for tools, so it has to hear why they did not run.
            results = [
                ToolResult(call, '{"error": "Too many steps."}', True) for call in turn.calls
            ]
            self._native.extend(self._require_client().tool_results(results))
            self._finish()
            return
        self._run_tools(run, message, turn.calls, [])

    def _require_client(self) -> Client:
        assert self._client is not None
        return self._client

    def _run_tools(
        self,
        run: int,
        message: dict[str, Any],
        calls: list[ToolCall],
        results: list[ToolResult],
    ) -> None:
        if run != self._run:
            return
        if self._cancel.is_set():
            message["notice"] = "stopped"
            stopped = [
                ToolResult(call, '{"error": "Stopped by the user."}', True)
                for call in calls[len(results) :]
            ]
            self._native.extend(self._require_client().tool_results([*results, *stopped]))
            self._finish()
            return
        if len(results) == len(calls):
            self._native.extend(self._require_client().tool_results(results))
            self._changed()
            self._next_turn(message)
            return
        call = calls[len(results)]

        def go_on(result: dict[str, Any], failed: bool) -> None:
            done = ToolResult(call, encode_result(result), failed)
            self._run_tools(run, message, calls, [*results, done])

        message["tools"].append(call.name)
        self._changed()
        try:
            arguments = json.loads(call.arguments or "{}")
        except ValueError:
            go_on({"INVALID_JSON": call.arguments[:2000]}, True)
            return
        if call.name == _ASK_USER and self._toolbox.problem_with(call.name, arguments) is None:
            self._ask_question(arguments, go_on)
            return
        self._session.ask = lambda scope, decided: self._ask_permission(run, scope, decided)

        def answered(result: dict[str, Any], failed: bool) -> None:
            if self._toolbox.reads_cards(call.name) and not failed:
                # Card text can carry orders, so nothing may apply by itself from here on.
                self._session.trusted = False
            if "status" in result and "id" in result:
                message["proposals"].append(result["id"])
            go_on(result, failed)

        self._toolbox.run(call.name, arguments, self._session, answered)

    def _ask_question(self, arguments: Any, go_on: Callable[[dict[str, Any], bool], None]) -> None:
        self._waiting = {
            "kind": "question",
            "question": arguments["question"],
            "options": arguments["options"],
        }
        self._resume = lambda text: go_on({"answer": text}, False)
        self._changed()

    def _ask_permission(self, run: int, scope: str, decided: Callable[[bool], None]) -> None:
        self._waiting = {"kind": "permission", "scope": scope}

        def resume(granted: bool) -> None:
            if run == self._run:
                decided(granted)

        self._resume = resume
        self._changed()

    def _take_resume(self) -> Callable[[Any], None] | None:
        resume, self._resume, self._waiting = self._resume, None, None
        return resume

    def answer_permission(self, decision: str) -> None:
        if self._waiting is None or self._waiting["kind"] != "permission":
            return
        scope = self._waiting["scope"]
        if decision == "always":
            self._remember_permission(scope)
        if decision != "deny":
            self._session.granted.add(scope)
        resume = self._take_resume()
        self._changed()
        if resume:
            resume(decision != "deny")

    def answer_question(self, text: str) -> None:
        if self._waiting is None or self._waiting["kind"] != "question":
            return
        resume = self._take_resume()
        # The bubble goes before the answer that is being written, which reads in the right order.
        self._messages.insert(len(self._messages) - 1, self._as_message("user", text))
        self._changed()
        if resume:
            resume(text)

    def _as_message(self, role: str, text: str) -> dict[str, Any]:
        message = self._new_message(role, text)
        self._messages.remove(message)
        return message

    def stop(self) -> None:
        """A silent service must not hold the user up, so the answer ends right here."""
        self._cancel.set()
        if self._running and self._streaming:
            self._run += 1
            self._streaming = False
            self._messages[-1]["notice"] = "stopped"
            self._finish()
        elif self._waiting is not None:
            resume = self._take_resume()
            if resume:
                resume(False)

    def reset(self) -> None:
        self._cancel.set()
        self._run += 1
        self._running = False
        self._streaming = False
        self._client = None
        self._provider = None
        self._chat_id = None
        self._title = ""
        self._named = False
        self._native = []
        self._messages = []
        self._session = Session("chat")
        self._waiting = None
        self._resume = None
        self._ask_review = False
        self._error = None
        self._changed()

    def open_chat(self, chat_id: str) -> None:
        stored = self._history.read(chat_id)
        if stored is None:
            return
        self.reset()
        self._chat_id = stored["id"]
        self._title = stored["title"]
        self._named = True
        self._provider = stored.get("provider")
        self._messages = stored["messages"]
        self._native = stored["native"]
        # Card text stays in the history, so reopening must not make the chat trusted again.
        self._session.trusted = not any(
            self._toolbox.reads_cards(tool)
            for message in self._messages
            for tool in message["tools"]
        )
        self._changed()

    def revoke(self, scope: str) -> None:
        """Taking a permission back counts from now on, also in the chat that was given it."""
        self._session.granted.discard(scope)

    def forget(self, chat_id: str) -> None:
        self._history.delete(chat_id)
        if chat_id == self._chat_id:
            self.reset()
