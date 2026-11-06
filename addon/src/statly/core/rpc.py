"""Routes calls from the web app to the handlers that modules registered."""

from __future__ import annotations

import json
import logging
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol, cast
from urllib.parse import urlsplit

from .contract import Contract
from .errors import BadRequest, CollectionUnavailable, StatlyError, UnknownMethod
from .reader import CollectionReader, ReadableCollection

logger = logging.getLogger(__name__)

type Respond = Callable[[dict[str, Any]], None]
type LocalHandler = Callable[[Any], Any]
type QueryHandler = Callable[[Any, CollectionReader], Any]
type DeferredHandler = Callable[[Any, Callable[[Any], None], Callable[[Exception], None]], None]


class Runtime(Protocol):
    """The parts of Anki the router needs, so it can be tested without Anki."""

    def collection_is_open(self) -> bool: ...

    def run_query(
        self,
        work: Callable[[ReadableCollection], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None: ...


@dataclass(frozen=True)
class _Request:
    id: int
    method: str
    params: Any


@dataclass(frozen=True)
class _Route:
    local: LocalHandler | None = None
    query: QueryHandler | None = None
    deferred: DeferredHandler | None = None


class Router:
    def __init__(self, contract: Contract, runtime: Runtime, *, check_results: bool = False):
        self._contract = contract
        self._runtime = runtime
        self._check_results = check_results
        self._routes: dict[str, _Route] = {}
        self._waiting: deque[Callable[[], None]] = deque()
        self._query_running = False

    @property
    def contract(self) -> Contract:
        return self._contract

    def local(self, method: str, handler: LocalHandler) -> None:
        """Register a quick handler that runs on the main thread and needs no collection."""
        self._add(method, _Route(local=handler))

    def query(self, method: str, handler: QueryHandler) -> None:
        """Register a handler that reads the collection on Anki's background worker."""
        self._add(method, _Route(query=handler))

    def deferred(self, method: str, handler: DeferredHandler) -> None:
        """Register a handler that answers later, for dialogs and slow file work."""
        self._add(method, _Route(deferred=handler))

    def missing_methods(self) -> set[str]:
        return self._contract.method_names - set(self._routes)

    def _add(self, method: str, route: _Route) -> None:
        if method not in self._contract.method_names:
            raise ValueError(f"{method} is not in the contract")
        if method in self._routes:
            raise ValueError(f"{method} is already registered")
        self._routes[method] = route

    def handle(self, raw: str, respond: Respond) -> None:
        """Answer exactly once, whatever happens. A lost answer would hang the web app."""
        try:
            request = _parse(raw)
        except BadRequest as error:
            respond(_failure(None, error))
            return
        try:
            self._dispatch(request, respond)
        except Exception as error:  # noqa: BLE001
            respond(_failure(request.id, error))

    def _dispatch(self, request: _Request, respond: Respond) -> None:
        route = self._routes.get(request.method)
        if route is None:
            raise UnknownMethod(f"Unknown method: {request.method}")
        self._contract.check_params(request.method, request.params)
        if route.query is not None:
            self._start_query(request, route.query, respond)
        elif route.deferred is not None:
            route.deferred(
                request.params,
                lambda result: respond(self._success(request, result)),
                lambda error: respond(_failure(request.id, error)),
            )
        elif route.local is not None:
            respond(self._success(request, route.local(request.params)))

    def _start_query(self, request: _Request, handler: QueryHandler, respond: Respond) -> None:
        if not self._runtime.collection_is_open():
            raise CollectionUnavailable("The collection is not open.")

        def work(collection: ReadableCollection) -> Any:
            return handler(request.params, CollectionReader(collection))

        def done(result: Any) -> None:
            try:
                respond(self._success(request, result))
            except Exception as error:  # noqa: BLE001
                respond(_failure(request.id, error))
            self._start_next_query()

        def failed(error: Exception) -> None:
            respond(_failure(request.id, error))
            self._start_next_query()

        def start() -> None:
            if self._runtime.collection_is_open():
                self._runtime.run_query(work, done, failed)
            else:
                failed(CollectionUnavailable("The collection is not open."))

        self._waiting.append(start)
        if not self._query_running:
            self._start_next_query()

    def call(
        self,
        method: str,
        params: Any,
        done: Callable[[Any], None],
        failed: Callable[[str], None],
    ) -> None:
        """Make a call from Python, with the same checks and queue as one from the web app."""

        def respond(response: dict[str, Any]) -> None:
            if response["ok"]:
                done(response["result"])
            else:
                failed(response["error"]["message"])

        self.handle(json.dumps({"id": 0, "method": method, "params": params}), respond)

    def run_background(
        self,
        work: Callable[[CollectionReader], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None] | None = None,
    ) -> None:
        """Read the collection for Python's own needs, in line with the web app's queries.

        Without ``failed``, errors are only logged, and nothing happens while no collection is
        open. Pass it when someone waits for an answer."""

        def tell(error: Exception) -> None:
            if failed is not None:
                try:
                    failed(error)
                except Exception:
                    logger.exception("Statly could not report a background failure")

        def finished(result: Any) -> None:
            try:
                done(result)
            except Exception:
                logger.exception("Statly could not use a background result")
            self._start_next_query()

        def broke(error: Exception) -> None:
            logger.warning("Statly background read failed", exc_info=error)
            tell(error)
            self._start_next_query()

        def start() -> None:
            if self._runtime.collection_is_open():
                self._runtime.run_query(
                    lambda collection: work(CollectionReader(collection)), finished, broke
                )
            else:
                tell(CollectionUnavailable("The collection is not open."))
                self._start_next_query()

        self._waiting.append(start)
        if not self._query_running:
            self._start_next_query()

    def _start_next_query(self) -> None:
        """Queries run one at a time, because answering a card waits behind every queued one."""
        self._query_running = bool(self._waiting)
        if self._waiting:
            self._waiting.popleft()()

    def _success(self, request: _Request, result: Any) -> dict[str, Any]:
        if self._check_results:
            self._contract.check_result(request.method, result)
        return {"id": request.id, "ok": True, "result": result}


def is_same_page(current: str, home: str) -> bool:
    """Compares everything but the route, which lives in the fragment and changes all the time."""
    return urlsplit(current)[:3] == urlsplit(home)[:3]


def _parse(raw: str) -> _Request:
    try:
        request: Any = json.loads(raw)
    except ValueError:
        raise BadRequest("The request is not valid JSON.") from None
    if not isinstance(request, dict):
        raise BadRequest("The request is incomplete.")
    fields = cast(dict[str, Any], request)
    request_id, method = fields.get("id"), fields.get("method")
    if not isinstance(request_id, int) or not isinstance(method, str) or "params" not in fields:
        raise BadRequest("The request is incomplete.")
    return _Request(id=request_id, method=method, params=fields["params"])


def _failure(request_id: int | None, error: Exception) -> dict[str, Any]:
    if isinstance(error, StatlyError):
        code, message = error.code, str(error)
    else:
        logger.exception("Statly call failed", exc_info=error)
        code, message = "internal", "Something went wrong."
    return {"id": request_id, "ok": False, "error": {"code": code, "message": message}}
