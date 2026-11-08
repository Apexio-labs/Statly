"""The small interface every feature module implements."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
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


@dataclass(frozen=True)
class PermissionPrompt:
    """A question only the person can answer, in a popup of Statly's own.

    It is used for permissions and for other questions that must not be answered by the page,
    such as uninstalling. All text comes from Python. Values such as deck names are shown as plain
    text, so nothing in them can turn into a link or a button. The first choice is the safe one:
    Escape and closing pick it. "danger" marks the last choice as one that removes something.
    """

    title: str
    body: str
    details: tuple[str, ...]
    choices: tuple[tuple[str, str], ...]
    tone: str = "question"


@dataclass(frozen=True)
class AddingEvent:
    """Something that happened in Anki's Add window, the one where new notes are written.

    ``kind`` is one of:

    - ``opened`` and ``closed``: the window appeared or went away.
    - ``focused``: it, or a window it opened, came to the front.
    - ``unfocused``: another program came to the front, such as a browser used for research.
    - ``elsewhere``: another of Anki's windows came to the front, such as the main window.
    - ``typed``: the person typed in a field or moved to another one.
    - ``added``: a note was added, with its id, its first card's deck and how many cards it made.

    ``precise`` is False for Anki's newer, experimental editor, which says nothing about typing.
    """

    kind: str
    note_id: int = 0
    deck_id: int = 0
    cards: int = 0
    precise: bool = True


@dataclass(frozen=True)
class ShownCard:
    """A card whose question the reviewer just showed, as it was before the answer."""

    card_id: int
    deck_id: int
    """The card's home deck: for a card borrowed by a filtered deck, the deck it came from."""
    card_type: int
    """0 new, 1 learning, 2 review, 3 relearning."""
    queue: int
    """Where Anki keeps it today: 0 new, 1 and 3 learning, 2 review, negative when held back."""


class Host(Protocol):
    """What modules may ask of Anki. Only ``host/`` implements this."""

    def ask_permission(
        self, prompt: PermissionPrompt, answered: Callable[[str | None], None]
    ) -> None:
        """Show Statly's own popup and return at once. ``answered`` gets the chosen answer later,
        or None if it was closed. Nothing may wait for it: a web page cannot run its scripts
        while a call from it is still being handled."""
        ...

    def is_reviewing(self) -> bool:
        """Whether a review session is on screen, when nothing may slow down answering."""
        ...

    def run_collection_op(
        self,
        work: Callable[[Any], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        """Run an undoable change on Anki's worker. ``work`` returns Anki's ``OpChanges``, so
        Anki's own screens refresh and its Edit menu can undo the step."""
        ...

    def info(self) -> SystemInfoResult: ...

    def open_external(self, url: str) -> None: ...

    def open_anki_statistics(self) -> None: ...

    def open_browser(self, card_ids: Sequence[int]) -> None:
        """Open Anki's card browser on these cards."""
        ...

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

    def shared_media_url(self, file_name: str) -> str:
        """The same file's address for Anki's own pages, which live somewhere else."""
        ...

    def save_binary(self, name: str, content: bytes, file_filter: str) -> bool:
        """Ask where to save and write the file. Returns False if the user cancels."""
        ...

    def set_unsaved(self, message: str | None) -> None:
        """Ask before the window closes while ``message`` is set."""
        ...

    def auto_update(self) -> bool: ...

    def set_auto_update(self, enabled: bool) -> None: ...

    def uninstall(self, done: Callable[[bool], None]) -> None:
        """Ask for confirmation, then remove Statly through Anki. ``done`` says whether it did."""
        ...

    def take_dropped_file(self) -> Path | None:
        """The file last dropped onto the page. Only Qt knows its path, and only once."""
        ...

    def share(self, text: str, url: str, anchor: Mapping[str, float]) -> bool:
        """Open the system's share sheet, or fill the clipboard. True if a sheet opened."""
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

    def wall_clock(self) -> float:
        """Seconds since 1970, for moments that are stored. Durations use ``monotonic``."""
        ...

    def on_state_changed(self, callback: Callable[[str, str], None]) -> None:
        """Anki moved between screens, such as "deckBrowser", "overview" and "review"."""
        ...

    def on_question_shown(self, callback: Callable[[ShownCard], None]) -> None:
        """The reviewer shows a question. Keep the callback to a few lines: the person waits."""
        ...

    def on_will_answer(self, callback: Callable[[int, int], None]) -> None:
        """A card is about to be answered: its id and the button, 1 to 4.

        The answer always goes ahead unchanged, also when the callback fails. Statly never listens
        for the answer itself, because Anki then loads the card again after every answer.
        """
        ...

    def on_answer_undone(self, callback: Callable[[], None]) -> None:
        """An answer was taken back with Anki's undo. Other undo steps do not call it."""
        ...

    def on_app_active(self, callback: Callable[[bool], None]) -> None:
        """Anki came to the front (True) or went to the background (False)."""
        ...

    def on_adding(self, callback: Callable[[AddingEvent], None]) -> None:
        """Anki's Add window changed, see ``AddingEvent``. Never the note's content."""
        ...

    def later(self, work: Callable[[], None]) -> None:
        """Run ``work`` on the main thread once Qt has handled what waits, such as the next card."""
        ...

    def card_state(self, card_id: int) -> tuple[int, int] | None:
        """A card's type and queue right now, read on the main thread.

        Only for one card just after it was answered, never in a loop and never while a query of
        Statly's runs. None if the card is gone or no collection is open.
        """
        ...

    def show_tooltip(self, text: str) -> None:
        """A short note in Anki's own style that goes away by itself, also over the reviewer."""
        ...

    def current_deck_id(self) -> int | None:
        """The deck Anki has selected, as on its overview before studying."""
        ...

    def open_deck_options(self, deck_id: int) -> None:
        """Anki's own options for a normal deck. Opening them changes nothing by itself."""
        ...

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
