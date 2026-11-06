"""The assistant: what it may reach, where keys live, and what a model can make it do."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from collections.abc import Iterator, Sequence
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event
from typing import Any

import pytest
from anki.collection import Collection

from statly.core.contract import Contract
from statly.core.errors import InvalidParams, NotAllowed
from statly.core.permissions import Permissions
from statly.core.reader import CollectionReader
from statly.core.rpc import Router
from statly.core.settings import SettingsService
from statly.core.storage import JsonStore
from statly.host.keychain import MacKeychain, SessionSecrets
from statly.modules import ai
from statly.modules.ai import Assistant
from statly.modules.ai.cards import plain_text
from statly.modules.ai.changes import ChangeBook
from statly.modules.ai.chat import Chat
from statly.modules.ai.errors import AiError, scrub
from statly.modules.ai.history import ChatHistory
from statly.modules.ai.local_api import hash_code
from statly.modules.ai.providers import (
    AnthropicClient,
    Client,
    Connection,
    Model,
    OpenAiCompatibleClient,
    ToolCall,
    ToolDefinition,
    ToolResult,
    Turn,
    check_base_url,
)
from statly.modules.ai.tools import Session
from statly.modules.changes import phone_card as writer
from statly.modules.dashboard import DashboardService
from statly.modules.permissions import PermissionService
from statly.modules.widgets.storage import WidgetStore, size_rules
from test_rpc import FakeRuntime, call, error_code, make_router

KEY = "sk-test-0123456789abcdef"
TOOL = ToolDefinition("get_today", "Today", {"type": "object", "properties": {}})


def build(lines: list[str]) -> bytes:
    return "".join(f"data: {line}\n\n" for line in lines).encode()


class Service:
    """A local stand-in for an AI service that records what it was sent."""

    def __init__(self, status: int = 200, body: bytes = b"", headers: dict[str, str] | None = None):
        self.requests: list[dict[str, Any]] = []
        self.status = status
        self.body = body
        service = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                pass

            def _answer(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                service.requests.append(
                    {"path": self.path, "headers": dict(self.headers), "body": json.loads(raw)}
                )
                self.send_response(service.status)
                for name, value in (headers or {}).items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(service.body)))
                self.end_headers()
                self.wfile.write(service.body)

            do_GET = do_POST = _answer

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def service() -> Iterator[Service]:
    running = Service()
    yield running
    running.close()


def connection(url: str, provider: str = "anthropic", model: str = "claude-opus-5-5") -> Connection:
    return Connection(provider, url, model, KEY, False)


def run(client: Client) -> tuple[Turn, list[str]]:
    seen: list[str] = []
    turn = client.complete([client.user_message("Hi")], [TOOL], seen.append, Event())
    return turn, seen


ANTHROPIC_STREAM = [
    '{"type":"message_start","message":{"id":"m"}}',
    '{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
    '{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hm"}}',
    '{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"s1"}}',
    '{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
    '{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hel"}}',
    '{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"lo"}}',
    '{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"t1",'
    '"name":"get_today","input":{}}}',
    '{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta",'
    '"partial_json":"{\\"a\\":"}}',
    '{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta",'
    '"partial_json":"1}"}}',
    '{"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
    '{"type":"message_stop"}',
]


def test_anthropic_request_and_stream(service: Service) -> None:
    service.body = build(ANTHROPIC_STREAM)
    turn, seen = run(AnthropicClient(connection(service.url)))

    sent = service.requests[0]
    assert sent["path"] == "/messages"
    assert sent["headers"]["x-api-key"] == KEY
    assert sent["headers"]["anthropic-version"] == "2026-10-21"
    assert sent["headers"]["anthropic-beta"] == "server-side-fallback-2026-07-01"
    assert sent["body"]["fallbacks"] == "default"
    assert sent["body"]["stream"] is True
    assert sent["body"]["tools"][0]["eager_input_streaming"] is True
    assert sent["body"]["output_config"] == {"effort": "medium"}
    assert "temperature" not in sent["body"]

    assert seen == ["Hel", "lo"]
    assert turn.text == "Hello"
    assert turn.stop == "tool"
    assert turn.calls == [ToolCall("t1", "get_today", '{"a":1}')]
    thinking, _text, tool = turn.message["content"]
    assert thinking == {"type": "thinking", "thinking": "Hm", "signature": "s1"}
    assert tool["input"] == {"a": 1}


def test_older_claude_models_get_no_new_parameters(service: Service) -> None:
    service.body = build(['{"type":"message_delta","delta":{"stop_reason":"end_turn"}}'])
    run(AnthropicClient(connection(service.url, model="claude-haiku-4-5")))
    sent = service.requests[0]
    assert "anthropic-beta" not in sent["headers"]
    assert "fallbacks" not in sent["body"]
    assert "output_config" not in sent["body"]


def test_a_refusal_never_runs_tools(service: Service) -> None:
    lines = [*ANTHROPIC_STREAM[:-2], '{"type":"message_delta","delta":{"stop_reason":"refusal"}}']
    service.body = build(lines)
    turn, _seen = run(AnthropicClient(connection(service.url)))
    assert turn.stop == "refusal"
    assert turn.calls == []


def test_a_cut_off_answer_never_runs_tools(service: Service) -> None:
    lines = [
        *ANTHROPIC_STREAM[:-2],
        '{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}',
    ]
    service.body = build(lines)
    turn, _seen = run(AnthropicClient(connection(service.url)))
    assert turn.stop == "length"
    assert turn.calls == []


def test_blocks_before_a_model_switch_are_left_out_of_the_replay(service: Service) -> None:
    service.body = build(
        [
            '{"type":"content_block_start","index":0,"content_block":{"type":"thinking",'
            '"thinking":"x","signature":"s"}}',
            '{"type":"content_block_start","index":1,"content_block":{"type":"text","text":"a"}}',
            '{"type":"content_block_start","index":2,"content_block":{"type":"fallback"}}',
            '{"type":"content_block_start","index":3,"content_block":{"type":"text","text":"b"}}',
            '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
        ]
    )
    turn, _seen = run(AnthropicClient(connection(service.url)))
    assert [block["type"] for block in turn.message["content"]] == ["text", "fallback", "text"]


def test_openai_compatible_stream_joins_tool_fragments(service: Service) -> None:
    service.body = build(
        [
            '{"choices":[{"delta":{"content":"Ok"}}]}',
            '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":'
            '{"name":"get_today","arguments":"{\\"a\\""}}]}}]}',
            '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}]}}]}',
            '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
            "[DONE]",
        ]
    )
    client = OpenAiCompatibleClient(Connection("lmstudio", service.url, "m", None, True))
    turn, seen = run(client)

    assert "authorization" not in {name.lower() for name in service.requests[0]["headers"]}
    assert service.requests[0]["body"]["messages"][0]["role"] == "system"
    assert seen == ["Ok"]
    assert turn.stop == "tool"
    assert turn.calls == [ToolCall("c1", "get_today", '{"a":1}')]
    assert turn.message["tool_calls"][0]["function"]["arguments"] == '{"a":1}'


def test_openai_uses_its_newer_token_limit(service: Service) -> None:
    service.body = build(['{"choices":[{"delta":{},"finish_reason":"stop"}]}'])
    run(OpenAiCompatibleClient(connection(service.url, "openai", "gpt")))
    assert "max_completion_tokens" in service.requests[0]["body"]
    assert "max_tokens" not in service.requests[0]["body"]


@pytest.mark.parametrize(
    ("status", "text", "code"),
    [
        (401, "no", "key_invalid"),
        (403, "no", "no_access"),
        (404, "no", "model_missing"),
        (429, "slow", "rate_limited"),
        (400, "this model does not support tools", "no_tool_support"),
        (400, "other", "bad_request"),
        (529, "busy", "provider_down"),
    ],
)
def test_service_errors_become_clear_codes(
    service: Service, status: int, text: str, code: str
) -> None:
    service.status, service.body = status, text.encode()
    with pytest.raises(AiError) as caught:
        run(AnthropicClient(connection(service.url)))
    assert caught.value.code == code


def test_a_key_repeated_by_a_service_never_surfaces(service: Service) -> None:
    service.status, service.body = 400, f"bad key {KEY} sk-other-987654321".encode()
    with pytest.raises(AiError) as caught:
        run(AnthropicClient(connection(service.url)))
    assert KEY not in caught.value.detail
    assert "sk-other" not in caught.value.detail
    assert scrub("plain", None) == "plain"


def test_a_redirect_cannot_carry_the_key_away() -> None:
    target = Service()
    redirect = Service(302, b"", {"Location": f"{target.url}/stolen"})
    with pytest.raises(AiError):
        run(AnthropicClient(connection(redirect.url)))
    assert target.requests == []
    target.close()
    redirect.close()


def test_a_service_that_is_down_is_reported() -> None:
    with pytest.raises(AiError) as caught:
        run(AnthropicClient(connection("http://127.0.0.1:9")))
    assert caught.value.code == "unreachable"


def test_a_connection_never_prints_its_key() -> None:
    assert KEY not in repr(connection("https://x.example"))


@pytest.mark.parametrize(
    ("url", "local_only"),
    [
        ("http://example.com/v1", False),
        ("https://user:secret@example.com", False),
        ("https://example.com/v1?key=1", False),
        ("ftp://example.com", False),
        ("https://example.com", True),
        ("http://192.168.1.5:1234/v1", True),
        ("", False),
    ],
)
def test_unsafe_addresses_are_refused(url: str, local_only: bool) -> None:
    with pytest.raises(AiError):
        check_base_url(url, local_only=local_only)


@pytest.mark.parametrize(
    ("url", "local_only"),
    [
        ("https://example.com/v1/", False),
        ("http://127.0.0.1:1234/v1", True),
        ("http://localhost:11434/v1", True),
    ],
)
def test_safe_addresses_pass(url: str, local_only: bool) -> None:
    assert check_base_url(url, local_only=local_only) == url.rstrip("/")


class ScriptedClient:
    """A model that says what a test wants."""

    provider = "lmstudio"

    def __init__(self, turns: list[Turn | Exception]) -> None:
        self.turns = turns
        self.seen: list[list[dict[str, Any]]] = []

    def models(self) -> list[Model]:
        return []

    def complete(
        self,
        messages: Sequence[dict[str, Any]],
        tools: Sequence[ToolDefinition],
        on_text: Any,
        cancelled: Event,
        system: str = "",
    ) -> Turn:
        if tools:
            self.seen.append(list(messages))
        turn = self.turns.pop(0)
        if isinstance(turn, Exception):
            raise turn
        if turn.text:
            on_text(turn.text)
        return turn

    def user_message(self, text: str) -> dict[str, Any]:
        return {"role": "user", "content": text}

    def tool_results(self, results: Sequence[ToolResult]) -> list[dict[str, Any]]:
        return [
            {"role": "tool", "id": item.call.id, "content": item.content, "failed": item.failed}
            for item in results
        ]


def said(text: str) -> Turn:
    return Turn(text=text, message={"role": "assistant", "content": text})


def wants(name: str, arguments: Any, call_id: str = "c1") -> Turn:
    return Turn(
        calls=[ToolCall(call_id, name, json.dumps(arguments))],
        stop="tool",
        message={"role": "assistant", "content": [name]},
    )


def _raise(error: Exception) -> None:
    raise error


class Setup:
    def __init__(self, collection: Collection | None = None) -> None:
        self.runtime = FakeRuntime(collection)
        # Statly's dialog stays unanswered unless a test answers it, which counts as a no.
        self.runtime.default_answer = None
        self.router: Router = make_router(self.runtime)
        self.assistant: Assistant = self._assistant()
        self.chat: Chat = self.assistant.chat

    def allow(self, scope: str, allowed: bool = True) -> None:
        """The settings switch: on asks in Statly's own dialog, answered with yes here."""
        if allowed:
            self.runtime.permission_answers.append("always")
        self.assistant.set_permission(
            {"scope": scope, "allowed": allowed}, lambda _status: None, _raise
        )

    def allow_external(self) -> None:
        self.runtime.permission_answers.append("always")
        self.assistant.set_external_permissions({"allowed": True}, lambda _status: None, _raise)

    def _assistant(self) -> Assistant:
        settings = SettingsService(JsonStore(self.runtime.data_folder), self.router.contract)
        rules = self.router.contract.permissions["rules"]
        self.permissions = PermissionService(
            self.runtime,
            Permissions(JsonStore(self.runtime.data_folder), rules),
            rules,
            lambda: "en",
        )
        store = WidgetStore(
            self.runtime.data_folder,
            self.router.contract,
            self.runtime.media_folder,
            self.runtime.media_url,
        )
        dashboard = DashboardService(
            JsonStore(self.runtime.data_folder), self.router.contract, settings
        )
        dashboard.add_source(
            "custom:", lambda: {item["id"]: size_rules(item) for item in store.list()}
        )
        context: Any = type(
            "Ctx",
            (),
            {
                "host": self.runtime,
                "contract": self.router.contract,
                "settings": settings,
                "router": self.router,
                "services": {
                    "widgets": store,
                    "dashboard": dashboard,
                    "permissions": self.permissions,
                },
            },
        )()
        return Assistant(context)

    def script(self, *turns: Turn | Exception) -> ScriptedClient:
        client = ScriptedClient(list(turns))
        self.assistant.chat._connect = lambda: client
        return client

    def drain(self) -> None:
        while self.runtime.pending:
            self.runtime.pending.pop(0)()


@pytest.fixture
def setup(collection: Collection) -> Setup:
    return Setup(collection)


def layout_with(*kinds: str) -> dict[str, Any]:
    return {
        "widgets": [
            {"id": kind, "type": kind, "x": 0, "y": index * 4, "w": 3, "h": 4}
            for index, kind in enumerate(kinds)
        ]
    }


def small_widget(identifier: str = "mine") -> dict[str, Any]:
    return {
        "id": identifier,
        "name": "Mine",
        "description": "",
        "size": {"w": 4, "h": 6},
        "background": {"kind": "card"},
        "elements": [],
    }


def test_a_tool_round_feeds_real_statistics_back(setup: Setup) -> None:
    client = setup.script(wants("get_today", {}), said("Done"))
    setup.chat.send("How much?")
    setup.drain()
    conversation = setup.chat.conversation()
    assert conversation["running"] is False
    assert [item["role"] for item in conversation["messages"]] == ["user", "assistant"]
    assert conversation["messages"][1]["text"] == "Done"
    assert conversation["messages"][1]["tools"] == ["get_today"]
    result = client.seen[1][-1]
    assert result["role"] == "tool"
    assert "date" in json.loads(result["content"])["result"]


def test_several_calls_of_a_turn_are_all_answered(setup: Setup) -> None:
    both = Turn(
        calls=[ToolCall("a", "get_settings", "{}"), ToolCall("b", "get_today", "{}")],
        stop="tool",
        message={"role": "assistant", "content": []},
    )
    client = setup.script(both, said("Done"))
    setup.chat.send("Go")
    setup.drain()
    assert [item["id"] for item in client.seen[1][-2:]] == ["a", "b"]


def test_a_model_cannot_loop_forever(setup: Setup) -> None:
    turns: list[Turn | Exception] = [wants("get_today", {}) for _ in range(30)]
    client = setup.script(*turns)
    setup.chat.send("Loop")
    setup.drain()
    message = setup.chat.conversation()["messages"][-1]
    assert message["notice"] == "steps"
    assert len(client.seen) == 9


def test_invalid_tool_input_goes_back_to_the_model(setup: Setup) -> None:
    broken = Turn(
        calls=[ToolCall("c", "get_today", '{"a":')],
        stop="tool",
        message={"role": "assistant", "content": []},
    )
    client = setup.script(broken, said("Sorry"))
    setup.chat.send("Go")
    setup.drain()
    last = client.seen[1][-1]
    assert last["failed"] is True
    assert "INVALID_JSON" in last["content"]


def test_a_refusal_is_shown_as_such(setup: Setup) -> None:
    setup.script(Turn(stop="refusal"))
    setup.chat.send("Go")
    assert setup.chat.conversation()["messages"][-1]["notice"] == "refused"


def test_failures_end_the_answer_with_their_code(setup: Setup) -> None:
    setup.script(AiError("rate_limited", "later"))
    setup.chat.send("Go")
    conversation = setup.chat.conversation()
    assert conversation["running"] is False
    assert conversation["error"] == {"code": "rate_limited", "detail": "later"}
    assert [item["role"] for item in conversation["messages"]] == ["user"]


def test_an_unconfigured_chat_explains_itself(setup: Setup) -> None:
    setup.chat.send("Go")
    assert setup.chat.conversation()["error"]["code"] == "not_configured"
    assert setup.chat.conversation()["messages"] == []


def test_a_new_chat_forgets_everything(setup: Setup) -> None:
    setup.script(said("Hi"))
    setup.chat.send("Go")
    setup.chat.reset()
    assert setup.chat.conversation()["messages"] == []


def test_stop_ends_at_once_even_if_the_service_stays_silent(setup: Setup) -> None:
    setup.script(said("Late"))
    finished: list[Any] = []
    setup.runtime.run_task = lambda work, done, failed: finished.append((work, done))
    setup.chat.send("Go")
    setup.chat.stop()
    conversation = setup.chat.conversation()
    assert conversation["running"] is False
    assert conversation["messages"][-1]["notice"] == "stopped"

    work, done = finished[0]
    done(work())
    assert "Late" not in json.dumps(setup.chat.conversation())


def test_stopping_during_tools_leaves_a_valid_history(setup: Setup) -> None:
    client = setup.script(wants("get_today", {}), said("Hi"))
    setup.chat.send("Go")
    setup.chat.stop()
    setup.drain()
    last = client.seen[0]
    assert setup.chat.conversation()["messages"][-1]["notice"] == "stopped"
    assert len(setup.chat._native) == 3
    assert setup.chat._native[-1]["role"] == "tool"
    assert last[-1]["role"] == "user"


def test_an_empty_answer_stays_out_of_the_history(setup: Setup) -> None:
    client = setup.script(Turn(message={"role": "assistant", "content": []}), said("Hi"))
    setup.chat.send("One")
    setup.chat.send("Two")
    assert all(item["role"] == "user" for item in client.seen[1])


def test_changing_the_service_starts_a_new_chat(setup: Setup) -> None:
    configured(setup, "openai")
    setup.script(said("Hi"))
    setup.chat.send("Go")
    configured(setup, "openai")
    assert setup.chat.conversation()["messages"] != []
    configured(setup, "anthropic")
    assert setup.chat.conversation()["messages"] == []


def test_what_the_app_reads_matches_the_contract(setup: Setup) -> None:
    contract = setup.router.contract
    changes = setup.assistant.changes
    first, _failed = propose(
        setup, "propose_settings", {"patch": {"theme": "dark"}, "summary": "Dark"}
    )
    propose(
        setup,
        "propose_widget",
        {"widget": small_widget(), "addToDashboard": True, "summary": "New"},
    )
    propose(setup, "propose_dashboard", {"layout": layout_with("due-cards"), "summary": "One"})
    changes.apply(first["id"])
    setup.script(said("Hi"))
    setup.chat.send("Go")
    contract.check_result("ai.conversation", setup.chat.conversation())
    contract.check_result("ai.changes", changes.visible_changes())
    contract.check_result("ai.status", setup.assistant.status())


def test_uninstalling_removes_every_stored_key(setup: Setup) -> None:
    configured(setup, "openai")
    setup.assistant.set_key({"key": KEY})
    configured(setup, "anthropic")
    setup.assistant.set_key({"key": KEY})
    setup.assistant.uninstall()
    assert setup.runtime.secret_store.get("profile:openai") is None
    assert setup.runtime.secret_store.get("profile:anthropic") is None
    assert setup.assistant.status()["hasKey"] is False


def test_text_reaches_the_page_while_it_is_written(setup: Setup) -> None:
    setup.script(said("Hello"))
    setup.chat.send("Go")
    deltas = [payload["delta"] for event, payload in setup.runtime.emitted if event == "ai.text"]
    assert "".join(deltas) == "Hello"


def propose(setup: Setup, name: str, arguments: Any, source: str = "chat") -> Any:
    answers: list[Any] = []

    def answer(result: dict[str, Any], failed: bool) -> None:
        answers.append((result, failed))

    setup.assistant.toolbox.run(name, arguments, Session(source), answer)
    setup.drain()
    return answers[0]


def test_suggestions_wait_for_a_person(setup: Setup) -> None:
    before = setup.assistant.changes._dashboard.get()
    result, failed = propose(
        setup,
        "propose_dashboard",
        {"layout": layout_with("due-cards"), "summary": "Fewer widgets"},
    )
    assert failed is False
    assert result["status"] == "waiting_for_user"
    assert setup.assistant.changes._dashboard.get() == before
    assert setup.chat.conversation()["proposals"][0]["summary"] == "Fewer widgets"


def test_applying_and_undoing_a_dashboard(setup: Setup) -> None:
    changes = setup.assistant.changes
    before = changes._dashboard.get()
    result, _failed = propose(
        setup, "propose_dashboard", {"layout": layout_with("due-cards"), "summary": "One"}
    )
    changes.apply(result["id"])
    assert [item["type"] for item in changes._dashboard.get()["widgets"]] == ["due-cards"]

    visible = changes.visible_changes()
    assert visible[0]["mode"] == "approved"
    assert "before" not in visible[0]
    changes.rollback(visible[0]["id"])
    assert changes._dashboard.get() == before
    with pytest.raises(InvalidParams):
        changes.rollback(visible[0]["id"])


def test_applying_and_undoing_settings(setup: Setup) -> None:
    changes = setup.assistant.changes
    result, _failed = propose(
        setup, "propose_settings", {"patch": {"theme": "dark"}, "summary": "Dark"}
    )
    changes.apply(result["id"])
    assert changes._settings.get()["theme"] == "dark"
    changes.rollback(changes.visible_changes()[0]["id"])
    assert changes._settings.get()["theme"] == "system"


def test_a_new_widget_lands_on_the_dashboard_and_can_be_undone(setup: Setup) -> None:
    changes = setup.assistant.changes
    before = changes._dashboard.get()
    result, _failed = propose(
        setup,
        "propose_widget",
        {"widget": small_widget(), "addToDashboard": True, "summary": "New"},
    )
    changes.apply(result["id"])
    placed = changes._dashboard.get()["widgets"][-1]
    assert placed["type"] == "custom:mine"
    assert placed["y"] >= max(item["y"] + item["h"] for item in before["widgets"])

    changes.rollback(changes.visible_changes()[0]["id"])
    assert changes._dashboard.get() == before
    assert changes._widgets.get("mine") is None


def test_changing_a_widget_can_be_undone(setup: Setup) -> None:
    changes = setup.assistant.changes
    widgets: Any = changes._widgets
    widgets.put(small_widget())
    changed = {**small_widget(), "name": "Renamed"}
    result, _failed = propose(
        setup, "propose_widget", {"widget": changed, "addToDashboard": False, "summary": "Name"}
    )
    changes.apply(result["id"])
    changes.rollback(changes.visible_changes()[0]["id"])
    assert widgets.get("mine")["name"] == "Mine"


def test_a_rejected_suggestion_cannot_be_applied(setup: Setup) -> None:
    changes = setup.assistant.changes
    result, _failed = propose(
        setup, "propose_settings", {"patch": {"theme": "dark"}, "summary": "Dark"}
    )
    changes.reject(result["id"])
    with pytest.raises(InvalidParams):
        changes.apply(result["id"])


def test_a_broken_layout_goes_back_to_the_model(setup: Setup) -> None:
    result, failed = propose(
        setup,
        "propose_dashboard",
        {"layout": layout_with("no-such-widget"), "summary": "Broken"},
    )
    assert failed is True
    assert "unknown" in result["error"]


@pytest.mark.parametrize(
    "patch",
    [
        {"mobileSync": True},
        {"onboardingDone": True},
        {"shortcuts": {}},
        {"aiPanelWidth": 400},
        {"autoMode": True},
        {"apiKey": "x"},
    ],
)
def test_forbidden_settings_stop_at_the_tool(setup: Setup, patch: dict[str, Any]) -> None:
    result, failed = propose(setup, "propose_settings", {"patch": patch, "summary": "Sneak"})
    assert failed is True
    assert "Invalid input" in result["error"]
    assert setup.assistant.changes.proposals() == []


def test_forbidden_settings_stop_again_at_the_book(setup: Setup) -> None:
    with pytest.raises(NotAllowed):
        setup.assistant.changes.propose(
            {"kind": "settings", "patch": {"mobileSync": True}, "summary": "Sneak"}, "chat"
        )


def test_automatic_mode_needs_the_warning_confirmed(setup: Setup) -> None:
    with pytest.raises(NotAllowed):
        setup.assistant.set_auto_mode({"enabled": True, "acknowledged": False})
    assert setup.assistant.status()["autoMode"] is False


def test_automatic_mode_is_off_by_default_and_applies_when_on(setup: Setup) -> None:
    changes = setup.assistant.changes
    arguments = {"patch": {"theme": "dark"}, "summary": "Dark"}
    assert propose(setup, "propose_settings", arguments)[0]["status"] == "waiting_for_user"
    setup.assistant.set_auto_mode({"enabled": True, "acknowledged": True})
    assert propose(setup, "propose_settings", arguments)[0]["status"] == "applied"
    assert changes._settings.get()["theme"] == "dark"
    assert changes.visible_changes()[0]["mode"] == "auto"
    changes.rollback(changes.visible_changes()[0]["id"])
    assert changes._settings.get()["theme"] == "system"


def test_external_apps_need_their_own_switch(setup: Setup) -> None:
    arguments = {"patch": {"theme": "dark"}, "summary": "Dark"}
    setup.assistant.set_auto_mode({"enabled": True, "acknowledged": True})
    assert propose(setup, "propose_settings", arguments, "external")[0]["status"] == (
        "waiting_for_user"
    )
    setup.assistant.set_auto_external({"enabled": True, "acknowledged": True})
    assert propose(setup, "propose_settings", arguments, "external")[0]["status"] == "applied"


def test_automatic_mode_cannot_run_away(tmp_path: Path) -> None:
    runtime = FakeRuntime()
    contract = Contract()
    settings = SettingsService(JsonStore(lambda: tmp_path), contract)
    moment = [0.0]
    book = ChangeBook(
        JsonStore(lambda: tmp_path),
        contract,
        settings,
        DashboardService(JsonStore(lambda: tmp_path), contract, settings),
        WidgetStore(lambda: tmp_path, contract, runtime.media_folder, runtime.media_url),
        lambda: moment[0],
        lambda: None,
    )
    assert [book.may_apply_alone() for _ in range(7)].count(True) == 5
    moment[0] = 61.0
    assert book.may_apply_alone() is True


def test_tools_exist_only_for_the_contract_and_reach_nothing_else() -> None:
    tools = Contract().ai["tools"]
    allowed = ("statistics.", "dashboard.get", "widgets.list", "cards.", "goals.overview")
    for name, tool in tools.items():
        if tool["method"] is not None:
            assert tool["method"].startswith(allowed), name
            assert tool["access"] == "read"
    for name, statistic in Contract().ai["statistics"].items():
        assert statistic["method"].startswith("statistics."), name
    proposing = {name for name, tool in tools.items() if tool["access"] == "propose"}
    assert proposing == {"propose_widget", "propose_dashboard", "propose_settings", "propose_goal"}
    guarded = {name for name, tool in tools.items() if tool["permission"]}
    assert guarded == {"list_decks", "find_cards", "get_card"}


def test_no_tool_mentions_cards_as_something_to_change() -> None:
    names = set(Contract().ai["tools"])
    forbidden = ("note", "delete", "remove", "uninstall", "key", "mobile", "auto", "write", "set_")
    assert not {name for name in names for word in forbidden if word in name}


def test_an_unknown_tool_does_nothing(setup: Setup) -> None:
    for name in ("ai.setAutoMode", "mobile.enable", "system.uninstall", "execute"):
        result, failed = propose(setup, name, {})
        assert failed is True
        assert "Unknown tool" in result["error"]


def test_one_tool_reads_every_statistic(setup: Setup) -> None:
    span = {"start": "2026-01-01", "end": "2026-01-02", "deckId": None}
    for name, statistic in Contract().ai["statistics"].items():
        arguments: dict[str, Any] = {"name": name, "deckId": None}
        if statistic["needs"] == "range":
            arguments = {"name": name, **span}
        if statistic["needs"] == "view":
            arguments["view"] = "true-retention"
        result, failed = propose(setup, "get_statistic", arguments)
        assert failed is False, (name, result)


def test_the_charts_can_count_ratings_instead_of_reviews(setup: Setup) -> None:
    span = {"start": "2026-01-01", "end": "2026-01-02", "deckId": None}
    for name in ("decks", "timeline", "rhythm", "summary"):
        result, failed = propose(
            setup, "get_statistic", {"name": name, **span, "measure": "ratings"}
        )
        # The summary has both numbers and no such choice, so it is left out there.
        assert failed is False, (name, result)
    result, failed = propose(setup, "get_statistic", {"name": "heatmap", "measure": "ratings"})
    assert failed is False, result
    assert "total" in result["result"]


def test_a_statistic_without_its_dates_asks_for_them(setup: Setup) -> None:
    result, failed = propose(setup, "get_statistic", {"name": "summary"})
    assert failed is True
    assert "start and end" in result["error"]


def test_a_widget_is_checked_in_full_even_though_the_model_sees_little(setup: Setup) -> None:
    broken = {**small_widget(), "elements": [{"kind": "script", "code": "alert(1)"}]}
    result, failed = propose(
        setup, "propose_widget", {"widget": broken, "addToDashboard": False, "summary": "Bad"}
    )
    assert failed is True
    assert "Invalid input" in result["error"]


def test_the_widget_format_is_handed_out_on_request(setup: Setup) -> None:
    result, failed = propose(setup, "get_widget_format", {})
    assert failed is False
    assert "heatmap" in result["format"]


def test_a_full_context_gets_its_own_explanation(service: Service) -> None:
    service.status, service.body = 400, b"exceeds the context length of the model"
    with pytest.raises(AiError) as caught:
        run(OpenAiCompatibleClient(Connection("lmstudio", service.url, "m", None, True)))
    assert caught.value.code == "context_too_small"


def test_settings_tool_shows_only_what_it_may_change(setup: Setup) -> None:
    result, _failed = propose(setup, "get_settings", {})
    assert set(result) == set(Contract().ai["settingKeys"])
    assert "mobileSync" not in result


def test_deck_names_stay_home_until_they_are_allowed(setup: Setup) -> None:
    masked, _failed = propose(setup, "list_decks", {})
    assert all(entry["name"].startswith("Deck ") for entry in masked["result"])
    setup.allow("decks")
    named, _failed = propose(setup, "list_decks", {})
    assert any(entry["name"] == "Test" for entry in named["result"])


def test_nothing_in_the_contract_can_return_a_key() -> None:
    document = json.loads(
        Path(ai.__file__)
        .parent.parent.parent.joinpath("contract", "rpc.schema.json")
        .read_text(encoding="utf-8")
    )
    for name, method in document["methods"].items():
        assert '"key"' not in json.dumps(method["result"]), name
        assert '"apiKey"' not in json.dumps(method["result"]), name


def configured(setup: Setup, provider: str = "openai") -> None:
    setup.assistant.configure({"provider": provider, "model": "m", "baseUrl": ""})


def test_a_key_lands_in_the_secret_store_and_nowhere_else(setup: Setup) -> None:
    configured(setup)
    status = setup.assistant.set_key({"key": KEY})
    assert status["hasKey"] is True
    assert KEY not in json.dumps(status)
    assert setup.runtime.secret_store.get("profile:openai") == KEY
    for path in setup.runtime.folder.rglob("*"):
        if path.is_file():
            assert KEY.encode() not in path.read_bytes(), path


def test_removing_a_key_really_removes_it(setup: Setup) -> None:
    configured(setup)
    setup.assistant.set_key({"key": KEY})
    assert setup.assistant.remove_key({})["hasKey"] is False
    assert setup.runtime.secret_store.get("profile:openai") is None


@pytest.mark.parametrize("key", ["short", "with space 12345", 'quote"12345678', "line\n12345678"])
def test_odd_keys_are_refused(setup: Setup, key: str) -> None:
    configured(setup)
    with pytest.raises(InvalidParams):
        setup.assistant.set_key({"key": key})


def test_each_provider_keeps_its_own_key(setup: Setup) -> None:
    configured(setup, "openai")
    setup.assistant.set_key({"key": KEY})
    configured(setup, "anthropic")
    assert setup.assistant.status()["hasKey"] is False


def test_cloud_services_need_consent_and_local_ones_do_not(setup: Setup) -> None:
    configured(setup, "openai")
    setup.assistant.set_key({"key": KEY})
    with pytest.raises(AiError) as caught:
        setup.assistant._connect()
    assert caught.value.code == "consent_needed"
    setup.assistant.consent({})
    assert setup.assistant.status()["consented"] is True
    setup.assistant._connect()

    configured(setup, "lmstudio")
    assert setup.assistant.status()["consented"] is True


def test_consent_for_one_service_does_not_cover_another(setup: Setup) -> None:
    configured(setup, "openai")
    setup.assistant.consent({})
    configured(setup, "openrouter")
    assert setup.assistant.status()["consented"] is False


def test_a_key_is_required_where_the_service_needs_one(setup: Setup) -> None:
    configured(setup, "anthropic")
    with pytest.raises(AiError) as caught:
        setup.assistant._connection()
    assert caught.value.code == "key_missing"


def test_custom_addresses_are_checked(setup: Setup) -> None:
    with pytest.raises(InvalidParams):
        setup.assistant.configure(
            {
                "provider": "custom",
                "model": "m",
                "baseUrl": "http://example.com/v1",
            }
        )


def test_the_key_stays_in_memory_only_during_an_answer(setup: Setup) -> None:
    setup.script(said("Hi"))
    setup.chat.send("Go")
    assert setup.chat._client is None


def test_each_service_remembers_its_model(setup: Setup) -> None:
    configured(setup, "openai")
    setup.assistant.configure({"provider": "anthropic", "model": "", "baseUrl": ""})
    assert setup.assistant.status()["model"] == "claude-opus-5-5"
    setup.assistant.configure({"provider": "openai", "model": "", "baseUrl": ""})
    assert setup.assistant.status()["model"] == "m"


@pytest.mark.parametrize(
    ("status", "text"),
    [
        (400, "Your credit balance is too low"),
        (402, "Payment required: insufficient funds"),
        (429, "You exceeded your current quota"),
    ],
)
def test_an_empty_account_is_not_mistaken_for_busy(
    service: Service, status: int, text: str
) -> None:
    service.status, service.body = status, text.encode()
    with pytest.raises(AiError) as caught:
        run(AnthropicClient(connection(service.url)))
    assert caught.value.code == "no_credit"


def test_session_secrets_are_not_kept() -> None:
    store = SessionSecrets()
    store.set("a", "b")
    assert store.get("a") == "b"
    assert store.persistent is False


@pytest.mark.skipif(sys.platform != "darwin", reason="needs the macOS keychain tool")
def test_the_mac_keychain_round_trip(tmp_path: Path) -> None:
    """On a throwaway keychain, so the real one stays untouched."""
    keychain = str(tmp_path / "statly-test.keychain-db")
    subprocess.run(["/usr/bin/security", "create-keychain", "-p", "x", keychain], check=True)
    try:
        store = MacKeychain(keychain)
        assert store.get("account") is None
        store.set("account", KEY)
        assert store.get("account") == KEY
        assert KEY.encode() not in Path(keychain).read_bytes()
        store.set("account", KEY + "x")
        assert store.get("account") == KEY + "x"
        store.delete("account")
        assert store.get("account") is None
        store.delete("account")
    finally:
        subprocess.run(["/usr/bin/security", "delete-keychain", keychain], check=False)


class Api:
    def __init__(self, setup: Setup) -> None:
        self.setup = setup
        self.code = setup.assistant.new_external_code({})["code"]
        prefix, port, self.token = self.code.split(".", 2)
        assert prefix == "statly1"
        self.port = int(port)

    def request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        body: Any = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, Any]:
        client = HTTPConnection("127.0.0.1", self.port, timeout=5)
        sent = {"Content-Type": "application/json", **(headers or {})}
        if token:
            sent["Authorization"] = f"Bearer {token}"
        client.request(method, path, json.dumps(body) if body is not None else None, sent)
        response = client.getresponse()
        status, data = response.status, json.loads(response.read() or b"null")
        client.close()
        return status, data


@pytest.fixture
def api(setup: Setup) -> Iterator[Api]:
    running = Api(setup)
    yield running
    setup.assistant.api.stop()


def test_the_connection_code_is_stored_only_as_a_hash(setup: Setup, api: Api) -> None:
    stored = setup.assistant._config.get()["externalHash"]
    assert stored == hash_code(api.token)
    for path in setup.runtime.folder.rglob("*"):
        if path.is_file():
            assert api.token.encode() not in path.read_bytes(), path


def test_every_request_needs_the_code(api: Api) -> None:
    assert api.request("GET", "/v1/tools")[0] == 401
    assert api.request("GET", "/v1/tools", token="wrong")[0] == 401
    status, data = api.request("GET", "/v1/tools", token=api.token)
    assert status == 200
    assert {"get_today", "propose_widget"} <= {tool["name"] for tool in data["tools"]}
    assert "elements" not in json.dumps(data["tools"])


def test_web_pages_are_turned_away_even_with_the_code(api: Api) -> None:
    origin = {"Origin": "https://evil.example"}
    assert api.request("GET", "/v1/tools", token=api.token, headers=origin)[0] == 403


def test_a_forged_host_is_turned_away(api: Api) -> None:
    client = HTTPConnection("127.0.0.1", api.port, timeout=5)
    client.putrequest("GET", "/v1/tools", skip_host=True)
    client.putheader("Host", "evil.example")
    client.putheader("Authorization", f"Bearer {api.token}")
    client.endheaders()
    assert client.getresponse().status == 403
    client.close()


def test_guessing_the_code_locks_the_door(api: Api) -> None:
    for _ in range(10):
        api.request("GET", "/v1/tools", token="wrong")
    assert api.request("GET", "/v1/tools", token=api.token)[0] == 401


def test_a_new_code_cancels_the_old_one(setup: Setup, api: Api) -> None:
    setup.assistant.new_external_code({})
    assert api.request("GET", "/v1/tools", token=api.token)[0] == 401


def test_the_api_listens_only_on_this_computer(setup: Setup, api: Api) -> None:
    server = setup.assistant.api._server
    assert server is not None
    assert server.server_address[0] == "127.0.0.1"


def test_external_suggestions_wait_and_cannot_accept_themselves(setup: Setup, api: Api) -> None:
    arguments = {"patch": {"theme": "dark"}, "summary": "Dark"}

    def answer_on_this_thread() -> Any:
        return api.request("POST", "/v1/tools/propose_settings", token=api.token, body=arguments)

    status, data = answer_on_this_thread()
    assert status == 200
    assert data["result"]["status"] == "waiting_for_user"
    assert setup.assistant.changes._settings.get()["theme"] == "system"

    for path in ("ai.applyProposal", "ai.setAutoMode", "mobile.enable", "system.uninstall"):
        _status, data = api.request("POST", f"/v1/tools/{path}", token=api.token, body={"id": "x"})
        assert "Unknown tool" in data["result"]["error"]


def test_external_apps_get_statistics(setup: Setup, api: Api) -> None:
    answers: list[Any] = []
    setup.allow("decks")
    setup.allow_external()

    def ask() -> None:
        answers.append(api.request("POST", "/v1/tools/list_decks", token=api.token, body={}))

    worker = threading.Thread(target=ask)
    worker.start()
    while worker.is_alive():
        setup.drain()
        time.sleep(0.01)
    assert answers[0][1]["failed"] is False
    assert any(entry["name"] == "Test" for entry in answers[0][1]["result"]["result"])


def test_switching_off_closes_the_port(setup: Setup, api: Api) -> None:
    setup.assistant.set_external({"enabled": False})
    assert setup.assistant.status()["external"]["running"] is False
    with pytest.raises(OSError, match=r".*"):
        api.request("GET", "/v1/tools", token=api.token)


def test_closing_the_profile_ends_everything(setup: Setup, api: Api) -> None:
    setup.assistant.close()
    assert setup.assistant.api.port is None
    assert setup.chat.conversation()["messages"] == []


def test_the_module_registers_every_ai_call() -> None:
    router = make_router(FakeRuntime())
    assert not {name for name in router.missing_methods() if name.startswith("ai.")}


def test_cards_need_permission_and_the_chat_waits_for_it(setup: Setup) -> None:
    client = setup.script(wants("find_cards", {"query": "front", "limit": 5}), said("Found"))
    setup.chat.send("Find my card")
    setup.drain()
    conversation = setup.chat.conversation()
    assert conversation["waiting"] == {"kind": "permission", "scope": "cards"}
    assert conversation["running"] is True
    assert len(client.seen) == 1

    setup.chat.answer_permission("once")
    setup.drain()
    conversation = setup.chat.conversation()
    assert conversation["waiting"] is None
    assert conversation["messages"][-1]["text"] == "Found"
    found = json.loads(client.seen[1][-1]["content"])["result"]
    assert found[0]["front"].startswith("front")
    permissions: Any = setup.assistant.status()["permissions"]
    assert permissions["cards"] is False
    assert setup.runtime.prompts == []


def test_the_chat_can_only_allow_itself(setup: Setup) -> None:
    """For good is a switch in the settings, so the chat has no answer that keeps it."""
    responses = call(setup.router, "ai.answerPermission", {"decision": "always"})
    assert error_code(responses) == "invalid_params"
    assert setup.assistant.status()["permissions"]["cards"] is False


def test_allowing_for_good_in_the_settings_lets_the_waiting_chat_go_on(setup: Setup) -> None:
    client = setup.script(wants("find_cards", {"query": "front", "limit": 5}), said("Found"))
    setup.chat.send("Find my card")
    setup.drain()

    setup.allow("cards")
    setup.drain()

    assert setup.chat.conversation()["waiting"] is None
    assert setup.chat.conversation()["messages"][-1]["text"] == "Found"
    assert "front" in client.seen[1][-1]["content"]
    assert setup.assistant.status()["permissions"]["cards"] is True


def test_once_lasts_for_this_chat_and_always_lasts(setup: Setup) -> None:
    call = {"query": "front", "limit": 5}
    setup.script(wants("find_cards", call), said("One"), wants("find_cards", call), said("Two"))
    setup.chat.send("First")
    setup.drain()
    setup.chat.answer_permission("once")
    setup.drain()
    setup.chat.send("Second")
    setup.drain()
    assert setup.chat.conversation()["waiting"] is None

    setup.chat.reset()
    setup.script(wants("find_cards", call), said("Three"))
    setup.chat.send("Third")
    setup.drain()
    assert setup.chat.conversation()["waiting"] is not None


def test_a_declined_permission_reaches_the_model_and_shows_no_card(setup: Setup) -> None:
    client = setup.script(wants("find_cards", {"query": "front", "limit": 5}), said("Okay"))
    setup.chat.send("Find")
    setup.drain()
    setup.chat.answer_permission("deny")
    setup.drain()
    assert "did not allow" in client.seen[1][-1]["content"]
    assert "front 0" not in json.dumps(client.seen[1])


def test_external_apps_cannot_ask_and_need_their_own_switch(setup: Setup, api: Api) -> None:
    setup.allow("cards")
    arguments = {"query": "front", "limit": 5}
    _status, data = api.request("POST", "/v1/tools/find_cards", token=api.token, body=arguments)
    assert data["failed"] is True
    assert "did not allow" in data["result"]["error"]


def test_external_apps_do_not_get_the_chat_tools(api: Api) -> None:
    _status, data = api.request("GET", "/v1/tools", token=api.token)
    names = {tool["name"] for tool in data["tools"]}
    assert "open_page" not in names
    assert "ask_user" not in names


def test_card_text_cannot_steer_the_automatic_mode(setup: Setup) -> None:
    setup.assistant.set_auto_mode({"enabled": True, "acknowledged": True})
    setup.allow("cards")
    settings = {"patch": {"theme": "dark"}, "summary": "Injected"}
    setup.script(
        wants("find_cards", {"query": "front", "limit": 5}),
        wants("propose_settings", settings),
        said("Done"),
    )
    setup.chat.send("Read my cards")
    setup.drain()
    assert setup.assistant.changes._settings.get()["theme"] == "system"
    assert setup.chat.conversation()["proposals"][0]["status"] == "pending"


def test_a_reopened_chat_remembers_that_it_read_a_card(setup: Setup) -> None:
    """The card text comes back with the chat, so it must not be trusted again."""
    setup.allow("cards")
    setup.script(wants("find_cards", {"query": "front", "limit": 5}), said("Found it"))
    setup.chat.send("Read my cards")
    setup.drain()
    chat_id = setup.chat.conversation()["chatId"]

    setup.chat.reset()
    setup.chat.open_chat(chat_id)
    setup.assistant.set_auto_mode({"enabled": True, "acknowledged": True})
    settings = {"patch": {"theme": "dark"}, "summary": "Injected"}
    setup.script(wants("propose_settings", settings), said("Done"))
    setup.chat.send("Go on")
    setup.drain()

    assert setup.assistant.changes._settings.get()["theme"] == "system"


def test_a_reopened_chat_without_cards_may_still_act_alone(setup: Setup) -> None:
    setup.script(said("Hello"))
    setup.chat.send("Hi")
    setup.drain()
    chat_id = setup.chat.conversation()["chatId"]
    setup.chat.reset()
    setup.chat.open_chat(chat_id)
    assert setup.chat._session.trusted is True


def test_taking_a_permission_back_reaches_the_open_chat(setup: Setup) -> None:
    setup.script(wants("find_cards", {"query": "front", "limit": 5}), said("Found"))
    setup.chat.send("Read my cards")
    setup.drain()
    setup.chat.answer_permission("once")
    setup.drain()

    setup.allow("cards", allowed=False)
    setup.script(wants("find_cards", {"query": "front", "limit": 5}), said("Again"))
    setup.chat.send("Read them again")
    setup.drain()
    assert setup.chat.conversation()["waiting"] == {"kind": "permission", "scope": "cards"}


def test_a_known_service_keeps_its_own_address(setup: Setup) -> None:
    """A key must not be redirected, not even by a compromised page."""
    setup.assistant.configure(
        {"provider": "anthropic", "model": "m", "baseUrl": "https://example.com/v1"}
    )
    assert setup.assistant.status()["baseUrl"] == "https://api.anthropic.com/v1"


def test_a_tool_nobody_handles_is_refused(setup: Setup) -> None:
    answers: list[Any] = []
    setup.assistant.toolbox._start(
        "propose_everything",
        {"method": None},
        {},
        Session("chat"),
        lambda result, failed: answers.append((result, failed)),
    )
    assert answers[0][1] is True


def test_an_unknown_kind_of_change_is_refused(setup: Setup) -> None:
    with pytest.raises(NotAllowed):
        setup.assistant.changes.propose({"kind": "cards", "summary": "x"}, "chat")


def test_a_card_can_be_read_in_full(setup: Setup) -> None:
    router = setup.router
    found: list[Any] = []
    router.call("cards.find", {"query": "front", "limit": 5}, found.append, pytest.fail)
    setup.drain()
    card_id = found[0][0]["cardId"]
    assert found[0][0]["deck"] == "Test"

    details: list[Any] = []
    router.call("cards.get", {"cardId": card_id}, details.append, pytest.fail)
    setup.drain()
    assert details[0]["deck"] == "Test"
    assert "Front" in details[0]["fields"]


def test_reading_cards_leaves_the_undo_history_alone(setup: Setup, collection: Collection) -> None:
    before = collection.undo_status().undo
    found: list[Any] = []
    setup.router.call("cards.find", {"query": "front", "limit": 5}, found.append, pytest.fail)
    setup.drain()
    assert collection.undo_status().undo == before


def test_markup_and_sounds_are_left_out() -> None:
    text = plain_text("<div>Hallo <b>Welt</b> &amp; Co[sound:a.mp3]</div><img src=x>")
    assert text == "Hallo Welt & Co"


def test_the_phone_card_is_no_study_material(collection: Collection) -> None:
    writer.set_up(collection, "e30=")
    reader = CollectionReader(collection)
    assert not set(reader.excluded_cards) & set(reader.find_cards(""))


def test_a_broken_search_goes_back_to_the_model(setup: Setup) -> None:
    errors: list[str] = []
    setup.router.call("cards.find", {"query": '"', "limit": 5}, pytest.fail, errors.append)
    setup.drain()
    assert "cannot read" in errors[0]


def test_questions_wait_and_the_answer_goes_on(setup: Setup) -> None:
    ask = {"question": "Which?", "options": [{"label": "A"}, {"label": "B"}]}
    client = setup.script(wants("ask_user", ask), said("Fine"))
    setup.chat.send("Help")
    setup.drain()
    conversation = setup.chat.conversation()
    assert conversation["waiting"]["kind"] == "question"
    assert conversation["waiting"]["options"][1]["label"] == "B"

    setup.chat.answer_question("B")
    setup.drain()
    assert json.loads(client.seen[1][-1]["content"]) == {"answer": "B"}
    roles = [item["role"] for item in setup.chat.conversation()["messages"]]
    assert roles == ["user", "user", "assistant"]


def test_typing_answers_an_open_question(setup: Setup) -> None:
    ask = {"question": "Which?", "options": [{"label": "A"}, {"label": "B"}]}
    client = setup.script(wants("ask_user", ask), said("Fine"))
    setup.chat.send("Help")
    setup.drain()
    setup.chat.send("Something else")
    setup.drain()
    assert json.loads(client.seen[1][-1]["content"]) == {"answer": "Something else"}


def test_stopping_during_a_question_leaves_a_valid_history(setup: Setup) -> None:
    ask = {"question": "Which?", "options": [{"label": "A"}, {"label": "B"}]}
    setup.script(wants("ask_user", ask))
    setup.chat.send("Help")
    setup.drain()
    setup.chat.stop()
    setup.drain()
    assert setup.chat.conversation()["running"] is False
    assert setup.chat._native[-1]["role"] == "tool"


def test_pages_open_and_stay_inside_statly(setup: Setup) -> None:
    result, failed = propose(
        setup, "open_page", {"page": "settings-general", "highlight": "language"}
    )
    assert (result, failed) == ({"status": "opened"}, False)
    event = next(item for item in setup.runtime.emitted if item[0] == "host.navigate")
    assert event[1] == {"path": "/settings/general", "highlight": "language"}
    _wrong, failed = propose(setup, "open_page", {"page": "https://evil.example"})
    assert failed is True


def test_chats_are_named_kept_and_can_be_continued(setup: Setup) -> None:
    setup.script(said("Hello"), Turn(text='"Lernzeit heute."'))
    setup.chat.send("How much did I study?")
    setup.drain()
    assert setup.chat.conversation()["title"] == "Lernzeit heute"
    chat_id = setup.chat.conversation()["chatId"]
    assert setup.assistant.history.list()[0]["title"] == "Lernzeit heute"

    setup.chat.reset()
    assert setup.chat.conversation()["messages"] == []
    setup.chat.open_chat(chat_id)
    assert setup.chat.conversation()["messages"][1]["text"] == "Hello"

    client = setup.script(said("Again"))
    setup.chat.send("And yesterday?")
    setup.drain()
    assert [item["role"] for item in client.seen[0]] == ["user", "assistant", "user"]
    assert len(setup.assistant.history.list()) == 1


def test_a_reasoning_model_gets_a_clean_title(setup: Setup) -> None:
    setup.script(said("Hello"), Turn(text="<think>hmm</think>\nMein Titel"))
    setup.chat.send("Hi")
    setup.drain()
    assert setup.chat.conversation()["title"] == "Mein Titel"


def test_a_failed_name_keeps_the_question_as_title(setup: Setup) -> None:
    setup.script(said("Hello"), AiError("provider_down"))
    setup.chat.send("How much did I study?")
    setup.drain()
    assert setup.chat.conversation()["title"] == "How much did I study?"
    assert setup.chat.conversation()["error"] is None


def test_the_history_stays_bounded(tmp_path: Path) -> None:
    history = ChatHistory(lambda: tmp_path)
    for number in range(45):
        chat: dict[str, Any] = {
            "id": f"{number:04x}",
            "title": "T",
            "updatedAt": "x",
            "messages": [],
            "native": [],
        }
        history.put(chat)
    assert len(history.list()) == 40
    assert history.read("0000") is None
    assert len(list((tmp_path / "ai-chats").glob("*.json"))) == 41


def test_chat_ids_cannot_leave_the_folder(tmp_path: Path) -> None:
    assert ChatHistory(lambda: tmp_path).read("../settings") is None


def test_chats_can_be_switched_off(setup: Setup) -> None:
    setup.script(said("Hello"), Turn(text="Name"))
    setup.chat.send("Hi")
    setup.drain()
    setup.assistant.set_keep_chats({"keep": False})
    assert setup.assistant.history.list() == []
    setup.chat.reset()
    setup.script(said("Hello"), Turn(text="Name"))
    setup.chat.send("Hi")
    setup.drain()
    assert setup.assistant.history.list() == []


def test_a_chat_moves_to_another_service_as_plain_text(setup: Setup) -> None:
    setup.script(said("Hello"), Turn(text="Name"))
    setup.chat.send("Hi")
    setup.drain()
    chat_id = setup.chat.conversation()["chatId"]
    stored = setup.assistant.history.read(chat_id)
    assert stored is not None
    stored["provider"] = "other"
    stored["native"] = [{"role": "assistant", "content": [{"type": "thinking"}]}]
    setup.assistant.history.put(stored)
    setup.chat.open_chat(chat_id)
    client = setup.script(said("Again"))
    setup.chat.send("More")
    setup.drain()
    assert client.seen[0][0] == {"role": "user", "content": "Hi"}
    assert all(isinstance(item["content"], str) for item in client.seen[0])


def test_a_working_beta_service_asks_for_a_review_once(setup: Setup) -> None:
    client = setup.script(said("Hello"), Turn(text="Name"))
    client.provider = "openai"
    setup.chat.send("Hi")
    setup.drain()
    assert setup.chat.conversation()["askReview"] is True
    setup.assistant.answer_review({})
    client = setup.script(said("Again"))
    client.provider = "openai"
    setup.chat.send("More")
    setup.drain()
    assert setup.chat.conversation()["askReview"] is False


def test_local_services_never_ask_for_a_review(setup: Setup) -> None:
    client = setup.script(said("Hello"), Turn(text="Name"))
    client.provider = "lmstudio"
    setup.chat.send("Hi")
    setup.drain()
    assert setup.chat.conversation()["askReview"] is False


def test_a_finished_widget_replaces_the_suggestion(setup: Setup) -> None:
    changes = setup.assistant.changes
    result, _failed = propose(
        setup,
        "propose_widget",
        {"widget": small_widget(), "addToDashboard": False, "summary": "New"},
    )
    changes.apply(result["id"], widget={**small_widget(), "name": "Mine now"})
    stored: Any = changes._widgets.get("mine")
    assert stored["name"] == "Mine now"


def test_the_assistant_can_never_make_a_call_that_changes_anki() -> None:
    """A second lock behind the contract's tool list: even a tool that named such a call stops."""
    from statly.core.contract import Contract as AnyContract
    from statly.modules.ai.tools import ToolBox

    calls: list[str] = []

    class Router:
        def call(self, method: str, *_rest: Any) -> None:
            calls.append(method)

    toolbox = ToolBox(
        AnyContract(),
        Router(),  # type: ignore[arg-type]
        None,  # type: ignore[arg-type]
        None,  # type: ignore[arg-type]
        lambda _scope, _source: True,
        lambda _source: True,
        lambda _target: None,
    )
    answers: list[tuple[Any, bool]] = []
    for method in ("goals.raiseLimit", "changes.undo", "permissions.request", "goals.save"):
        toolbox._read(method, {}, None, lambda result, failed: answers.append((result, failed)))  # type: ignore[arg-type]
    assert calls == []
    assert all(failed and "only read" in result["error"] for result, failed in answers)
