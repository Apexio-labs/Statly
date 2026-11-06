from __future__ import annotations

import json
import time
import zlib
from collections.abc import Callable, Mapping
from pathlib import Path
from tempfile import mkdtemp
from typing import Any, cast

import pytest
from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer

from statly.core.contract import Contract
from statly.core.module import Context, PermissionPrompt, ShownCard
from statly.core.reader import STATLY_NOTE_GUID, CollectionReader, ReadableCollection
from statly.core.rpc import Router, is_same_page
from statly.core.settings import SettingsService
from statly.core.storage import JsonStore
from statly.host.keychain import SessionSecrets
from statly.modules import MODULES
from statly.modules.mobile import MobileSync
from statly.modules.mobile.card import front_template
from statly.modules.wallpaper import HISTORY_LIMIT


class FakeRuntime:
    def __init__(self, collection: Collection | None = None) -> None:
        self.collection = collection
        self.pending: list[Callable[[], None]] = []
        self.close_after_next_query = False
        self.updating = True
        self.auto_sync = False
        self.clock = 0.0
        self.deck_refreshes = 0
        self.picked: Path | None = None
        self.dropped: Path | None = None
        self.has_share_sheet = False
        self.shared: tuple[str, str] | None = None
        self.folder = Path(mkdtemp(prefix="statly-test-"))
        self.emitted: list[tuple[str, Any]] = []
        self.secret_store = SessionSecrets()
        self.backups = 0
        # What the person clicks in Statly's own dialog. Tests that do not care allow everything.
        self.permission_answers: list[str | None] = []
        self.default_answer: str | None = "always"
        self.prompts: list[PermissionPrompt] = []
        self.during_prompt: Callable[[], None] | None = None
        self.reviewing = False
        self._deck_overviews: list[Callable[[], None]] = []
        self._syncs: list[tuple[Callable[[], None], Callable[[], None]]] = []
        self._replaced: list[Callable[[], None]] = []
        self._closing: list[Callable[[], None]] = []
        self._before_sync: list[Callable[[Any], Any]] = []
        # Real time: goals compare it with Anki's day, which follows the real clock.
        self.wall = time.time()
        self.tooltips: list[str] = []
        self.waiting_later: list[Callable[[], None]] = []
        self._states: list[Callable[[str, str], None]] = []
        self._questions: list[Callable[[ShownCard], None]] = []
        self._answers: list[Callable[[int, int], None]] = []
        self._undos: list[Callable[[], None]] = []
        self._activity: list[Callable[[bool], None]] = []

    def collection_is_open(self) -> bool:
        return self.collection is not None

    def run_query(
        self,
        work: Callable[[ReadableCollection], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        def run() -> None:
            try:
                assert self.collection is not None
                result = work(self.collection)
            except Exception as error:  # noqa: BLE001
                failed(error)
            else:
                if self.close_after_next_query:
                    self.collection = None
                done(result)

        self.pending.append(run)

    def info(self) -> Any:
        return {"statlyVersion": "1", "ankiVersion": "1", "nightMode": False, "language": "de_DE"}

    def open_external(self, url: str) -> None:
        self.opened = url

    def data_folder(self) -> Path:
        return self.folder

    def open_anki_statistics(self) -> None:
        self.statistics_opened = True

    def save_file(self, name: str, content: str) -> bool:
        self.saved = (name, content)
        return True

    def open_file(self) -> str | None:
        return None

    def create_backup(self) -> None:
        self.backups += 1

    def ask_permission(
        self, prompt: PermissionPrompt, answered: Callable[[str | None], None]
    ) -> None:
        self.prompts.append(prompt)
        if self.during_prompt is not None:
            self.during_prompt()
        answer = self.permission_answers.pop(0) if self.permission_answers else self.default_answer
        offered = {choice for choice, _label in prompt.choices}
        answered(answer if answer in offered else None)

    def is_reviewing(self) -> bool:
        return self.reviewing

    def run_collection_op(
        self,
        work: Callable[[Any], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        assert self.collection is not None
        try:
            result = work(self.collection)
        except Exception as error:  # noqa: BLE001
            failed(error)
        else:
            done(result)

    def run_collection_write(
        self,
        work: Callable[[Any], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        assert self.collection is not None
        done(work(self.collection))

    def write_before_sync(self, work: Callable[[Any], Any]) -> None:
        self._before_sync.append(work)

    def before_sync(self, collection: Any) -> Any:
        """Run what waits for the next sync, in order, as Anki's worker would."""
        found: Any = None
        waiting, self._before_sync = self._before_sync, []
        for work in waiting:
            found = work(collection)
        return found

    def syncs_on_start(self) -> bool:
        return self.auto_sync

    def monotonic(self) -> float:
        self.clock += 1000
        return self.clock

    def on_deck_overview(self, callback: Callable[[], None]) -> None:
        self._deck_overviews.append(callback)

    def deck_overview(self) -> None:
        """Anki shows its deck list: every module that listens hears it, as in Anki."""
        for callback in self._deck_overviews:
            callback()

    def on_sync(self, starting: Callable[[], None], finished: Callable[[], None]) -> None:
        self._syncs.append((starting, finished))

    def sync_starting(self) -> None:
        for starting, _finished in self._syncs:
            starting()

    def sync_finished(self) -> None:
        for _starting, finished in self._syncs:
            finished()

    def pick_path(self, file_filter: str) -> Path | None:
        return self.picked

    def run_task(
        self,
        work: Callable[[], Any],
        done: Callable[[Any], None],
        failed: Callable[[Exception], None],
    ) -> None:
        try:
            result = work()
        except Exception as error:  # noqa: BLE001
            failed(error)
        else:
            done(result)

    def run_on_main(self, work: Callable[[], None]) -> None:
        work()

    def wall_clock(self) -> float:
        return self.wall

    def on_state_changed(self, callback: Callable[[str, str], None]) -> None:
        self._states.append(callback)

    def change_state(self, new_state: str, old_state: str) -> None:
        self.reviewing = new_state == "review"
        for callback in self._states:
            callback(new_state, old_state)

    def on_question_shown(self, callback: Callable[[ShownCard], None]) -> None:
        self._questions.append(callback)

    def show_question(self, card: ShownCard) -> None:
        for callback in self._questions:
            callback(card)

    def on_will_answer(self, callback: Callable[[int, int], None]) -> None:
        self._answers.append(callback)

    def press(self, card_id: int, ease: int) -> None:
        for callback in self._answers:
            callback(card_id, ease)

    def on_answer_undone(self, callback: Callable[[], None]) -> None:
        self._undos.append(callback)

    def undo_answer(self) -> None:
        for callback in self._undos:
            callback()

    def on_app_active(self, callback: Callable[[bool], None]) -> None:
        self._activity.append(callback)

    def set_active(self, active: bool) -> None:
        for callback in self._activity:
            callback(active)

    def later(self, work: Callable[[], None]) -> None:
        self.waiting_later.append(work)

    def run_later(self) -> None:
        while self.waiting_later:
            self.waiting_later.pop(0)()

    def card_state(self, card_id: int) -> tuple[int, int] | None:
        if self.collection is None:
            return None
        return CollectionReader(cast(ReadableCollection, self.collection)).card_state(card_id)

    def show_tooltip(self, text: str) -> None:
        self.tooltips.append(text)

    def current_deck_id(self) -> int | None:
        if self.collection is None:
            return None
        return int(self.collection.decks.get_current_id())

    def open_deck_options(self, deck_id: int) -> None:
        self.opened_options = deck_id

    def thumbnail(self, image: bytes, side: int) -> str | None:
        return "data:image/jpeg;base64,AAAA" if image else None

    def emit(self, event: str, payload: Any) -> None:
        self.emitted.append((event, payload))

    @property
    def secrets(self) -> SessionSecrets:
        return self.secret_store

    def profile_keys(self) -> list[str]:
        return ["profile", "other"]

    def profile_key(self) -> str:
        return "profile"

    def on_profile_opened(self, callback: Callable[[], None]) -> None:
        self.profile_opened = callback

    def on_profile_closing(self, callback: Callable[[], None]) -> None:
        self._closing.append(callback)

    def profile_closing(self) -> None:
        for callback in self._closing:
            callback()

    def set_unsaved(self, message: str | None) -> None:
        self.unsaved = message

    def on_uninstalling(self, callback: Callable[[], None]) -> None:
        self.uninstalling = callback

    def convert_video(self, source: Path, target: Path) -> None:
        target.write_bytes(source.read_bytes())

    def media_folder(self) -> Path:
        return self.folder / "media"

    def shared_media_url(self, file_name: str) -> str:
        return f"/_addons/statly/{file_name}"

    def media_url(self, file_name: str) -> str:
        return file_name

    def save_binary(self, name: str, content: bytes, file_filter: str) -> bool:
        return True

    def begin_shortcut_recording(self) -> None:
        self.recording = True

    def end_shortcut_recording(self) -> None:
        self.recording = False

    def auto_update(self) -> bool:
        return self.updating

    def set_auto_update(self, enabled: bool) -> None:
        self.updating = enabled

    def uninstall(self, done: Callable[[bool], None]) -> None:
        done(False)

    def take_dropped_file(self) -> Path | None:
        dropped, self.dropped = self.dropped, None
        return dropped

    def share(self, text: str, url: str, anchor: Mapping[str, float]) -> bool:
        self.shared = (text, url)
        return self.has_share_sheet

    def shortcut_conflict(self, action: str, keys: str) -> str | None:
        return "Quit" if keys == "Ctrl+Q" else None

    def apply_shortcuts(self, shortcuts: Mapping[str, object]) -> None:
        self.shortcuts = shortcuts

    def add_deck_browser_html(self, provider: Callable[[], str]) -> None:
        self.deck_html = provider

    def refresh_deck_browser(self) -> None:
        self.deck_refreshes += 1

    def update_deck_browser_element(self, element_id: str, html: str) -> None:
        self.deck_element = (element_id, html)

    def on_data_replaced(self, callback: Callable[[], None]) -> None:
        self._replaced.append(callback)

    def replaced(self) -> None:
        for callback in self._replaced:
            callback()


def make_context(runtime: FakeRuntime) -> Context:
    router = Router(Contract(), runtime, check_results=True)
    settings = SettingsService(JsonStore(runtime.data_folder), router.contract)
    context = Context(router=router, host=runtime, contract=router.contract, settings=settings)
    for module in MODULES:
        module.register(context)
    return context


def make_router(runtime: FakeRuntime) -> Router:
    return make_context(runtime).router


def drain(runtime: FakeRuntime) -> None:
    """Run every query that waits for Anki's worker, including the ones they start."""
    while runtime.pending:
        runtime.pending.pop(0)()


def call(router: Router, method: str, params: Any, request_id: int = 1) -> list[dict[str, Any]]:
    responses: list[dict[str, Any]] = []
    raw = json.dumps({"id": request_id, "method": method, "params": params})
    router.handle(raw, responses.append)
    return responses


def error_code(responses: list[dict[str, Any]]) -> str:
    assert len(responses) == 1
    assert responses[0]["ok"] is False
    return responses[0]["error"]["code"]


def test_every_contract_method_has_a_handler() -> None:
    assert make_router(FakeRuntime()).missing_methods() == set()


def test_local_call_returns_valid_result() -> None:
    responses = call(make_router(FakeRuntime()), "system.ping", {"nonce": "abc"}, request_id=7)
    assert responses == [{"id": 7, "ok": True, "result": {"nonce": "abc"}}]


def test_query_runs_on_the_worker_and_answers_later(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    responses = call(make_router(runtime), "system.collectionSummary", {})
    assert responses == []
    runtime.pending.pop()()
    assert responses == [{"id": 1, "ok": True, "result": {"cards": 3, "reviews": 1}}]


def test_queries_run_one_at_a_time_in_order(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    router = make_router(runtime)
    responses: list[dict[str, Any]] = []
    for request_id in (1, 2, 3):
        raw = json.dumps({"id": request_id, "method": "system.collectionSummary", "params": {}})
        router.handle(raw, responses.append)

    answered: list[int] = []
    while runtime.pending:
        assert len(runtime.pending) == 1
        runtime.pending.pop()()
        answered = [response["id"] for response in responses]
    assert answered == [1, 2, 3]


def test_waiting_queries_fail_cleanly_if_the_collection_closes(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    runtime.close_after_next_query = True
    router = make_router(runtime)
    responses: list[dict[str, Any]] = []
    for request_id in (1, 2):
        raw = json.dumps({"id": request_id, "method": "system.collectionSummary", "params": {}})
        router.handle(raw, responses.append)

    runtime.pending.pop()()

    assert responses[0]["ok"] is True
    assert error_code(responses[1:]) == "collection_unavailable"


def test_query_fails_cleanly_while_the_collection_is_closed() -> None:
    responses = call(make_router(FakeRuntime()), "system.collectionSummary", {})
    assert error_code(responses) == "collection_unavailable"


@pytest.mark.parametrize("raw", ["not json", "[]", "{}", '{"id": 1}', '{"id": "1", "method": "x"}'])
def test_malformed_requests_get_an_error_answer(raw: str) -> None:
    responses: list[dict[str, Any]] = []
    make_router(FakeRuntime()).handle(raw, responses.append)
    assert error_code(responses) == "bad_request"


def test_unknown_method() -> None:
    assert error_code(call(make_router(FakeRuntime()), "system.nope", {})) == "unknown_method"


def test_params_are_checked_against_the_contract() -> None:
    responses = call(make_router(FakeRuntime()), "system.ping", {"nonce": 1})
    assert error_code(responses) == "invalid_params"
    responses = call(make_router(FakeRuntime()), "system.ping", {"nonce": "a", "extra": 1})
    assert error_code(responses) == "invalid_params"


def test_unexpected_failures_never_leak_details() -> None:
    runtime = FakeRuntime()
    router = Router(Contract(), runtime)

    def explode(_params: Any) -> Any:
        raise RuntimeError("secret path /Users/someone")

    router.local("system.ping", explode)
    responses = call(router, "system.ping", {"nonce": "a"})
    assert error_code(responses) == "internal"
    assert "secret" not in responses[0]["error"]["message"]


@pytest.mark.parametrize(
    "url", ["javascript:alert(1)", "file:///etc/passwd", "anki://x", "nothing"]
)
def test_only_web_links_can_be_opened(url: str) -> None:
    runtime = FakeRuntime()
    assert error_code(call(make_router(runtime), "system.openExternal", {"url": url})) == (
        "not_allowed"
    )
    assert not hasattr(runtime, "opened")


def test_web_links_open() -> None:
    runtime = FakeRuntime()
    url = "https://example.com/"
    assert call(make_router(runtime), "system.openExternal", {"url": url})[0]["ok"] is True
    assert runtime.opened == url


def test_handlers_must_be_in_the_contract() -> None:
    router = Router(Contract(), FakeRuntime())
    with pytest.raises(ValueError, match="not in the contract"):
        router.local("system.unknown", lambda _params: None)


def test_shortcut_conflicts_are_reported_not_saved() -> None:
    runtime = FakeRuntime()
    router = make_router(runtime)
    params = {"action": "library", "keys": "Ctrl+Q"}
    result = call(router, "shortcuts.set", params)[0]["result"]
    assert result["conflict"] == "Quit"
    assert result["settings"]["shortcuts"]["library"] == ""


def test_saving_a_shortcut_ends_recording() -> None:
    runtime = FakeRuntime()
    router = make_router(runtime)
    call(router, "shortcuts.beginRecording", {})
    assert runtime.recording is True
    call(router, "shortcuts.set", {"action": "library", "keys": "Ctrl+L"})
    assert runtime.recording is False


def test_a_conflict_also_ends_recording() -> None:
    runtime = FakeRuntime()
    router = make_router(runtime)
    call(router, "shortcuts.beginRecording", {})
    call(router, "shortcuts.set", {"action": "library", "keys": "Ctrl+Q"})
    assert runtime.recording is False


def tiny_png(folder: Path) -> Path:
    def chunk(kind: bytes, data: bytes) -> bytes:
        checksum = zlib.crc32(kind + data).to_bytes(4, "big")
        return len(data).to_bytes(4, "big") + kind + data + checksum

    header = (1).to_bytes(4, "big") * 2 + bytes([8, 0, 0, 0, 0])
    content = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00\x7f"))
        + chunk(b"IEND", b"")
    )
    path = folder / "picture.png"
    path.write_bytes(content)
    return path


def test_a_new_wallpaper_redraws_the_deck_overview_even_if_settings_match() -> None:
    """Reported bug: replacing an image changed nothing until the switch was toggled."""
    runtime = FakeRuntime()
    runtime.picked = tiny_png(runtime.folder)
    router = make_router(runtime)
    call(router, "wallpaper.choose", {})
    first = runtime.deck_refreshes
    call(router, "wallpaper.choose", {})
    assert runtime.deck_refreshes > first


def test_a_chosen_file_is_stored_kept_and_shown_on_the_deck_overview() -> None:
    runtime = FakeRuntime()
    runtime.picked = tiny_png(runtime.folder)
    router = make_router(runtime)
    result = call(router, "wallpaper.choose", {})[0]["result"]["wallpaper"]
    assert result["source"] == "image"
    assert result["enabled"] is True
    assert result["deckOverview"] is True
    assert result["asset"]["type"] == "image/png"
    assert any(path.stem == result["asset"]["id"] for path in runtime.media_folder().iterdir())
    assert f"/_addons/statly/{result['asset']['id']}.png" in runtime.deck_html()


def tiny_pngs(folder: Path, count: int) -> list[Path]:
    """Pictures that differ, because files are stored under the hash of their content."""
    paths: list[Path] = []
    for index in range(count):
        path = folder / f"picture-{index}.png"
        content = bytearray(tiny_png(folder).read_bytes())
        # The pixel row holds the gray value, so each file gets its own IDAT chunk and CRC.
        compressed = zlib.compress(bytes([0, index]))
        start = content.index(b"IDAT") - 4
        end = start + 12 + int.from_bytes(content[start : start + 4], "big")
        chunk = len(compressed).to_bytes(4, "big") + b"IDAT" + compressed
        chunk += zlib.crc32(b"IDAT" + compressed).to_bytes(4, "big")
        path.write_bytes(bytes(content[:start]) + chunk + bytes(content[end:]))
        paths.append(path)
    return paths


def test_removing_a_wallpaper_keeps_it_in_the_history() -> None:
    runtime = FakeRuntime()
    runtime.picked = tiny_png(runtime.folder)
    router = make_router(runtime)
    chosen = call(router, "wallpaper.choose", {})[0]["result"]["wallpaper"]["asset"]
    result = call(router, "wallpaper.remove", {})[0]["result"]["wallpaper"]
    assert (result["source"], result["asset"], result["enabled"]) == ("none", None, False)
    assert result["history"] == [chosen]
    assert len(list(runtime.media_folder().iterdir())) == 1
    back = call(router, "wallpaper.use", {"id": chosen["id"]})[0]["result"]["wallpaper"]
    assert (back["source"], back["asset"], back["enabled"]) == ("image", chosen, True)


def test_the_history_keeps_the_newest_and_deletes_the_rest() -> None:
    runtime = FakeRuntime()
    router = make_router(runtime)
    result: dict[str, Any] = {}
    for path in tiny_pngs(runtime.folder, HISTORY_LIMIT + 2):
        runtime.picked = path
        result = call(router, "wallpaper.choose", {})[0]["result"]["wallpaper"]
    assert len(result["history"]) == HISTORY_LIMIT
    assert result["history"][0] == result["asset"]
    assert len(list(runtime.media_folder().iterdir())) == HISTORY_LIMIT


def test_forgetting_deletes_the_file_and_the_current_choice() -> None:
    runtime = FakeRuntime()
    router = make_router(runtime)
    first, second = tiny_pngs(runtime.folder, 2)
    runtime.picked = first
    old = call(router, "wallpaper.choose", {})[0]["result"]["wallpaper"]["asset"]
    runtime.picked = second
    new = call(router, "wallpaper.choose", {})[0]["result"]["wallpaper"]["asset"]

    result = call(router, "wallpaper.forget", {"id": old["id"]})[0]["result"]["wallpaper"]
    assert result["history"] == [new]
    assert result["asset"] == new
    result = call(router, "wallpaper.forget", {"id": new["id"]})[0]["result"]["wallpaper"]
    assert (result["source"], result["asset"], result["history"]) == ("none", None, [])
    assert list(runtime.media_folder().iterdir()) == []


def test_a_dropped_file_is_used_once() -> None:
    runtime = FakeRuntime()
    runtime.dropped = tiny_png(runtime.folder)
    router = make_router(runtime)
    assert call(router, "wallpaper.dropped", {})[0]["result"]["wallpaper"]["source"] == "image"
    assert runtime.dropped is None


def test_nothing_dropped_changes_nothing() -> None:
    router = make_router(FakeRuntime())
    assert call(router, "wallpaper.dropped", {})[0]["result"]["wallpaper"]["source"] == "none"


def test_an_image_from_an_older_version_moves_over_once() -> None:
    runtime = FakeRuntime()
    router = Router(Contract(), runtime, check_results=True)
    settings = SettingsService(JsonStore(runtime.data_folder), router.contract)
    context = Context(router=router, host=runtime, contract=router.contract, settings=settings)
    for module in MODULES:
        module.register(context)
    old = runtime.data_folder() / "wallpaper.jpg"
    old.parent.mkdir(parents=True, exist_ok=True)
    old.write_bytes(tiny_png(runtime.folder).read_bytes())
    wallpaper = {**settings.get()["wallpaper"], "source": "image", "enabled": True}
    settings.update(cast(Any, {"wallpaper": wallpaper}))
    context.services["wallpaper"].adopt_old_image()
    adopted = settings.get()["wallpaper"]
    assert adopted["asset"] is not None
    assert adopted["history"] == [adopted["asset"]]
    assert not old.exists()


def test_a_wallpaper_stays_when_unused_media_is_cleaned_up() -> None:
    runtime = FakeRuntime()
    runtime.picked = tiny_png(runtime.folder)
    router = Router(Contract(), runtime, check_results=True)
    settings = SettingsService(JsonStore(runtime.data_folder), router.contract)
    context = Context(router=router, host=runtime, contract=router.contract, settings=settings)
    for module in MODULES:
        module.register(context)
    call(router, "wallpaper.choose", {})
    context.services["widgets"].remove_unused_media()
    assert len(list(runtime.media_folder().iterdir())) == 1


def test_sharing_uses_the_sheet_or_says_it_used_the_clipboard() -> None:
    runtime = FakeRuntime()
    router = make_router(runtime)
    params = {
        "text": "Statly",
        "url": "https://ankiweb.net/shared/info/215470814",
        "anchor": {"x": 1, "y": 2, "width": 3, "height": 4},
    }
    assert call(router, "system.share", params)[0]["result"] == {"method": "clipboard"}
    runtime.has_share_sheet = True
    assert call(router, "system.share", params)[0]["result"] == {"method": "sheet"}
    assert runtime.shared == ("Statly", params["url"])


def test_only_web_links_can_be_shared() -> None:
    router = make_router(FakeRuntime())
    params = {
        "text": "Statly",
        "url": "file:///etc/passwd",
        "anchor": {"x": 1, "y": 2, "width": 3, "height": 4},
    }
    assert call(router, "system.share", params)[0]["ok"] is False


def test_free_shortcuts_are_saved_and_applied() -> None:
    runtime = FakeRuntime()
    router = make_router(runtime)
    result = call(router, "shortcuts.set", {"action": "library", "keys": "Ctrl+L"})[0]["result"]
    assert result["settings"]["shortcuts"]["library"] == "Ctrl+L"
    assert runtime.shortcuts["library"] == "Ctrl+L"


def test_setting_up_the_phone_card_makes_a_backup_first(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    router = make_router(runtime)
    assert call(router, "mobile.status", {})[0]["result"]["enabled"] is False

    status = call(router, "mobile.enable", {})[0]["result"]

    assert status["enabled"] is True
    assert runtime.backups == 1
    assert collection.decks.id_for_name("Statly Dashboard") is not None

    assert call(router, "mobile.disable", {})[0]["result"]["enabled"] is False
    assert collection.decks.id_for_name("Statly Dashboard") is None


def test_nothing_is_written_while_the_phone_card_is_off(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    make_router(runtime)
    before = collection.mod
    runtime.deck_overview()
    runtime.sync_starting()
    assert collection.mod == before
    assert runtime._before_sync == []  # pyright: ignore[reportPrivateUsage]


def test_the_bridge_recognizes_only_the_apps_own_page() -> None:
    home = "http://127.0.0.1:4000/_addons/statly/web/index.html#/"
    assert is_same_page("http://127.0.0.1:4000/_addons/statly/web/index.html#/settings", home)
    assert not is_same_page("http://127.0.0.1:4000/_addons/other/web/index.html", home)
    assert not is_same_page("http://127.0.0.1:4001/_addons/statly/web/index.html", home)
    assert not is_same_page("https://example.com/_addons/statly/web/index.html", home)
    assert not is_same_page("file:///tmp/index.html", home)


def test_removing_the_card_makes_a_backup_first(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    router = make_router(runtime)
    call(router, "mobile.enable", {})
    backups = runtime.backups
    call(router, "mobile.disable", {})
    assert runtime.backups == backups + 1


def test_the_local_connection_starts_with_the_profile(collection: Collection) -> None:
    """Without this the switch stays on after a restart while nothing listens anymore."""
    runtime = FakeRuntime(collection)
    router = make_router(runtime)
    call(router, "ai.newExternalCode", {})
    runtime.profile_closing()
    assert call(router, "ai.status", {})[0]["result"]["external"]["running"] is False

    runtime.profile_opened()

    assert call(router, "ai.status", {})[0]["result"]["external"]["running"] is True
    runtime.profile_closing()


def test_writes_wait_for_the_first_sync_of_a_session(collection: Collection) -> None:
    """Before it, the collection may be behind a newer card from another device."""
    runtime = FakeRuntime(collection)
    router = make_router(runtime)
    call(router, "mobile.enable", {})
    sync = next(
        starting.__self__  # type: ignore[attr-defined]
        for starting, _finished in runtime._syncs  # pyright: ignore[reportPrivateUsage]
        if isinstance(getattr(starting, "__self__", None), MobileSync)
    )
    sync._saw_first_sync = False
    runtime.auto_sync = True

    runtime.sync_starting()
    assert runtime._before_sync == []  # pyright: ignore[reportPrivateUsage]

    runtime.sync_finished()
    runtime.sync_starting()
    assert runtime.before_sync(collection) is False


def test_an_unchanged_dashboard_writes_nothing(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    router = make_router(runtime)
    call(router, "mobile.enable", {})
    modified = collection.mod
    runtime.deck_overview()
    assert collection.mod == modified


def test_a_card_damaged_on_a_phone_is_repaired_right_after_the_sync(
    collection: Collection,
) -> None:
    """Nothing on the dashboard changed here, so only the check itself can notice."""
    runtime = FakeRuntime(collection)
    router = make_router(runtime)
    call(router, "mobile.enable", {})
    runtime.deck_overview()
    database: Any = collection.db
    note = collection.get_note(
        database.scalar("select id from notes where guid = ?", STATLY_NOTE_GUID)
    )
    notetype: Any = note.note_type()
    notetype["tmpls"][0]["qfmt"] = "broken"
    collection.models.update_dict(notetype, skip_checks=True)

    runtime.sync_finished()
    runtime.deck_overview()

    repaired: Any = collection.get_note(note.id).note_type()
    assert repaired["tmpls"][0]["qfmt"] == front_template()


def test_a_new_review_updates_the_card(collection: Collection) -> None:
    runtime = FakeRuntime(collection)
    router = make_router(runtime)
    call(router, "mobile.enable", {})
    scheduler: Any = collection.sched
    collection.decks.select(collection.decks.id("Test"))  # type: ignore[arg-type]
    card = scheduler.getCard()
    states = collection._backend.get_scheduling_states(card.id)
    scheduler.answer_card(scheduler.build_answer(card=card, states=states, rating=CardAnswer.GOOD))
    before = call(router, "mobile.status", {})[0]["result"]["updated"]
    runtime.deck_overview()
    assert collection.undo_status().undo == "Answer Card"
    assert call(router, "mobile.status", {})[0]["result"]["updated"] >= before
