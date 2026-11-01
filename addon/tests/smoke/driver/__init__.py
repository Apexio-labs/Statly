"""Test add-on: drives the real Statly window inside real Anki and records what happens."""

from __future__ import annotations

import gc
import json
import os
import subprocess
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import aqt
from aqt import gui_hooks, mw
from aqt.qt import QApplication, QEvent, QFileDialog, QImage, Qt, QTimer
from aqt.sound import cleanup_audio
from PyQt6.QtTest import QTest

OUT = Path(os.environ["STATLY_SMOKE_OUT"])
SCREENSHOTS = (
    Path(os.environ["STATLY_SMOKE_SCREENSHOTS"])
    if "STATLY_SMOKE_SCREENSHOTS" in os.environ
    else None
)
SETTLE_MS = 1500 if SCREENSHOTS else 200
RECORD_RESPONSES = """
window.__smoke = [];
const original = window.__statlyBridge.resolve.bind(window.__statlyBridge);
window.__statlyBridge.resolve = (response) => {
  window.__smoke.push(response);
  original(response);
};
"""
READ_PAGE = """JSON.stringify({
  text: document.body.innerText,
  theme: document.documentElement.dataset.theme,
  scripts: document.scripts.length,
  logoLoaded: [...document.images].every((image) => image.naturalWidth > 0),
  smoke: window.__smoke ?? null,
  widgets: document.querySelectorAll('[data-widget-id]').length,
})"""
results: dict[str, Any] = {}


def finish() -> None:
    OUT.write_text(json.dumps(results, indent=2), encoding="utf-8")
    # os._exit skips Anki's shutdown, which would leave its audio helper running.
    cleanup_audio()
    os._exit(0)


def step(callback: Any) -> Any:
    def wrapper(*args: Any) -> None:
        try:
            callback(*args)
        except BaseException:  # noqa: BLE001
            results["failure"] = traceback.format_exc()
            finish()

    return wrapper


def later(milliseconds: int, callback: Any) -> None:
    QTimer.singleShot(milliseconds, step(callback))


def window() -> Any:
    return aqt.dialogs._dialogs["statly"][1]


def read_page(callback: Any) -> None:
    window().web.evalWithCallback(READ_PAGE, step(lambda value: callback(json.loads(value))))


def call_from_page(request_id: int, method: str, params: dict[str, Any] | None = None) -> None:
    request = json.dumps({"id": request_id, "method": method, "params": params or {}})
    window().web.eval(f"pycmd({json.dumps('statly:' + request)})")


def start() -> None:
    results["anki"] = mw.col.sched.today is not None
    prepare_settings()
    mw.toolbar.web.evalWithCallback(
        "document.getElementById('stats').textContent.trim()",
        step(lambda text: results.__setitem__("toolbar_link", text == "Statly")),
    )
    results["menu"] = "Statly" in [a.text() for a in mw.form.menubar.actions()]
    aqt.dialogs.open("statly")
    wait_for_app(40)


def prepare_settings() -> None:
    """Skip the first-run dialog and switch on everything the deck overview can show."""
    folder = Path(mw.pm.profileFolder()) / "statly_data"
    folder.mkdir(exist_ok=True)
    settings = {
        "onboardingDone": True,
        "deckHeatmap": True,
        "counterColorsEnabled": True,
        "wallpaper": {
            "enabled": True,
            "source": "aero",
            "blur": 0,
            "overlay": 0,
            "position": "center",
            "textColor": "light",
        },
    }
    (folder / "settings.json").write_text(json.dumps(settings), encoding="utf-8")
    mw.deckBrowser.refresh()


READ_DECK_OVERVIEW = """JSON.stringify({
  heatmap: document.querySelector('#statly-deck-heatmap .statly-heatmap') !== null,
  styles: [...document.querySelectorAll('style')].map((style) => style.textContent).join(''),
})"""


def check_deck_overview() -> None:
    def check(value: str) -> None:
        page = json.loads(value)
        results["deck_heatmap"] = page["heatmap"]
        results["deck_wallpaper"] = "radial-gradient" in page["styles"]
        results["deck_counters"] = ".new-count{color:#0071D3" in page["styles"]
        record_shortcut()

    mw.deckBrowser.web.evalWithCallback(READ_DECK_OVERVIEW, step(check))


def wait_for_app(attempts: int) -> None:
    def check(page: dict[str, Any]) -> None:
        connected = "Study time" in page["text"] or "Lernzeit" in page["text"]
        if connected:
            results["first_page"] = page
            later(SETTLE_MS, take_screenshots)
        elif attempts == 0:
            results["failure"] = f"App never connected: {page}"
            finish()
        else:
            later(250, lambda: wait_for_app(attempts - 1))

    read_page(check)


def take_screenshots() -> None:
    if SCREENSHOTS is None:
        press_escape()
        return
    window().resize(1440, 900)
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)

    def capture(name: str, script: str, then: Any) -> None:
        window().web.eval(script)

        def save() -> None:
            window().web.grab().save(str(SCREENSHOTS / f"{name}.png"))
            then()

        later(SETTLE_MS, save)

    def edit_page() -> None:
        capture(
            "edit",
            "[...document.querySelectorAll('button')]"
            ".find((b) => /^(Edit|Bearbeiten)$/.test(b.textContent)).click()",
            settings_page,
        )

    def settings_page() -> None:
        capture(
            "cancel",
            "[...document.querySelectorAll('button')]"
            ".find((b) => /^(Cancel|Abbrechen)$/.test(b.textContent)).click()",
            library_page,
        )

    def library_page() -> None:
        capture("library", "location.hash = '#/library'", settings_page2)

    def settings_page2() -> None:
        capture("settings", "location.hash = '#/settings/wallpaper'", editor_page)

    def editor_page() -> None:
        capture("editor-new", "location.hash = '#/library/widgets/new'", editor_template)

    def editor_template() -> None:
        capture(
            "editor",
            "[...document.querySelectorAll('button')]"
            ".find((b) => /^(Streak|Serie)$/.test(b.textContent)).click()",
            deck_overview,
        )

    def deck_overview() -> None:
        mw.deckBrowser.web.grab().save(str(SCREENSHOTS / "anki.png"))
        capture("back", "location.hash = '#/'", press_escape)

    later(SETTLE_MS, lambda: capture("dashboard", "void 0", edit_page))


def press_escape() -> None:
    window().web.onEsc()
    results["window_survives_escape"] = window() is not None and window().isVisible()
    window().web.eval(RECORD_RESPONSES)
    later(100, collection_closed)


def collection_closed() -> None:
    collection = mw.col
    mw.col = None
    call_from_page(901, "system.collectionSummary")

    def restore() -> None:
        mw.col = collection
        call_from_page(902, "system.collectionSummary")
        call_from_page(903, "statistics.heatmap", {"year": None, "deckId": None})
        call_from_page(904, "statistics.forecast", {"deckId": None})
        later(800, check_answers)

    later(300, restore)


def check_answers() -> None:
    def check(page: dict[str, Any]) -> None:
        results["while_closed"] = page["smoke"][0]
        results["after_reopen"] = page["smoke"][1]
        results["statistics"] = page["smoke"][2:]
        mw.deckBrowser.refresh()
        later(1500, check_deck_overview)

    read_page(check)


def record_shortcut() -> None:
    """While recording, pressing a taken shortcut must not run its action."""
    add_ons = "Ctrl+Shift+A"
    call_from_page(905, "shortcuts.beginRecording")

    def press() -> None:
        target = mw.form.actionAdd_ons
        fired: list[bool] = []
        target.triggered.connect(lambda: fired.append(True))
        app: Any = QApplication.instance()
        app.sendEvent(app, QEvent(QEvent.Type.Quit))
        results["survived_quit_while_recording"] = True
        results["silenced"] = target.shortcut().isEmpty()
        QTest.keyClick(
            window(),
            Qt.Key.Key_A,
            Qt.KeyboardModifier.ControlModifier | Qt.KeyboardModifier.ShiftModifier,
        )
        results["action_fired_while_recording"] = bool(fired)
        call_from_page(906, "shortcuts.set", {"action": "library", "keys": add_ons})
        later(300, check_recording)

    def check_recording() -> None:
        def check(page: dict[str, Any]) -> None:
            answer = next(r for r in page["smoke"] if r["id"] == 906)
            results["conflict"] = answer["result"]["conflict"]
            results["restored"] = not mw.form.actionAdd_ons.shortcut().isEmpty()
            import_dashboard()

        read_page(check)

    later(200, press)


def import_dashboard() -> None:
    """The Import button uses a native dialog, answered here with a real file."""
    source = OUT.parent / "import.json"
    source.write_text(
        json.dumps(
            {
                "format": "statly-dashboard",
                "version": 4,
                "layout": {
                    "widgets": [{"id": "only", "type": "due-cards", "x": 0, "y": 0, "w": 3, "h": 4}]
                },
            }
        ),
        encoding="utf-8",
    )
    QFileDialog.getOpenFileName = lambda *args, **kwargs: (str(source), "")  # type: ignore
    window().web.eval("location.hash = '#/?import=1'")

    def check() -> None:
        def seen(page: dict[str, Any]) -> None:
            results["imported_widgets"] = page["widgets"]
            widget_flow()

        read_page(seen)

    later(900, check)


def custom_widget(asset: dict[str, str]) -> dict[str, Any]:
    return {
        "id": "smoke",
        "name": "Smoke",
        "description": "",
        "size": {"w": 4, "h": 6},
        "background": {"kind": "media", "asset": asset, "fit": "cover", "shade": 0.2},
        "elements": [
            {
                "id": "e1",
                "kind": "metric",
                "x": 5,
                "y": 5,
                "w": 80,
                "h": 30,
                "opacity": 1,
                "size": 20,
                "bold": True,
                "align": "left",
                "color": "#ffffff",
                "source": "reviews",
                "range": "last30",
            }
        ],
    }


def answer(page: dict[str, Any], request_id: int) -> dict[str, Any]:
    return next(item for item in page["smoke"] if item["id"] == request_id)


def widget_flow() -> None:
    """A real image goes in, and the widget survives an export and an import."""
    picture = OUT.parent / "picture.png"
    image = QImage(32, 32, QImage.Format.Format_RGB32)
    image.fill(0x087F8C)
    image.save(str(picture))
    package = OUT.parent / "smoke.statlywidget"
    QFileDialog.getOpenFileName = lambda *args, **kwargs: (str(picture), "")  # type: ignore
    QFileDialog.getSaveFileName = lambda *args, **kwargs: (str(package), "")  # type: ignore
    window().web.eval(RECORD_RESPONSES)
    call_from_page(907, "widgets.addMedia")

    def save(page: dict[str, Any]) -> None:
        asset = answer(page, 907)["result"]["asset"]
        call_from_page(908, "widgets.save", {"widget": custom_widget(asset)})
        call_from_page(909, "widgets.export", {"id": "smoke"})
        call_from_page(910, "widgets.media", {"id": asset["id"]})
        later(400, reimport)

    def reimport() -> None:
        QFileDialog.getOpenFileName = lambda *args, **kwargs: (str(package), "")  # type: ignore
        call_from_page(911, "widgets.import")

        def list_widgets() -> None:
            call_from_page(912, "widgets.list")
            later(300, lambda: read_page(check))

        later(600, list_widgets)

    def check(page: dict[str, Any]) -> None:
        results["widget_saved"] = answer(page, 908)["ok"]
        results["widget_exported"] = answer(page, 909)["result"]["saved"] and package.is_file()
        results["widget_media"] = answer(page, 910)["result"]["url"].endswith(".png")
        imported = answer(page, 911)["result"]["widget"]
        results["widget_imported"] = imported["id"] != "smoke" and imported["name"] == "Smoke"
        results["widgets_listed"] = len(answer(page, 912)["result"])
        video_flow()

    later(300, lambda: read_page(save))


def video_flow() -> None:
    """With a sample video, checks that a file Anki's browser cannot play ends up playing."""
    sample = os.environ.get("STATLY_SMOKE_VIDEO")
    if not sample:
        phone_card()
        return
    QFileDialog.getOpenFileName = lambda *args, **kwargs: (sample, "")  # type: ignore
    call_from_page(913, "widgets.addMedia")

    def wait(attempts: int) -> None:
        def check(page: dict[str, Any]) -> None:
            done = [item for item in page["smoke"] if item["id"] == 913]
            if done:
                play(done[0])
            elif attempts == 0:
                results["failure"] = "The video was never converted."
                finish()
            else:
                later(500, lambda: wait(attempts - 1))

        read_page(check)

    def play(response: dict[str, Any]) -> None:
        results["video_asset"] = response
        asset = response["result"]["asset"]
        call_from_page(914, "widgets.media", {"id": asset["id"]})

        def probe(page: dict[str, Any]) -> None:
            url = answer(page, 914)["result"]["url"]
            results["video_url"] = url
            window().web.eval(
                "window.__video = document.createElement('video');"
                "window.__video.muted = true;"
                f"window.__video.src = {json.dumps(url)};"
                "window.__video.play().catch((error) => { window.__videoError = String(error); });"
            )
            later(1500, report)

        def report() -> None:
            window().web.evalWithCallback(
                "JSON.stringify({ready: window.__video.readyState, "
                "width: window.__video.videoWidth, time: window.__video.currentTime, "
                "error: window.__videoError ?? null})",
                step(lambda value: (results.__setitem__("video", json.loads(value)), phone_card())),
            )

        later(300, lambda: read_page(probe))

    wait(60)


def phone_card() -> None:
    """The one writing feature, through the real worker and a real backup."""
    call_from_page(915, "mobile.enable")

    def check_enabled() -> None:
        deck = mw.col.decks.id_for_name("Statly Dashboard")
        results["phone_deck"] = deck is not None
        results["phone_card_cards"] = mw.col.decks.card_count(deck, include_subdecks=False)
        backups = list(Path(mw.pm.backupFolder()).glob("*.colpkg"))
        results["phone_backup"] = len(backups) > 0
        call_from_page(916, "mobile.disable")
        later(1500, check_disabled)

    def check_disabled() -> None:
        results["phone_removed"] = mw.col.decks.id_for_name("Statly Dashboard") is None
        ai_flow()

    later(3000, check_enabled)


def chunk(payload: dict[str, Any]) -> bytes:
    return f"data: {json.dumps({'choices': [payload]})}\n\n".encode()


def tool_call(name: str, arguments: dict[str, Any]) -> bytes:
    call = {"index": 0, "id": name, "function": {"name": name, "arguments": json.dumps(arguments)}}
    return chunk({"delta": {"tool_calls": [call]}}) + chunk(
        {"delta": {}, "finish_reason": "tool_calls"}
    )


class ScriptedService:
    """Stands in for an AI service, so the real threads and hops can be tested without one."""

    def __init__(self) -> None:
        self.answers = [
            tool_call("get_today", {}),
            tool_call(
                "propose_settings", {"patch": {"theme": "dark"}, "summary": "Dunkles Design"}
            ),
            chunk({"delta": {"content": "Fertig."}})
            + chunk({"delta": {}, "finish_reason": "stop"}),
            chunk({"delta": {"content": "Ein Titel"}})
            + chunk({"delta": {}, "finish_reason": "stop"}),
        ]
        service = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                pass

            def do_POST(self) -> None:
                self.rfile.read(int(self.headers["Content-Length"]))
                body = service.answers.pop(0) + b"data: [DONE]\n\n"
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v1"


def ai_flow() -> None:
    """The chat through real worker threads, then the local API through the real bridge."""
    from statly.host.keychain import system_secrets

    results["secret_store_persistent"] = system_secrets().persistent
    placed = {
        "id": "own",
        "type": "custom:smoke",
        "x": 0,
        "y": 0,
        "w": 4,
        "h": 6,
        "period": "last7",
    }
    call_from_page(929, "mobile.preview", {"tablet": [], "phone": [placed]})
    later(1500, check_card_picture)


def check_card_picture() -> None:
    """A real picture shrinks on a real worker thread and travels inside the card."""

    def check(page: dict[str, Any]) -> None:
        block = answer(page, 929)["result"]["blocks"]["custom:smoke|last7"]
        results["card_picture"] = len(block["media"]) == 1 and next(
            iter(block["media"].values())
        ).startswith("data:image/jpeg;base64,")
        start_chat()

    read_page(check)


def start_chat() -> None:
    service = ScriptedService()
    settings = {"provider": "custom", "model": "smoke"}
    call_from_page(930, "ai.configure", {**settings, "baseUrl": service.url})
    call_from_page(931, "ai.consent")
    call_from_page(932, "ai.send", {"text": "Wie viel?"})
    wait_for_answer(40)


def wait_for_answer(attempts: int) -> None:
    request_id = 1000 + attempts
    call_from_page(request_id, "ai.conversation")

    def check(page: dict[str, Any]) -> None:
        response = answer(page, request_id)["result"]
        if response["running"] and attempts:
            wait_for_answer(attempts - 1)
            return
        if response["error"]:
            raise AssertionError(response["error"])
        results["ai_answer"] = response["messages"][-1]["text"]
        results["ai_tools"] = response["messages"][-1]["tools"]
        proposal = response["proposals"][0]
        results["ai_theme_before"] = window_settings()["theme"]
        results["ai_waiting"] = proposal["status"]
        call_from_page(933, "ai.applyProposal", {"id": proposal["id"]})
        later(300, after_apply)

    later(250, lambda: read_page(check))


def window_settings() -> dict[str, Any]:
    path = Path(mw.pm.profileFolder()) / "statly_data" / "settings.json"
    return json.loads(path.read_text(encoding="utf-8"))


def after_apply() -> None:
    results["ai_theme_applied"] = window_settings()["theme"]
    call_from_page(934, "ai.changes")

    def undo(page: dict[str, Any]) -> None:
        change = answer(page, 934)["result"][0]
        call_from_page(935, "ai.rollback", {"id": change["id"]})
        later(300, after_rollback)

    later(300, lambda: read_page(undo))


def after_rollback() -> None:
    results["ai_theme_restored"] = window_settings()["theme"] == results["ai_theme_before"]
    key_lock_flow()


def key_lock_flow() -> None:
    """The password through the real bridge and worker, far from the real keychain."""
    from statly.host.keychain import SessionSecrets
    from statly.modules.ai import Assistant

    class Throwaway(SessionSecrets):
        persistent = True

    assistant = next(item for item in gc.get_objects() if isinstance(item, Assistant))
    assistant.keys._store = Throwaway()
    assistant.keys.close()
    call_from_page(940, "ai.enableKeyLock", {"password": "smoke password"})
    call_from_page(941, "ai.lockKeys")
    later(2500, try_passwords)


def try_passwords() -> None:
    call_from_page(942, "ai.unlockKeys", {"password": "wrong password"})
    call_from_page(943, "ai.unlockKeys", {"password": "smoke password"})

    def check(page: dict[str, Any]) -> None:
        results["key_lock_set"] = answer(page, 940)["result"]["keyLock"]
        results["key_lock_refused"] = answer(page, 942)["error"]["message"]
        results["key_lock_opened"] = answer(page, 943)["result"]["keyLock"]
        external_flow()

    later(2500, lambda: read_page(check))


def external_flow() -> None:
    call_from_page(936, "ai.newExternalCode")

    def connect(page: dict[str, Any]) -> None:
        code = answer(page, 936)["result"]["code"]
        bridge = os.environ.get("STATLY_SMOKE_BRIDGE")
        if bridge:
            threading.Thread(target=ask_bridge, args=(bridge, code), daemon=True).start()
        wait_for_bridge(100)

    later(300, lambda: read_page(connect))


def ask_bridge(bridge: str, code: str) -> None:
    """A real MCP conversation, from the outside, while Anki keeps running."""
    process = subprocess.Popen(
        ["node", bridge],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        env={**os.environ, "STATLY_CODE": code},
        text=True,
    )

    def send(message: dict[str, Any]) -> None:
        assert process.stdin is not None
        process.stdin.write(json.dumps({"jsonrpc": "2.0", **message}) + "\n")
        process.stdin.flush()

    def receive() -> dict[str, Any]:
        assert process.stdout is not None
        return json.loads(process.stdout.readline())

    client = {"name": "smoke", "version": "1"}
    start = {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": client}
    send({"id": 1, "method": "initialize", "params": start})
    receive()
    send({"method": "notifications/initialized"})
    send({"id": 2, "method": "tools/list"})
    tools = receive()["result"]["tools"]
    send({"id": 3, "method": "tools/call", "params": {"name": "get_today", "arguments": {}}})
    called = receive()["result"]
    forbidden = {"name": "mobile.enable", "arguments": {}}
    send({"id": 4, "method": "tools/call", "params": forbidden})
    refused = receive()["result"]
    process.kill()
    results["mcp"] = {
        "tools": len(tools),
        "called": not called.get("isError") and "date" in called["content"][0]["text"],
        "refused": "Unknown tool" in refused["content"][0]["text"],
    }


def wait_for_bridge(attempts: int) -> None:
    if "mcp" in results or attempts == 0 or "STATLY_SMOKE_BRIDGE" not in os.environ:
        call_from_page(937, "ai.setExternal", {"enabled": False})
        later(200, reopen)
    else:
        later(100, lambda: wait_for_bridge(attempts - 1))


def reopen() -> None:
    first = window()
    aqt.dialogs.open("statly")
    results["single_window"] = window() is first
    later(0, close_like_anki)


def close_like_anki() -> None:
    """Unsaved work must not hold up Anki closing, or a sync would wait for a dialog."""

    def closed() -> None:
        results["closed_by_anki"] = aqt.dialogs.allClosed()
        finish()

    call_from_page(939, "system.setUnsaved", {"message": "Unsaved"})
    later(300, lambda: aqt.dialogs.closeAll(closed))


def record_imports() -> None:
    """Anki must never be asked to import anything just because it started."""
    original = mw.handleImport

    def handle_import(path: str) -> None:
        results.setdefault("unexpected_imports", []).append(path)
        original(path)

    mw.handleImport = handle_import


record_imports()
gui_hooks.profile_did_open.append(lambda: later(500, start))
