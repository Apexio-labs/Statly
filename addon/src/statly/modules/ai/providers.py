"""Talks to AI services over HTTPS, or to services on this computer."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from threading import Event
from typing import Any, Protocol, cast
from urllib.parse import urlsplit

import requests

from .errors import AiError, Stopped, is_context_full, is_out_of_credit, scrub
from .prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

_TIMEOUTS = (10, 120)
_LIST_TIMEOUTS = (5, 15)
_MAX_RESPONSE_BYTES = 4_000_000
_MAX_OUTPUT_TOKENS = 16_000
_LOOPBACK = {"127.0.0.1", "localhost", "::1"}

_ANTHROPIC_VERSION = "2026-10-21"
_FALLBACK_BETA = "server-side-fallback-2026-07-01"
_MODELS_WITH_FALLBACK = {
    "claude-fable-5-1",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-sonnet-5-5",
}
_FAMILIES_WITH_EFFORT = ("claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-5")
_DROPPED_BEFORE_FALLBACK = {"thinking", "redacted_thinking", "tool_use"}

type OnText = Callable[[str], None]


def check_base_url(url: str, *, local_only: bool) -> str:
    """Keys travel only over HTTPS, and plain HTTP only stays on this computer."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    loopback = host in _LOOPBACK
    plain_parts = not (parts.username or parts.password or parts.query or parts.fragment)
    allowed = parts.scheme == "https" or (parts.scheme == "http" and loopback)
    if not host or not plain_parts or not allowed or (local_only and not loopback):
        raise AiError("bad_url")
    return url.rstrip("/")


@dataclass(frozen=True)
class Connection:
    provider: str
    base_url: str
    model: str
    key: str | None
    local: bool

    def __repr__(self) -> str:
        return f"Connection({self.provider}, {self.base_url}, {self.model})"


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    input: dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: str


@dataclass(frozen=True)
class ToolResult:
    call: ToolCall
    content: str
    failed: bool


@dataclass
class Turn:
    """One answer of the model. ``stop`` is one of end, tool, length and refusal."""

    text: str = ""
    calls: list[ToolCall] = field(default_factory=list[ToolCall])
    stop: str = "end"
    message: dict[str, Any] = field(default_factory=dict[str, Any])


@dataclass(frozen=True)
class Model:
    id: str
    name: str
    tools: bool | None


class Client(Protocol):
    @property
    def provider(self) -> str: ...

    def models(self) -> list[Model]: ...

    def complete(
        self,
        messages: Sequence[dict[str, Any]],
        tools: Sequence[ToolDefinition],
        on_text: OnText,
        cancelled: Event,
        system: str = SYSTEM_PROMPT,
    ) -> Turn: ...

    def user_message(self, text: str) -> dict[str, Any]: ...

    def tool_results(self, results: Sequence[ToolResult]) -> list[dict[str, Any]]: ...


def _session(connection: Connection) -> requests.Session:
    session = requests.Session()
    # A proxy from the system settings has no business seeing traffic to this computer.
    session.trust_env = not connection.local
    session.max_redirects = 0
    return session


def _failure(response: requests.Response, key: str | None) -> AiError:
    status = response.status_code
    detail = scrub(response.text, key)
    if is_context_full(detail):
        return AiError("context_too_small", detail)
    if status in (401, 407):
        return AiError("key_invalid")
    if status in (400, 402, 429) and is_out_of_credit(detail):
        return AiError("no_credit", detail)
    if status == 403:
        return AiError("no_access", detail)
    if status == 404:
        return AiError("model_missing", detail)
    if status == 429:
        return AiError("rate_limited", detail)
    if status in (400, 422) and "tool" in detail.lower():
        return AiError("no_tool_support", detail)
    if status >= 500:
        return AiError("provider_down", detail)
    # A redirect is refused too: following one could carry the key somewhere else.
    return AiError("bad_request", detail)


def _unreachable(connection: Connection, error: requests.RequestException) -> AiError:
    logger.info("Statly could not reach %s: %s", connection.provider, type(error).__name__)
    return AiError("unreachable")


def _events(response: requests.Response, cancelled: Event) -> Iterator[dict[str, Any]]:
    received = 0
    for line in response.iter_lines(chunk_size=256):
        if cancelled.is_set():
            raise Stopped
        received += len(line)
        if received > _MAX_RESPONSE_BYTES:
            raise AiError("bad_response")
        if not line.startswith(b"data:"):
            continue
        data = line[5:].strip()
        if data == b"[DONE]":
            return
        try:
            yield json.loads(data)
        except ValueError:
            raise AiError("bad_response") from None


class _Http:
    def __init__(self, connection: Connection) -> None:
        self.connection = connection
        self._session = _session(connection)

    def stream(
        self,
        path: str,
        headers: dict[str, str],
        body: dict[str, Any],
        cancelled: Event,
    ) -> Iterator[dict[str, Any]]:
        connection = self.connection
        try:
            with self._session.post(
                f"{connection.base_url}{path}",
                headers=headers,
                data=json.dumps(body),
                stream=True,
                timeout=_TIMEOUTS,
                allow_redirects=False,
            ) as response:
                if response.status_code != 200:
                    raise _failure(response, connection.key)
                yield from _events(response, cancelled)
        except requests.RequestException as error:
            if cancelled.is_set():
                raise Stopped from None
            raise _unreachable(connection, error) from None

    def fetch(self, path: str, headers: dict[str, str]) -> Any:
        connection = self.connection
        try:
            response = self._session.get(
                f"{connection.base_url}{path}",
                headers=headers,
                timeout=_LIST_TIMEOUTS,
                allow_redirects=False,
            )
        except requests.RequestException as error:
            raise _unreachable(connection, error) from None
        if response.status_code != 200:
            raise _failure(response, connection.key)
        try:
            return response.json()
        except ValueError:
            raise AiError("bad_response") from None


def _entries(payload: Any) -> list[dict[str, Any]]:
    data: Any = cast(dict[str, Any], payload).get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise AiError("bad_response")
    return [entry for entry in cast(list[Any], data) if isinstance(entry, dict)]


class AnthropicClient:
    """The Messages API. Plain HTTP on purpose: add-ons cannot ship the compiled SDK."""

    def __init__(self, connection: Connection) -> None:
        self._connection = connection
        self._http = _Http(connection)
        self.provider = connection.provider

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self._connection.key or "",
            "anthropic-version": _ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

    def models(self) -> list[Model]:
        payload = self._http.fetch("/models?limit=100", self._headers())
        return [
            Model(entry["id"], entry.get("display_name") or entry["id"], True)
            for entry in _entries(payload)
        ]

    def user_message(self, text: str) -> dict[str, Any]:
        return {"role": "user", "content": text}

    def tool_results(self, results: Sequence[ToolResult]) -> list[dict[str, Any]]:
        """All results of a turn go into one message, as the API expects."""
        return [
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": result.call.id,
                        "content": result.content,
                        "is_error": result.failed,
                    }
                    for result in results
                ],
            }
        ]

    def complete(
        self,
        messages: Sequence[dict[str, Any]],
        tools: Sequence[ToolDefinition],
        on_text: OnText,
        cancelled: Event,
        system: str = SYSTEM_PROMPT,
    ) -> Turn:
        model = self._connection.model
        body: dict[str, Any] = {
            "model": model,
            "max_tokens": _MAX_OUTPUT_TOKENS,
            "stream": True,
            "system": system,
            "cache_control": {"type": "ephemeral"},
            "tools": [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input,
                    "eager_input_streaming": True,
                }
                for tool in tools
            ],
            "messages": list(messages),
        }
        headers = self._headers()
        if model in _MODELS_WITH_FALLBACK:
            body["fallbacks"] = "default"
            headers["anthropic-beta"] = _FALLBACK_BETA
        if model.startswith(_FAMILIES_WITH_EFFORT):
            body["output_config"] = {"effort": "medium"}
        stream = self._http.stream("/messages", headers, body, cancelled)
        return _read_anthropic_stream(stream, on_text)


def _read_anthropic_stream(stream: Iterator[dict[str, Any]], on_text: OnText) -> Turn:
    blocks: dict[int, dict[str, Any]] = {}
    partial: dict[int, str] = {}
    stop = None
    for event in stream:
        kind = event.get("type")
        if kind == "content_block_start":
            blocks[event["index"]] = dict(event["content_block"])
        elif kind == "content_block_delta":
            block, delta = blocks[event["index"]], event["delta"]
            delta_kind = delta.get("type")
            if delta_kind == "text_delta":
                block["text"] = block.get("text", "") + delta["text"]
                on_text(delta["text"])
            elif delta_kind == "input_json_delta":
                partial[event["index"]] = partial.get(event["index"], "") + delta["partial_json"]
            elif delta_kind == "thinking_delta":
                block["thinking"] = block.get("thinking", "") + delta["thinking"]
            elif delta_kind == "signature_delta":
                block["signature"] = delta["signature"]
        elif kind == "message_delta":
            stop = event["delta"].get("stop_reason") or stop
        elif kind == "error":
            raise AiError("provider_down", str(event.get("error", {}).get("type", "")))
    ordered = [blocks[index] for index in sorted(blocks)]
    calls: list[ToolCall] = []
    for index in sorted(blocks):
        block = blocks[index]
        if block.get("type") == "tool_use":
            arguments = partial.get(index, "")
            calls.append(ToolCall(block["id"], block["name"], arguments))
            try:
                block["input"] = json.loads(arguments or "{}")
            except ValueError:
                block["input"] = {}
    turn_stop = {"tool_use": "tool", "max_tokens": "length", "refusal": "refusal"}.get(
        stop or "", "end"
    )
    return Turn(
        text="".join(block.get("text", "") for block in ordered if block.get("type") == "text"),
        calls=calls if turn_stop == "tool" else [],
        stop=turn_stop,
        message={"role": "assistant", "content": _replayable(ordered)},
    )


def _replayable(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Blocks go back unchanged, except what a model switch mid-answer made invalid."""
    boundary = max(
        (index for index, block in enumerate(blocks) if block.get("type") == "fallback"),
        default=-1,
    )
    return [
        block
        for index, block in enumerate(blocks)
        if index > boundary or block.get("type") not in _DROPPED_BEFORE_FALLBACK
    ]


class OpenAiCompatibleClient:
    """OpenAI, OpenRouter, Ollama, LM Studio and anything else that speaks the same way."""

    def __init__(self, connection: Connection) -> None:
        self._connection = connection
        self._http = _Http(connection)
        self.provider = connection.provider

    def _headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if self._connection.key:
            headers["authorization"] = f"Bearer {self._connection.key}"
        return headers

    def models(self) -> list[Model]:
        found: list[Model] = []
        for entry in _entries(self._http.fetch("/models", self._headers())):
            parameters = entry.get("supported_parameters")
            tools = "tools" in parameters if isinstance(parameters, list) else None
            found.append(Model(entry["id"], entry.get("name") or entry["id"], tools))
        return sorted(found, key=lambda model: model.name.lower())

    def user_message(self, text: str) -> dict[str, Any]:
        return {"role": "user", "content": text}

    def tool_results(self, results: Sequence[ToolResult]) -> list[dict[str, Any]]:
        return [
            {"role": "tool", "tool_call_id": result.call.id, "content": result.content}
            for result in results
        ]

    def complete(
        self,
        messages: Sequence[dict[str, Any]],
        tools: Sequence[ToolDefinition],
        on_text: OnText,
        cancelled: Event,
        system: str = SYSTEM_PROMPT,
    ) -> Turn:
        limit = "max_completion_tokens" if self._connection.provider == "openai" else "max_tokens"
        body: dict[str, Any] = {
            "model": self._connection.model,
            limit: _MAX_OUTPUT_TOKENS,
            "stream": True,
            "messages": [{"role": "system", "content": system}, *messages],
        }
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input,
                    },
                }
                for tool in tools
            ]
        stream = self._http.stream("/chat/completions", self._headers(), body, cancelled)
        return _read_openai_stream(stream, on_text, self._connection.key)


def _read_openai_stream(stream: Iterator[dict[str, Any]], on_text: OnText, key: str | None) -> Turn:
    text = ""
    finish = None
    pending: dict[int, dict[str, str]] = {}
    for chunk in stream:
        if "error" in chunk:
            detail = scrub(str(chunk["error"]), key)
            raise AiError(
                "context_too_small" if is_context_full(detail) else "provider_down", detail
            )
        choices: list[Any] = chunk.get("choices") or []
        if not choices:
            continue
        choice: dict[str, Any] = choices[0]
        delta: dict[str, Any] = choice.get("delta") or {}
        finish = choice.get("finish_reason") or finish
        content: str | None = delta.get("content")
        if content:
            text += content
            on_text(content)
        fragments: list[dict[str, Any]] = delta.get("tool_calls") or []
        for call in fragments:
            entry = pending.setdefault(
                call.get("index", 0), {"id": "", "name": "", "arguments": ""}
            )
            function: dict[str, Any] = call.get("function") or {}
            entry["id"] = call.get("id") or entry["id"]
            entry["name"] = function.get("name") or entry["name"]
            entry["arguments"] += function.get("arguments") or ""
    if finish == "content_filter":
        return Turn(text=text, stop="refusal")
    if finish == "length":
        return Turn(text=text, stop="length")
    calls = [
        ToolCall(entry["id"] or f"call-{index}", entry["name"], entry["arguments"])
        for index, entry in sorted(pending.items())
    ]
    message: dict[str, Any] = {"role": "assistant", "content": text or None}
    if calls:
        message["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.name, "arguments": call.arguments or "{}"},
            }
            for call in calls
        ]
    return Turn(text=text, calls=calls, stop="tool" if calls else "end", message=message)


def client_for(connection: Connection) -> Client:
    if connection.provider == "anthropic":
        return AnthropicClient(connection)
    return OpenAiCompatibleClient(connection)
