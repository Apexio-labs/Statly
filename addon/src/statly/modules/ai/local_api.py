"""A small server on this computer, so external AI apps can use the same toolbox.

It listens only on 127.0.0.1, wants a code on every request, and turns away anything that looks
like a web page: pages send an Origin header, and a forged host name gives itself away.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
from collections.abc import Callable
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

logger = logging.getLogger(__name__)

_MAX_BODY_BYTES = 1_000_000
_TOOL_TIMEOUT_SECONDS = 30
_MAX_FAILED_ATTEMPTS = 10
_TOOL_PREFIX = "/v1/tools/"

type RunTool = Callable[[str, Any, Callable[[dict[str, Any], bool], None]], None]


def hash_code(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class LocalApi:
    def __init__(
        self,
        token_hash: Callable[[], str | None],
        tools: Callable[[], list[dict[str, Any]]],
        run_tool: RunTool,
        run_on_main: Callable[[Callable[[], None]], None],
    ) -> None:
        self._token_hash = token_hash
        self._tools = tools
        self._run_tool = run_tool
        self._run_on_main = run_on_main
        self._server: ThreadingHTTPServer | None = None
        self._failed_attempts = 0

    @property
    def port(self) -> int | None:
        return self._server.server_address[1] if self._server else None

    def start(self, port: int) -> int | None:
        """Returns the port, or None if another program holds it."""
        if self._server:
            return self.port
        handler = self._make_handler()
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), handler)
        except OSError:
            logger.warning("Statly could not open its local port")
            return None
        server.daemon_threads = True
        self._server = server
        threading.Thread(target=server.serve_forever, daemon=True, name="statly-api").start()
        return self.port

    def stop(self) -> None:
        server, self._server = self._server, None
        if server:
            server.shutdown()
            server.server_close()

    def _authorized(self, header: str) -> bool:
        expected = self._token_hash()
        if not expected or self._failed_attempts >= _MAX_FAILED_ATTEMPTS:
            return False
        token = header.removeprefix("Bearer ").strip()
        if header.startswith("Bearer ") and hmac.compare_digest(hash_code(token), expected):
            self._failed_attempts = 0
            return True
        self._failed_attempts += 1
        return False

    def reset_attempts(self) -> None:
        self._failed_attempts = 0

    def _call(self, name: str, arguments: Any) -> tuple[dict[str, Any], bool]:
        outcome: Future[tuple[dict[str, Any], bool]] = Future()

        def start() -> None:
            self._run_tool(
                name, arguments, lambda result, failed: outcome.set_result((result, failed))
            )

        self._run_on_main(start)
        return outcome.result(timeout=_TOOL_TIMEOUT_SECONDS)

    def _make_handler(self) -> type[BaseHTTPRequestHandler]:
        api = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "Statly"
            sys_version = ""

            def log_message(self, format: str, *args: Any) -> None:
                pass

            def _reply(self, status: int, payload: Any) -> None:
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _allowed(self) -> bool:
                host = self.headers.get("Host", "")
                if self.headers.get("Origin") is not None or host != f"127.0.0.1:{api.port}":
                    self._reply(403, {"error": "Not allowed."})
                    return False
                if not api._authorized(self.headers.get("Authorization", "")):
                    self._reply(401, {"error": "The connection code is not valid."})
                    return False
                return True

            def do_GET(self) -> None:
                if self._allowed():
                    if self.path == "/v1/tools":
                        self._reply(200, {"tools": api._tools()})
                    else:
                        self._reply(404, {"error": "Not found."})

            def do_POST(self) -> None:
                if not self._allowed():
                    return
                length = int(self.headers.get("Content-Length") or 0)
                if not self.path.startswith(_TOOL_PREFIX) or not 0 < length <= _MAX_BODY_BYTES:
                    self._reply(400, {"error": "Bad request."})
                    return
                if "application/json" not in self.headers.get("Content-Type", ""):
                    self._reply(415, {"error": "Send JSON."})
                    return
                try:
                    arguments = json.loads(self.rfile.read(length))
                    result, failed = api._call(self.path.removeprefix(_TOOL_PREFIX), arguments)
                except ValueError:
                    self._reply(400, {"error": "Bad request."})
                except FutureTimeout:
                    self._reply(504, {"error": "Anki did not answer in time."})
                else:
                    self._reply(200, {"result": result, "failed": failed})

        return Handler
