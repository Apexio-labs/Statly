"""Rules that keep the code base safe, checked on every run."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from statly.core.contract import Contract
from statly.modules.ai.tools import NEVER_CALLED

PACKAGE = Path(__file__).parent.parent / "src" / "statly"
SOURCES = [
    path
    for path in PACKAGE.rglob("*.py")
    if "web" not in path.relative_to(PACKAGE).parts
    and path.relative_to(PACKAGE).parts[0] != "contract"
]
UI_LAYER = {Path("__init__.py")}
# The one door through which Statly changes Anki. See docs/adr/0003-permissions-and-changes.md.
WRITE_LAYER = ("modules", "changes")
GATE = Path("modules/changes/__init__.py")

# Anything that can change a user's collection. Only modules/changes may use these.
WRITE_CALLS = {
    "add_custom_undo_entry",
    "add_note",
    "add_notes",
    "after_note_updates",
    "answer_card",
    "answerCard",
    "bury_cards",
    "execute",
    "executemany",
    "executescript",
    "flush",
    "forget_cards",
    "merge_undo_entries",
    "add_config",
    "add_dict",
    "add_template",
    "remove_cards_and_orphaned_notes",
    "remove_config",
    "remove_deck",
    "remove_notes",
    "reschedule_cards_as_new",
    "run_collection_write",
    "save",
    "schedule_cards_as_new",
    "set_config",
    "set_deck",
    "set_due_date",
    "suspend_cards",
    "update_card",
    "update_cards",
    "update_config",
    "update_deck",
    "update_deck_configs",
    "update_dict",
    "update_note",
    "update_notes",
    "write_before_sync",
}


# Handing work to Anki's collection worker. Only the gate may, after checking the permission.
WORKER_CALLS = {"run_collection_write", "write_before_sync", "run_collection_op"}


def relative(path: Path) -> Path:
    return path.relative_to(PACKAGE)


def in_write_layer(path: Path) -> bool:
    return relative(path).parts[:2] == WRITE_LAYER


def called_attributes(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }


def imported_modules(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module)
    return names


@pytest.mark.parametrize("path", SOURCES, ids=lambda path: str(relative(path)))
def test_only_host_touches_anki_ui(path: Path) -> None:
    location = relative(path)
    if location.parts[0] == "host" or location in UI_LAYER:
        return
    imports = imported_modules(ast.parse(path.read_text(encoding="utf-8")))
    assert not {name for name in imports if name.split(".")[0] == "aqt"}, (
        f"{location} imports aqt. Move this into host/ behind the Host interface."
    )


# Statly's own SQLite file. It runs SQL, but only ever on statly.db in statly_data.
LOCAL_DATABASE = Path("core/localdb.py")
LOCAL_DATABASE_CALLS = {"execute", "executemany"}


@pytest.mark.parametrize("path", SOURCES, ids=lambda path: str(relative(path)))
def test_only_the_changes_module_can_write(path: Path) -> None:
    if in_write_layer(path):
        return
    calls = called_attributes(path)
    if relative(path) == LOCAL_DATABASE:
        calls -= LOCAL_DATABASE_CALLS
    assert not calls & WRITE_CALLS, f"{relative(path)} calls {sorted(calls & WRITE_CALLS)}"


def test_only_the_local_database_uses_sqlite() -> None:
    """Everything else gets ``Tables``, which can only reach Statly's own file."""
    for path in SOURCES:
        if relative(path) == LOCAL_DATABASE:
            continue
        imports = imported_modules(ast.parse(path.read_text(encoding="utf-8")))
        assert "sqlite3" not in imports, f"{relative(path)} imports sqlite3"


def test_nothing_listens_for_answered_cards() -> None:
    """With a listener there, Anki loads every answered card again, which slows reviewing."""
    for path in SOURCES:
        assert "reviewer_did_answer_card" not in path.read_text(encoding="utf-8"), relative(path)


@pytest.mark.parametrize("path", SOURCES, ids=lambda path: str(relative(path)))
def test_only_the_gate_hands_work_to_ankis_worker(path: Path) -> None:
    """Anything else would skip the permission check right before the write."""
    if relative(path) == GATE or relative(path).parts[0] == "host":
        return
    calls = called_attributes(path)
    assert not calls & WORKER_CALLS, f"{relative(path)} calls {sorted(calls & WORKER_CALLS)}"


def test_every_kind_of_change_names_its_permission() -> None:
    known = set(Contract().permissions["rules"])
    kinds = [
        path
        for path in (PACKAGE / "modules" / "changes").glob("*.py")
        if path.name != "__init__.py"
    ]
    assert kinds
    for path in kinds:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        declared = [
            node.value.value
            for node in tree.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name) and target.id == "PERMISSION"
                for target in node.targets
            )
            and isinstance(node.value, ast.Constant)
        ]
        assert declared and declared[0] in known, f"{path.name} needs PERMISSION from the contract"


def test_no_assistant_tool_reaches_permissions_or_changes() -> None:
    """Only the person may allow things, and changes to Anki go through the gate's dialog."""
    contract = Contract()
    reached = {tool["method"] for tool in contract.ai["tools"].values() if tool["method"]}
    reached |= {statistic["method"] for statistic in contract.ai["statistics"].values()}
    forbidden = (*NEVER_CALLED, "settings.update", "dashboard.save", "widgets.save")
    assert not {method for method in reached if method.startswith(forbidden)}


def test_the_assistant_cannot_reach_the_door_for_changes() -> None:
    """No file of the assistant even names the gate or the deck limits. Its list of calls it never
    makes names them on purpose, so that list is the one place allowed to."""
    names = ("ChangeGate", "DeckLimitChange", "deck_limits", 'services["changes"]', "gate.apply")
    for path in SOURCES:
        if relative(path).parts[:2] == ("modules", "ai"):
            text = path.read_text(encoding="utf-8")
            assert not [name for name in names if name in text], relative(path)


@pytest.mark.parametrize("path", SOURCES, ids=lambda path: str(relative(path)))
def test_only_the_changes_module_can_remove_decks_or_note_types(path: Path) -> None:
    """Plain ``remove`` is everywhere, so these two are recognized by what they are called on."""
    if in_write_layer(path):
        return
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            owner = node.func.value
            if isinstance(owner, ast.Attribute) and owner.attr in {"decks", "models"}:
                assert node.func.attr not in {"remove", "rem", "add_config"}, relative(path)


def test_only_the_reader_touches_the_database() -> None:
    for path in SOURCES:
        if relative(path) == Path("core/reader.py"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        uses = [
            node for node in ast.walk(tree) if isinstance(node, ast.Attribute) and node.attr == "db"
        ]
        assert not uses, f"{relative(path)} uses .db directly. Use CollectionReader."


def test_only_the_reader_touches_ankis_backend() -> None:
    """A backend call can write, so the one that only reads stays in one reviewed place."""
    for path in SOURCES:
        if relative(path) == Path("core/reader.py"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        uses = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute) and node.attr == "_backend"
        ]
        assert not uses, f"{relative(path)} uses Anki's backend directly."


def metadata_in(path: Path) -> list[bytes]:
    """Pictures can carry the computer they were made on, which a public repo must not show."""
    raw = path.read_bytes()
    if path.suffix == ".png":
        found: list[bytes] = []
        position = 8
        while position < len(raw):
            length = int.from_bytes(raw[position : position + 4])
            kind = raw[position + 4 : position + 8]
            if kind in {b"eXIf", b"tEXt", b"iTXt", b"zTXt", b"tIME"}:
                found.append(kind)
            position += 12 + length
        return found
    if path.suffix in {".jpg", ".jpeg"}:
        return [b"Exif"] if b"Exif\0\0" in raw[:4096] else []
    return []


def test_no_picture_carries_metadata() -> None:
    assets = Path(__file__).parent.parent.parent / "packages" / "ui" / "assets"
    pictures = [path for path in assets.rglob("*") if path.suffix in {".png", ".jpg", ".jpeg"}]
    assert pictures
    for path in pictures:
        assert not metadata_in(path), path.name


def test_the_rule_detects_a_real_write() -> None:
    tree = ast.parse("col.update_note(note)")
    calls = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert calls & WRITE_CALLS == {"update_note"}
