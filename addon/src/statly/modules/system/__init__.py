"""Basic calls that show the connection between the web app and Anki works."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from ...contract.types import (
    SystemAddonResult,
    SystemCollectionSummaryResult,
    SystemOpenExternalParams,
    SystemOpenFileResult,
    SystemPingParams,
    SystemPingResult,
    SystemSaveFileParams,
    SystemSaveFileResult,
    SystemSetAutoUpdateParams,
    SystemUninstallResult,
)
from ...core.errors import NotAllowed
from ...core.module import Context, Host
from ...core.reader import CollectionReader

_EXTERNAL_SCHEMES = frozenset({"http", "https"})


def ping(params: SystemPingParams) -> SystemPingResult:
    return {"nonce": params["nonce"]}


def collection_summary(_params: Any, reader: CollectionReader) -> SystemCollectionSummaryResult:
    return {
        "cards": reader.scalar("select count() from cards"),
        "reviews": reader.scalar("select count() from revlog"),
    }


def open_external(host: Host, params: SystemOpenExternalParams) -> None:
    url = params["url"]
    if urlsplit(url).scheme.lower() not in _EXTERNAL_SCHEMES:
        raise NotAllowed("Only web links can be opened.")
    host.open_external(url)


class SystemModule:
    def register(self, context: Context) -> None:
        router, host = context.router, context.host
        router.local("system.ping", ping)
        router.local("system.info", lambda _params: host.info())
        router.local("system.openExternal", lambda params: open_external(host, params))
        router.local("system.setUnsaved", lambda params: host.set_unsaved(params["message"]))
        router.query("system.collectionSummary", collection_summary)

        def open_anki_statistics(_params: Any) -> None:
            host.open_anki_statistics()

        def save_file(params: SystemSaveFileParams) -> SystemSaveFileResult:
            return {"saved": host.save_file(params["name"], params["content"])}

        def open_file(_params: Any) -> SystemOpenFileResult:
            return {"content": host.open_file()}

        def addon(_params: Any) -> SystemAddonResult:
            return {"autoUpdate": host.auto_update()}

        def set_auto_update(params: SystemSetAutoUpdateParams) -> None:
            host.set_auto_update(params["enabled"])

        def uninstall(_params: Any) -> SystemUninstallResult:
            return {"uninstalled": host.uninstall()}

        router.local("system.openAnkiStatistics", open_anki_statistics)
        router.local("system.saveFile", save_file)
        router.local("system.openFile", open_file)
        router.local("system.addon", addon)
        router.local("system.setAutoUpdate", set_auto_update)
        router.local("system.uninstall", uninstall)
