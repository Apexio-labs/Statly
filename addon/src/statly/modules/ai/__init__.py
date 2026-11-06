"""The AI assistant: a chat inside Statly and a local connection for external apps."""

from __future__ import annotations

import logging
import re
import secrets
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from ...contract.types import AiModelsResult, AiStatusResult
from ...core.errors import InvalidParams, NotAllowed
from ...core.module import Context
from ...core.storage import JsonStore
from ..permissions import Cleanup, PermissionService
from . import cards
from .changes import ChangeBook
from .chat import Chat
from .errors import AiError
from .history import ChatHistory
from .keys import KeyVault
from .local_api import LocalApi, hash_code
from .providers import Client, Connection, check_base_url, client_for
from .tools import Session, ToolBox

logger = logging.getLogger(__name__)

_FILE = "ai"
_DEFAULTS: dict[str, Any] = {
    "provider": None,
    "model": "",
    "baseUrl": "",
    "permissions": {"decks": False, "cards": False},
    "externalPermissions": False,
    "keepChats": True,
    "reviewAnswered": False,
    "consented": [],
    "models": {},
    "autoMode": False,
    "autoExternal": False,
    "externalEnabled": False,
    "externalPort": None,
    "externalHash": None,
}
_KEY_SHAPE = re.compile(r"^[!#-\[\]-~]{8,512}$")
_CODE_PREFIX = "statly1"
_BRIDGE_FILE = Path(__file__).parent / "statly.mcpb"
_BRIDGE_FILTER = "MCP bundle (*.mcpb)"

type _Finish = Callable[[Any], None]
type _Fail = Callable[[Exception], None]


class AiConfig:
    """Everything but keys, in the profile folder, which does not sync."""

    def __init__(self, store: JsonStore) -> None:
        self._store = store

    def get(self) -> dict[str, Any]:
        stored: Any = self._store.read(_FILE)
        return {**_DEFAULTS, **(cast(dict[str, Any], stored) if isinstance(stored, dict) else {})}

    def update(self, **values: Any) -> dict[str, Any]:
        updated = {**self.get(), **values}
        self._store.write(_FILE, updated)
        return updated


class Assistant:
    def __init__(self, context: Context) -> None:
        self._host = context.host
        self._providers: dict[str, Any] = context.contract.ai["providers"]
        self._config = AiConfig(JsonStore(context.host.data_folder))
        self._permissions: PermissionService = context.services["permissions"]
        self._grants = self._permissions.grants
        self.keys = KeyVault(context.host.secrets, context.host.profile_key, list(self._providers))
        self.changes = ChangeBook(
            JsonStore(context.host.data_folder),
            context.contract,
            context.settings,
            context.services["dashboard"],
            context.services["widgets"],
            context.host.monotonic,
            lambda: context.host.emit("ai.applied", {}),
            context.services.get("goals"),
        )
        self.toolbox = ToolBox(
            context.contract,
            context.router,
            context.settings,
            self.changes,
            self._permitted,
            self._may_act_alone,
            lambda target: context.host.emit("host.navigate", target),
        )
        self.history = ChatHistory(context.host.data_folder)
        self.chat = Chat(
            context.host,
            self._connect,
            self.toolbox,
            self.changes,
            self.history,
            lambda: self._config.get()["keepChats"],
            self._review_due,
        )
        self._grants.subscribe(self._permission_changed)
        self.api = LocalApi(
            lambda: self._config.get()["externalHash"],
            self._tool_list,
            self._run_external,
            context.host.run_on_main,
        )

    def _permitted(self, scope: str, source: str) -> bool:
        """What the chat was allowed stays away from external apps unless opened up for them."""
        permission = f"ai.{scope}"
        permitted = self._grants.allowed(permission) and (
            source == "chat" or self._grants.allowed("ai.external")
        )
        if permitted:
            self._grants.used(permission)
        return permitted

    def _permission_changed(self, permission: str, granted: bool) -> None:
        if permission in ("ai.decks", "ai.cards"):
            self.chat.permission_changed(permission.removeprefix("ai."), granted)

    def migrate_permissions(self) -> None:
        """Older versions kept these switches here. They now live with every other permission."""
        config = self._config.get()
        allowed = [f"ai.{scope}" for scope, on in config["permissions"].items() if on]
        if config["externalPermissions"]:
            allowed.append("ai.external")
        self._grants.migrate("ai", allowed)
        if allowed:
            self._config.update(
                permissions={"decks": False, "cards": False}, externalPermissions=False
            )

    def forget_chat_grants(self, scope: str) -> Cleanup:
        """Taking a permission back also ends what a chat was allowed "only this time"."""

        def cleanup(finish: Callable[[], None], _fail: Callable[[Exception], None]) -> None:
            self.chat.revoke(scope)
            finish()

        return cleanup

    def _review_due(self, provider: str) -> bool:
        """Nobody here can test services in beta, so a working one is worth hearing about."""
        return self._providers[provider]["beta"] and not self._config.get()["reviewAnswered"]

    def answer_review(self, _params: Any) -> None:
        self._config.update(reviewAnswered=True)

    def _switch(self, permission: str, allowed: bool, finish: _Finish, fail: _Fail) -> None:
        """Switching on opens Statly's own dialog. Switching off needs no question."""
        if allowed:
            if self._grants.allowed(permission):
                finish(self.status())
            else:
                self._permissions.ask(
                    permission, lambda _answer: finish(self.status()), modes=("always",)
                )
        else:
            # The open chat may have been allowed "only this time", which ends here as well.
            self.chat.revoke(permission.removeprefix("ai."))
            self._permissions.revoke(
                {"id": permission}, lambda _states: finish(self.status()), fail
            )

    def set_permission(self, params: Any, finish: _Finish, fail: _Fail) -> None:
        self._switch(f"ai.{params['scope']}", params["allowed"], finish, fail)

    def set_external_permissions(self, params: Any, finish: _Finish, fail: _Fail) -> None:
        self._switch("ai.external", params["allowed"], finish, fail)

    def set_keep_chats(self, params: Any) -> AiStatusResult:
        self._config.update(keepChats=params["keep"])
        if not params["keep"]:
            self.history.clear()
        return self.status()

    def _may_act_alone(self, source: str) -> bool:
        """Off by default, and external apps need a switch of their own on top."""
        config = self._config.get()
        return config["autoMode"] and (source == "chat" or config["autoExternal"])

    def status(self) -> AiStatusResult:
        config = self._config.get()
        provider = config["provider"]
        return cast(
            AiStatusResult,
            {
                "provider": provider,
                "model": config["model"],
                "baseUrl": config["baseUrl"],
                "hasKey": provider is not None and self.keys.has(provider),
                "keyStorage": "system" if self._host.secrets.persistent else "session",
                "keyLock": self.keys.lock_state(),
                "consented": self._is_consented(config),
                "permissions": {
                    "decks": self._grants.allowed("ai.decks"),
                    "cards": self._grants.allowed("ai.cards"),
                },
                "externalPermissions": self._grants.allowed("ai.external"),
                "keepChats": config["keepChats"],
                "autoMode": config["autoMode"],
                "autoExternal": config["autoExternal"],
                "external": {
                    "enabled": config["externalEnabled"],
                    "running": self.api.port is not None,
                    "port": self.api.port or config["externalPort"],
                    "hasCode": config["externalHash"] is not None,
                },
            },
        )

    def _is_consented(self, config: dict[str, Any]) -> bool:
        provider = config["provider"]
        if provider is None:
            return False
        return self._providers[provider]["local"] or provider in config["consented"]

    def configure(self, params: Any) -> AiStatusResult:
        provider = params["provider"]
        defaults = self._providers[provider]
        if provider != self._config.get()["provider"]:
            # Services write their histories differently, so one cannot continue another's.
            self.chat.reset()
        config = self._config.get()
        model = params["model"].strip() or config["models"].get(provider) or defaults["model"]
        # A key for a known service only ever goes to that service's own address.
        fixed = defaults["baseUrl"] and not defaults["local"]
        base_url = (
            defaults["baseUrl"] if fixed else params["baseUrl"].strip() or defaults["baseUrl"]
        )
        if base_url:
            try:
                base_url = check_base_url(base_url, local_only=defaults["local"])
            except AiError:
                raise InvalidParams("This address is not allowed.") from None
        self._config.update(
            provider=provider,
            model=model,
            models={**config["models"], provider: model},
            baseUrl=base_url,
        )
        return self.status()

    def set_key(self, params: Any) -> AiStatusResult:
        provider = self._config.get()["provider"]
        key = params["key"].strip()
        if provider is None:
            raise InvalidParams("Choose a provider first.")
        if not _KEY_SHAPE.fullmatch(key):
            raise InvalidParams("This does not look like an API key.")
        self.keys.put(provider, key)
        return self.status()

    def remove_key(self, _params: Any) -> AiStatusResult:
        provider = self._config.get()["provider"]
        if provider is not None:
            self.keys.remove(provider)
        return self.status()

    def _in_background(
        self,
        work: Callable[[], None],
        finish: Callable[[Any], None],
        fail: Callable[[Exception], None],
    ) -> None:
        """Passwords take a moment on purpose, and the window must not freeze meanwhile."""
        self._host.run_task(work, lambda _result: finish(self.status()), fail)

    def enable_key_lock(self, params: Any, finish: _Finish, fail: _Fail) -> None:
        self._in_background(lambda: self.keys.turn_on(params["password"]), finish, fail)

    def disable_key_lock(self, params: Any, finish: _Finish, fail: _Fail) -> None:
        self._in_background(lambda: self.keys.turn_off(params["password"]), finish, fail)

    def unlock_keys(self, params: Any, finish: _Finish, fail: _Fail) -> None:
        self._in_background(lambda: self.keys.unlock(params["password"]), finish, fail)

    def change_key_password(self, params: Any, finish: _Finish, fail: _Fail) -> None:
        self._in_background(
            lambda: self.keys.change_password(params["current"], params["password"]), finish, fail
        )

    def lock_keys(self, _params: Any) -> AiStatusResult:
        # A running answer still holds its key, and locking should mean what it says.
        self.chat.stop()
        self.keys.lock()
        return self.status()

    def forget_keys(self, _params: Any) -> AiStatusResult:
        self.chat.stop()
        self.keys.forget()
        return self.status()

    def consent(self, _params: Any) -> AiStatusResult:
        config = self._config.get()
        if config["provider"] is not None:
            agreed = sorted({*config["consented"], config["provider"]})
            self._config.update(consented=agreed)
        return self.status()

    def _connection(self) -> Connection:
        config = self._config.get()
        provider = config["provider"]
        if provider is None or not config["baseUrl"]:
            raise AiError("not_configured")
        defaults = self._providers[provider]
        key = self.keys.get(provider)
        if defaults["needsKey"] and key is None:
            raise AiError("key_missing")
        return Connection(
            provider,
            check_base_url(config["baseUrl"], local_only=defaults["local"]),
            config["model"],
            key,
            defaults["local"],
        )

    def _connect(self) -> Client:
        config = self._config.get()
        connection = self._connection()
        if not connection.model:
            raise AiError("not_configured")
        if not self._is_consented(config):
            raise AiError("consent_needed")
        return client_for(connection)

    def models(self, _params: Any, finish: _Finish, fail: _Fail) -> None:
        def work() -> AiModelsResult:
            found = client_for(self._connection()).models()
            listed = [{"id": item.id, "name": item.name, "tools": item.tools} for item in found]
            return cast(AiModelsResult, {"models": listed})

        def failed(error: Exception) -> None:
            code = error.code if isinstance(error, AiError) else "bad_response"
            fail(NotAllowed(code))

        self._host.run_task(work, finish, failed)

    def set_auto_mode(self, params: Any) -> AiStatusResult:
        return self._set_switch("autoMode", params)

    def set_auto_external(self, params: Any) -> AiStatusResult:
        return self._set_switch("autoExternal", params)

    def _set_switch(self, name: str, params: Any) -> AiStatusResult:
        if params["enabled"] and not params["acknowledged"]:
            raise NotAllowed("The warning has to be confirmed first.")
        self._config.update(**{name: params["enabled"]})
        return self.status()

    def _tool_list(self) -> list[dict[str, Any]]:
        return [
            {"name": tool.name, "description": tool.description, "inputSchema": tool.input}
            for tool in self.toolbox.definitions(external=True)
        ]

    def _run_external(self, name: str, arguments: Any, answer: Any) -> None:
        def answered(result: dict[str, Any], failed: bool) -> None:
            self._host.emit("ai.changed", {})
            answer(result, failed)

        session = Session("external", trusted=not self._grants.allowed("ai.external"))
        self.toolbox.run(name, arguments, session, answered)

    def start_external(self) -> None:
        config = self._config.get()
        if config["externalEnabled"] and config["externalHash"]:
            port = self.api.start(config["externalPort"] or 0)
            if port is not None:
                self._config.update(externalPort=port)

    def set_external(self, params: Any) -> AiStatusResult:
        self._config.update(externalEnabled=params["enabled"])
        if params["enabled"]:
            self.start_external()
        else:
            self.api.stop()
        return self.status()

    def new_external_code(self, _params: Any) -> dict[str, str]:
        token = secrets.token_urlsafe(32)
        self._config.update(externalHash=hash_code(token), externalEnabled=True)
        self.api.reset_attempts()
        self.start_external()
        if self.api.port is None:
            raise NotAllowed("Statly could not open its local port.")
        return {"code": f"{_CODE_PREFIX}.{self.api.port}.{token}"}

    def close(self) -> None:
        self.chat.reset()
        self.api.stop()
        self.keys.close()

    def uninstall(self) -> None:
        self.close()
        self.keys.forget_profiles(self._host.profile_keys())


class AiModule:
    def register(self, context: Context) -> None:
        assistant = Assistant(context)
        router, host = context.router, context.host
        chat, changes = assistant.chat, assistant.changes
        permissions: PermissionService = context.services["permissions"]
        # Before start_external below, which needs the carried-over grants. The profile holds
        # them, and Anki opens it only after add-ons load.
        host.on_profile_opened(assistant.migrate_permissions)
        for scope in ("decks", "cards"):
            permissions.offer(
                f"ai.{scope}", requestable=True, on_revoke=assistant.forget_chat_grants(scope)
            )
        permissions.offer("ai.external", requestable=True)

        def after_change(work: Callable[[Any], None]) -> Callable[[Any], None]:
            def run(params: Any) -> None:
                work(params)
                host.emit("ai.changed", {})

            return run

        def apply(params: Any) -> None:
            changes.apply(params["id"], widget=params.get("widget"), goal=params.get("goal"))

        def reject(params: Any) -> None:
            changes.reject(params["id"])

        def rollback(params: Any) -> None:
            changes.rollback(params["id"])

        def send(params: Any) -> None:
            chat.send(params["text"])

        def save_bridge(_params: Any) -> dict[str, bool]:
            content = _BRIDGE_FILE.read_bytes()
            return {"saved": host.save_binary(_BRIDGE_FILE.name, content, _BRIDGE_FILTER)}

        router.local("ai.status", lambda _params: assistant.status())
        router.local("ai.configure", assistant.configure)
        router.local("ai.setKey", assistant.set_key)
        router.local("ai.removeKey", assistant.remove_key)
        router.deferred("ai.enableKeyLock", assistant.enable_key_lock)
        router.deferred("ai.disableKeyLock", assistant.disable_key_lock)
        router.deferred("ai.unlockKeys", assistant.unlock_keys)
        router.deferred("ai.changeKeyPassword", assistant.change_key_password)
        router.local("ai.lockKeys", assistant.lock_keys)
        router.local("ai.forgetKeys", assistant.forget_keys)
        router.deferred("ai.models", assistant.models)
        router.local("ai.consent", assistant.consent)
        router.local("ai.conversation", lambda _params: chat.conversation())
        router.local("ai.send", send)
        router.local("ai.stop", lambda _params: chat.stop())
        router.local("ai.reset", lambda _params: chat.reset())
        router.local(
            "ai.answerPermission", lambda params: chat.answer_permission(params["decision"])
        )
        router.local("ai.answerQuestion", lambda params: chat.answer_question(params["text"]))
        router.deferred("ai.setPermission", assistant.set_permission)
        router.deferred("ai.setExternalPermissions", assistant.set_external_permissions)
        router.local("ai.setKeepChats", assistant.set_keep_chats)
        router.local("ai.chats", lambda _params: assistant.history.list())
        router.local("ai.openChat", lambda params: chat.open_chat(params["id"]))
        router.local("ai.deleteChat", lambda params: chat.forget(params["id"]))
        router.local("ai.reviewAnswered", assistant.answer_review)
        router.query("cards.find", cards.find)
        router.query("cards.get", cards.details)
        router.local("ai.applyProposal", after_change(apply))
        router.local("ai.rejectProposal", after_change(reject))
        router.local("ai.changes", lambda _params: changes.visible_changes())
        router.local("ai.rollback", after_change(rollback))
        router.local("ai.setAutoMode", assistant.set_auto_mode)
        router.local("ai.setAutoExternal", assistant.set_auto_external)
        router.local("ai.setExternal", assistant.set_external)
        router.local("ai.newExternalCode", assistant.new_external_code)
        router.local("ai.saveBridge", save_bridge)
        host.on_profile_opened(assistant.start_external)
        host.on_profile_closing(assistant.close)
        host.on_uninstalling(assistant.uninstall)
        context.services["ai"] = assistant
