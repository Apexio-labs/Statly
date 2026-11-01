"""Rules that keep the code base safe, checked on every run."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

PACKAGE = Path(__file__).parent.parent / "src" / "statly"
SOURCES = [
    path
    for path in PACKAGE.rglob("*.py")
    if "web" not in path.relative_to(PACKAGE).parts
    and path.relative_to(PACKAGE).parts[0] != "contract"
]
UI_LAYER = {Path("__init__.py")}
WRITE_LAYER = "mobile"

# Anything that can change a user's collection. Only modules/mobile may use these.
WRITE_CALLS = {
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
    "set_deck",
    "set_due_date",
    "suspend_cards",
    "update_card",
    "update_cards",
    "update_config",
    "update_deck",
    "update_dict",
    "update_note",
    "update_notes",
    "write_before_sync",
}


def relative(path: Path) -> Path:
    return path.relative_to(PACKAGE)


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


@pytest.mark.parametrize("path", SOURCES, ids=lambda path: str(relative(path)))
def test_only_the_mobile_module_can_write(path: Path) -> None:
    if WRITE_LAYER in relative(path).parts:
        return
    tree = ast.parse(path.read_text(encoding="utf-8"))
    calls = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert not calls & WRITE_CALLS, f"{relative(path)} calls {sorted(calls & WRITE_CALLS)}"


@pytest.mark.parametrize("path", SOURCES, ids=lambda path: str(relative(path)))
def test_only_the_mobile_module_can_remove_decks_or_note_types(path: Path) -> None:
    """Plain ``remove`` is everywhere, so these two are recognized by what they are called on."""
    if WRITE_LAYER in relative(path).parts:
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
