"""The small interface every feature module implements."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from ..contract.types import SystemInfoResult
from .contract import Contract
from .rpc import Router
from .settings import SettingsService


class SecretStore(Protocol):
    """Keeps secrets away from every file Statly writes."""

    @property
    def persistent(self) -> bool:
        """False if secrets only last until Anki closes."""
        ...

    def get(self, account: str) -> str | None: ...

    def set(self, account: str, secret: str) -> None: ...

    def delete(self, account: str) -> None: ...


class Host(Protocol):
    """What modules may ask of Anki. Only ``host/`` implements this."""

    def info(self) -> SystemInfoResult: ...

    def open_external(self, url: str) -> None: ...

    def open_anki_statistics(self) -> None: ...

    def save_file(self, name: str, content: str) -> bool:
        """Ask where to save and write the file. Returns False if the user cancels."""
        ...

    def open_file(self) -> str | None:
        """Ask for a text file and return its content, or None if the user cancels."""
        ...

    def pick_path(self, file_filter: str) -> Path | None:
        """Ask for a file. Returns None if the user cancels."""
        ...

    def run_task(
        self,
        work: Callable[[], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        """Run slow work away from the main thread. It must not touch the collection."""
        ...

    def convert_video(self, source: Path, target: Path) -> None:
        """Turn any video into WebM, the format Anki's browser engine can play."""
        ...

    def media_folder(self) -> Path:
        """Where widget media lives, in a place Anki can serve files from."""
        ...

    def media_url(self, file_name: str) -> str:
        """The address of a file in the media folder, as seen from the web app."""
        ...

    def save_binary(self, name: str, content: bytes, file_filter: str) -> bool:
        """Ask where to save and write the file. Returns False if the user cancels."""
        ...

    def set_unsaved(self, message: str | None) -> None:
        """Ask before the window closes while ``message`` is set."""
        ...

    def auto_update(self) -> bool: ...

    def set_auto_update(self, enabled: bool) -> None: ...

    def uninstall(self) -> bool:
        """Ask for confirmation, then remove Statly through Anki."""
        ...

    def choose_wallpaper(self, destination: Path) -> bool:
        """Ask for an image and store it at ``destination``."""
        ...

    def shortcut_conflict(self, action: str, keys: str) -> str | None: ...

    def apply_shortcuts(self, shortcuts: Mapping[str, object]) -> None: ...

    def begin_shortcut_recording(self) -> None:
        """Keep existing shortcuts from firing while the user presses a new one."""
        ...

    def end_shortcut_recording(self) -> None: ...

    def thumbnail(self, image: bytes, side: int) -> str | None:
        """Shrink a picture into a data address small enough for a card. Safe on a worker."""
        ...

    def create_backup(self) -> None:
        """Back up the collection. Call only from a collection write."""
        ...

    def run_collection_write(
        self,
        work: Callable[[Any], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        """Run ``work(collection)`` on Anki's collection worker."""
        ...

    def write_before_sync(self, work: Callable[[Any], Any]) -> None:
        """Queue a write right now, so it runs before a sync that is about to start."""
        ...

    def syncs_on_start(self) -> bool:
        """Whether a sync will run after opening the profile."""
        ...

    def run_on_main(self, work: Callable[[], None]) -> None:
        """Run ``work`` on the main thread, from any thread."""
        ...

    def emit(self, event: str, payload: Any) -> None:
        """Tell the web app something, if its window is open."""
        ...

    @property
    def secrets(self) -> SecretStore: ...

    def profile_key(self) -> str:
        """Tells profiles apart without naming them."""
        ...

    def profile_keys(self) -> list[str]:
        """The same for every profile, open or not."""
        ...

    def on_profile_opened(self, callback: Callable[[], None]) -> None: ...

    def on_profile_closing(self, callback: Callable[[], None]) -> None: ...

    def on_uninstalling(self, callback: Callable[[], None]) -> None:
        """Run ``callback`` just before Statly is removed."""
        ...

    def monotonic(self) -> float: ...

    def on_deck_overview(self, callback: Callable[[], None]) -> None: ...

    def on_sync(self, starting: Callable[[], None], finished: Callable[[], None]) -> None: ...

    def add_deck_browser_html(self, provider: Callable[[], str]) -> None:
        """Add HTML to Anki's deck overview. ``provider`` runs on every render."""
        ...

    def refresh_deck_browser(self) -> None: ...

    def update_deck_browser_element(self, element_id: str, html: str) -> None: ...

    def data_folder(self) -> Path:
        """Statly's folder in the current profile. It is not part of the collection."""
        ...

    def on_data_replaced(self, callback: Callable[[], None]) -> None:
        """Run ``callback`` when a sync or profile change may have replaced the collection."""
        ...


class Events:
    """Lets one module react to another without importing it."""

    def __init__(self) -> None:
        self._listeners: dict[str, list[Callable[[Any], None]]] = {}

    def subscribe(self, name: str, listener: Callable[[Any], None]) -> None:
        self._listeners.setdefault(name, []).append(listener)

    def publish(self, name: str, value: Any = None) -> None:
        for listener in self._listeners.get(name, ()):
            listener(value)


@dataclass(frozen=True)
class Context:
    router: Router
    host: Host
    contract: Contract
    settings: SettingsService
    events: Events = field(default_factory=Events)
    services: dict[str, Any] = field(default_factory=dict[str, Any])
    """Modules registered first can offer an object to the ones after them."""


class Module(Protocol):
    def register(self, context: Context) -> None: ...
