"""Connects Statly's core to Anki."""

from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import tempfile
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import aqt
from anki.buildinfo import version as anki_version
from aqt import gui_hooks
from aqt.main import AnkiQt
from aqt.operations import CollectionOp, QueryOp
from aqt.qt import (
    QApplication,
    QBuffer,
    QByteArray,
    QFileDialog,
    QImage,
    QImageWriter,
    QIODevice,
    QMessageBox,
    Qt,
    QTimer,
    QWidget,
)
from aqt.theme import theme_manager
from aqt.utils import openLink, tooltip

from ..contract.types import SystemInfoResult
from ..core.errors import CollectionUnavailable, InvalidParams
from ..core.module import PermissionPrompt, SecretStore, ShownCard
from ..core.reader import CollectionReader, ReadableCollection
from .hooks import guarded, guarded_filter
from .keychain import system_secrets
from .labels import host_labels
from .prompt import PromptUnavailable
from .share import show_share_sheet
from .shortcuts import Shortcuts, conflict_with
from .video import convert_to_webm
from .window import DIALOG_NAME

_MANIFEST = Path(__file__).parent.parent / "manifest.json"
_MAX_OPENED_BYTES = 2_000_000
_THUMBNAIL_QUALITY = 70


class AnkiRuntime:
    def __init__(self, main_window: AnkiQt, package: str) -> None:
        self._mw = main_window
        self._package = package
        self.shortcuts = Shortcuts(main_window, self._quit_pressed)
        self._secrets = system_secrets()
        self._before_uninstall: list[Callable[[], None]] = []
        self.unsaved_message: str | None = None
        # Set by bootstrap, which knows the settings. Statly's own popups take their look from it.
        self.appearance: Callable[[], dict[str, Any]] = lambda: {
            "theme": "light",
            "accent": None,
            "language": "en",
        }
        gui_hooks.addons_dialog_will_delete_addons.append(guarded(self._addons_deleted))

    def collection_is_open(self) -> bool:
        return self._mw.col is not None

    def run_query(
        self,
        work: Callable[[ReadableCollection], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        def op(collection: Any) -> Any:
            # Anki passes its current collection, which is None once it has closed.
            if collection is None:
                raise CollectionUnavailable("The collection is not open.")
            return work(collection)

        # No with_progress(): it opens a modal dialog over the user's work after 600 ms.
        QueryOp(parent=self._mw, op=op, success=done).failure(failed).run_in_background()

    def info(self) -> SystemInfoResult:
        manifest = json.loads(_MANIFEST.read_text(encoding="utf-8"))
        return {
            "statlyVersion": manifest["human_version"],
            "ankiVersion": anki_version,
            "nightMode": theme_manager.night_mode,
            "language": str(self._mw.pm.meta.get("defaultLang", "en")),
        }

    def open_external(self, url: str) -> None:
        openLink(url)

    def open_anki_statistics(self) -> None:
        self._mw.onStats()

    def _dialog_parent(self) -> QWidget:
        dialogs: Any = aqt.dialogs
        return dialogs._dialogs[DIALOG_NAME][1] or self._mw

    def ask_permission(
        self, prompt: PermissionPrompt, answered: Callable[[str | None], None]
    ) -> None:
        """Statly's own popup over the app, in its window. Anki's dialog only without the window."""
        window: Any = self._statly_window()
        if window is not None:
            try:
                window.prompts.ask(prompt, answered)
                return
            except PromptUnavailable:
                pass
        answered(self._native_prompt(prompt))

    def _statly_window(self) -> Any | None:
        dialogs: Any = aqt.dialogs
        return dialogs._dialogs[DIALOG_NAME][1]

    def _native_prompt(self, prompt: PermissionPrompt) -> str | None:
        """Anki's own dialog, for when Statly's window is closed.

        Qt reads the smaller text as HTML and opens links in it, and a deck name may contain
        anything. So every part is escaped, and the main line is plain text.
        """
        box = QMessageBox(self._dialog_parent())
        box.setWindowTitle("Statly")
        box.setIcon(QMessageBox.Icon.Question)
        box.setTextFormat(Qt.TextFormat.PlainText)
        box.setText(prompt.title)
        paragraphs = [*prompt.details, *prompt.body.split("\n\n")]
        box.setInformativeText(
            "".join(f"<p>{html.escape(part).replace(chr(10), '<br>')}</p>" for part in paragraphs)
        )
        answers: dict[Any, str] = {}
        for index, (answer, label) in enumerate(prompt.choices):
            role = (
                QMessageBox.ButtonRole.RejectRole
                if index == 0
                else QMessageBox.ButtonRole.AcceptRole
            )
            button = box.addButton(label, role)
            answers[button] = answer
            if index == 0:
                box.setDefaultButton(button)
                box.setEscapeButton(button)
        box.exec()
        return answers.get(box.clickedButton())

    def is_reviewing(self) -> bool:
        return self._mw.state == "review"

    def run_collection_op(
        self,
        work: Callable[[Any], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        def op(collection: Any) -> Any:
            if collection is None:
                raise CollectionUnavailable("The collection is not open.")
            return work(collection)

        # A collection operation lets Anki refresh its screens and offer the step under Edit → Undo.
        CollectionOp(parent=self._dialog_parent(), op=op).success(done).failure(
            failed
        ).run_in_background()

    def save_file(self, name: str, content: str) -> bool:
        target, _ = QFileDialog.getSaveFileName(
            self._dialog_parent(), "Statly", str(Path.home() / name), "JSON (*.json)"
        )
        if not target:
            return False
        path = Path(target)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".statly-")
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as file:
                file.write(content)
            os.replace(temporary, path)
        except OSError:
            Path(temporary).unlink(missing_ok=True)
            raise
        return True

    def open_file(self) -> str | None:
        source, _ = QFileDialog.getOpenFileName(
            self._dialog_parent(), "Statly", str(Path.home()), "JSON (*.json)"
        )
        if not source:
            return None
        path = Path(source)
        if path.stat().st_size > _MAX_OPENED_BYTES:
            raise InvalidParams("This file is too large.")
        return path.read_text(encoding="utf-8", errors="replace")

    def pick_path(self, file_filter: str) -> Path | None:
        source, _ = QFileDialog.getOpenFileName(
            self._dialog_parent(), "Statly", str(Path.home()), file_filter
        )
        return Path(source) if source else None

    def run_task(
        self,
        work: Callable[[], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        def op(_collection: Any) -> Any:
            return work()

        task = QueryOp(parent=self._mw, op=op, success=done).failure(failed)
        task.without_collection().run_in_background()

    def convert_video(self, source: Path, target: Path) -> None:
        convert_to_webm(source, target)

    def media_folder(self) -> Path:
        return self._user_media() / self._profile_key()

    def media_url(self, file_name: str) -> str:
        return f"../user_files/media/{self._profile_key()}/{file_name}"

    def shared_media_url(self, file_name: str) -> str:
        return f"/_addons/{self._package}/user_files/media/{self._profile_key()}/{file_name}"

    def _user_media(self) -> Path:
        return Path(self._mw.addonManager.addonsFolder(self._package)) / "user_files" / "media"

    def _profile_key(self, name: str | None = None) -> str:
        """Anki can serve files only from an add-on's folder, which all profiles share."""
        return hashlib.sha256(str(name or self._mw.pm.name).encode()).hexdigest()[:16]

    def save_binary(self, name: str, content: bytes, file_filter: str) -> bool:
        target, _ = QFileDialog.getSaveFileName(
            self._dialog_parent(), "Statly", str(Path.home() / name), file_filter
        )
        if not target:
            return False
        path = Path(target)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".statly-")
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(content)
            os.replace(temporary, path)
        except OSError:
            Path(temporary).unlink(missing_ok=True)
            raise
        return True

    def set_unsaved(self, message: str | None) -> None:
        self.unsaved_message = message

    def auto_update(self) -> bool:
        return self._mw.addonManager.addon_meta(self._package).update_enabled

    def set_auto_update(self, enabled: bool) -> None:
        manager = self._mw.addonManager
        meta = manager.addon_meta(self._package)
        meta.update_enabled = enabled
        manager.write_addon_meta(meta)

    def uninstall(self, done: Callable[[bool], None]) -> None:
        text = host_labels(self.appearance().get("language", "en"))
        prompt = PermissionPrompt(
            title=text["uninstallTitle"],
            body=text["uninstallBody"],
            details=(),
            choices=(("cancel", text["cancel"]), ("uninstall", text["uninstall"])),
            tone="danger",
        )

        def answered(answer: str | None) -> None:
            if answer != "uninstall":
                done(False)
                return
            self._run_before_uninstall()
            self._mw.addonManager.deleteAddon(self._package)
            tooltip(text["removed"], parent=self._mw)
            done(True)

        self.ask_permission(prompt, answered)

    def on_uninstalling(self, callback: Callable[[], None]) -> None:
        self._before_uninstall.append(callback)

    def _run_before_uninstall(self) -> None:
        for callback in self._before_uninstall:
            callback()

    def _addons_deleted(self, _dialog: Any, packages: list[str]) -> None:
        if self._package in packages:
            self._run_before_uninstall()

    def take_dropped_file(self) -> Path | None:
        dialogs: Any = aqt.dialogs
        window = dialogs._dialogs[DIALOG_NAME][1]
        return None if window is None else window.web.take_dropped_file()

    def share(self, text: str, url: str, anchor: Mapping[str, float]) -> bool:
        if show_share_sheet(self._dialog_parent(), text, url, anchor):
            return True
        clipboard = QApplication.clipboard()
        if clipboard is not None:
            clipboard.setText(f"{text} {url}")
        return False

    def shortcut_conflict(self, action: str, keys: str) -> str | None:
        return conflict_with(keys, action)

    def apply_shortcuts(self, shortcuts: Mapping[str, object]) -> None:
        self.shortcuts.apply(shortcuts)

    def _quit_pressed(self) -> None:
        self.emit("shortcuts.pressed", {"keys": "Ctrl+Q"})

    def emit(self, event: str, payload: Any) -> None:
        dialogs: Any = aqt.dialogs
        window = dialogs._dialogs[DIALOG_NAME][1]
        if window is not None:
            window.emit_event(event, payload)

    def run_on_main(self, work: Callable[[], None]) -> None:
        self._mw.taskman.run_on_main(work)

    @property
    def secrets(self) -> SecretStore:
        return self._secrets

    def profile_key(self) -> str:
        return self._profile_key()

    def profile_keys(self) -> list[str]:
        return [self._profile_key(name) for name in self._mw.pm.profiles()]

    def on_profile_opened(self, callback: Callable[[], None]) -> None:
        gui_hooks.profile_did_open.append(guarded(callback))

    def on_profile_closing(self, callback: Callable[[], None]) -> None:
        gui_hooks.profile_will_close.append(guarded(callback))

    def begin_shortcut_recording(self) -> None:
        self.shortcuts.begin_recording()

    def end_shortcut_recording(self) -> None:
        self.shortcuts.end_recording()

    def thumbnail(self, image: bytes, side: int) -> str | None:
        picture = QImage.fromData(image)
        if picture.isNull():
            return None
        small = picture.scaled(
            side,
            side,
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        buffer = QBuffer()
        buffer.open(QIODevice.OpenModeFlag.WriteOnly)
        writer = QImageWriter(buffer, QByteArray(b"jpeg"))
        writer.setQuality(_THUMBNAIL_QUALITY)
        if not writer.write(small):
            return None
        encoded = base64.b64encode(bytes(buffer.data().data())).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"

    def create_backup(self) -> None:
        self._mw.create_backup_now()

    def run_collection_write(
        self,
        work: Callable[[Any], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        def op(collection: Any) -> Any:
            if collection is None:
                raise CollectionUnavailable("The collection is not open.")
            return work(collection)

        QueryOp(parent=self._mw, op=op, success=done).failure(failed).run_in_background()

    def write_before_sync(self, work: Callable[[Any], Any]) -> None:
        def task() -> None:
            collection = self._mw.col
            if collection is not None:
                work(collection)

        # Submitted synchronously: the worker is first in, first out, so this precedes the sync.
        self._mw.taskman.run_in_background(task)

    def syncs_on_start(self) -> bool:
        return self._mw.can_auto_sync()

    def monotonic(self) -> float:
        return time.monotonic()

    def wall_clock(self) -> float:
        return time.time()

    def on_state_changed(self, callback: Callable[[str, str], None]) -> None:
        gui_hooks.state_did_change.append(guarded(callback))

    def on_question_shown(self, callback: Callable[[ShownCard], None]) -> None:
        def shown(card: Any) -> None:
            callback(
                ShownCard(
                    card_id=int(card.id),
                    deck_id=int(card.odid or card.did),
                    card_type=int(card.type),
                    queue=int(card.queue),
                )
            )

        gui_hooks.reviewer_did_show_question.append(guarded(shown))

    def on_will_answer(self, callback: Callable[[int, int], None]) -> None:
        def answering(ease_tuple: tuple[bool, int], _reviewer: Any, card: Any) -> None:
            proceed, ease = ease_tuple
            if proceed:
                callback(int(card.id), int(ease))

        gui_hooks.reviewer_will_answer_card.append(guarded_filter(answering))

    def on_answer_undone(self, callback: Callable[[], None]) -> None:
        def undone(changes: Any) -> None:
            # Anki names the step it took back. "Answer Card" comes in the person's language, so
            # it is compared with Anki's own label rather than with a fixed text.
            collection = self._mw.col
            if collection is not None and changes.operation == collection.tr.actions_answer_card():
                callback()

        gui_hooks.state_did_undo.append(guarded(undone))

    def on_app_active(self, callback: Callable[[bool], None]) -> None:
        application: Any = QApplication.instance()

        def changed(state: Any) -> None:
            callback(state == Qt.ApplicationState.ApplicationActive)

        application.applicationStateChanged.connect(guarded(changed))

    def later(self, work: Callable[[], None]) -> None:
        QTimer.singleShot(0, guarded(work))

    def card_state(self, card_id: int) -> tuple[int, int] | None:
        collection = self._mw.col
        if collection is None:
            return None
        return CollectionReader(collection).card_state(card_id)

    def show_tooltip(self, text: str) -> None:
        # Plain text only: names in it can never turn into markup.
        tooltip(html.escape(text).replace("\n", "<br>"), period=6000, parent=self._mw)

    def current_deck_id(self) -> int | None:
        collection = self._mw.col
        return int(collection.decks.get_current_id()) if collection is not None else None

    def open_deck_options(self, deck_id: int) -> None:
        from anki.decks import DeckId
        from aqt.deckoptions import display_options_for_deck_id

        collection = self._mw.col
        found = collection.decks.get(DeckId(deck_id), default=False) if collection else None
        if found is None or found.get("dyn"):
            raise InvalidParams("This deck no longer exists or is a filtered deck.")
        display_options_for_deck_id(DeckId(deck_id))

    def on_deck_overview(self, callback: Callable[[], None]) -> None:
        def changed(new_state: str, _old_state: str) -> None:
            if new_state == "deckBrowser":
                callback()

        gui_hooks.state_did_change.append(guarded(changed))

    def on_sync(self, starting: Callable[[], None], finished: Callable[[], None]) -> None:
        gui_hooks.sync_will_start.append(guarded(starting))
        gui_hooks.sync_did_finish.append(guarded(finished))

    def add_deck_browser_html(self, provider: Callable[[], str]) -> None:
        def add(_browser: Any, content: Any) -> None:
            content.stats += provider()

        gui_hooks.deck_browser_will_render_content.append(guarded(add))

    def refresh_deck_browser(self) -> None:
        if self._mw.state == "deckBrowser":
            self._mw.deckBrowser.refresh()

    def update_deck_browser_element(self, element_id: str, html: str) -> None:
        if self._mw.state == "deckBrowser":
            target = json.dumps(element_id)
            self._mw.deckBrowser.web.eval(
                f"document.getElementById({target}).innerHTML = {json.dumps(html)}"
            )

    def data_folder(self) -> Path:
        return Path(self._mw.pm.profileFolder()) / "statly_data"

    def on_data_replaced(self, callback: Callable[[], None]) -> None:
        gui_hooks.sync_did_finish.append(guarded(callback))
        gui_hooks.profile_will_close.append(guarded(callback))
