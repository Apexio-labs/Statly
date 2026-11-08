"""Release notes after a big update, and a GitHub file that updates like AnkiWeb's copy."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from aqt.addons import AddonManager

from statly.core.storage import JsonStore
from statly.modules.release_notes import NOTES_BEGAN, ReleaseNotes, big_version

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "addon" / "src" / "statly" / "manifest.json"
LOCALES = ROOT / "packages" / "i18n" / "locales"
ANKIWEB_ID = "215470814"


def notes(tmp_path: Path, current: str, onboarded: bool = True) -> ReleaseNotes:
    version = {"current": current}
    release_notes = ReleaseNotes(
        JsonStore(lambda: tmp_path), lambda: version["current"], lambda: onboarded
    )
    release_notes.version = version  # type: ignore[attr-defined]
    return release_notes


def test_a_new_install_shows_nothing(tmp_path: Path) -> None:
    fresh = notes(tmp_path, "2.2.0", onboarded=False)
    assert fresh.pending() == {"since": "2.2.0", "current": "2.2.0"}


def test_someone_from_before_the_notes_gets_the_next_big_version(tmp_path: Path) -> None:
    updated = notes(tmp_path, "2.2.0")
    assert updated.pending() == {"since": NOTES_BEGAN, "current": "2.2.0"}
    # Until the notes are closed they stay due, also after a restart.
    assert updated.pending()["since"] == NOTES_BEGAN
    updated.mark_seen()
    assert updated.pending() == {"since": "2.2.0", "current": "2.2.0"}


def test_a_small_update_shows_nothing_and_a_big_one_shows_its_notes(tmp_path: Path) -> None:
    release_notes: Any = notes(tmp_path, "2.2.0")
    release_notes.mark_seen()
    release_notes.version["current"] = "2.2.3"
    assert release_notes.pending() == {"since": "2.2.3", "current": "2.2.3"}
    release_notes.version["current"] = "3.0.0"
    assert release_notes.pending() == {"since": "2.2.3", "current": "3.0.0"}


def test_going_back_to_an_older_version_shows_nothing(tmp_path: Path) -> None:
    release_notes: Any = notes(tmp_path, "2.3.0")
    release_notes.mark_seen()
    release_notes.version["current"] = "2.2.1"
    assert release_notes.pending() == {"since": "2.2.1", "current": "2.2.1"}


def test_a_damaged_file_counts_as_nothing_stored(tmp_path: Path) -> None:
    (tmp_path / "versions.json").write_text('{"seen": 7}', encoding="utf-8")
    assert notes(tmp_path, "2.2.0").pending()["since"] == NOTES_BEGAN


def test_every_big_version_has_notes_in_every_language() -> None:
    """The reminder: a release that raises the first or second number needs its notes.

    Write them in ``packages/i18n/locales/*.json`` under ``whatsNew.releases``, keyed by the first
    two numbers, a few short lines on what people will notice.
    """
    current = big_version(json.loads(MANIFEST.read_text(encoding="utf-8"))["human_version"])
    began = big_version(NOTES_BEGAN)
    assert current is not None and began is not None
    if current <= began:
        return
    key = f"{current[0]}.{current[1]}"
    for locale in sorted(LOCALES.glob("*.json")):
        releases = json.loads(locale.read_text(encoding="utf-8"))["whatsNew"]["releases"]
        lines = releases.get(key, [])
        assert lines and all(isinstance(line, str) and line.strip() for line in lines), (
            f"Statly {key} is a big update: write what is new in {locale.name} "
            f"under whatsNew.releases.{key}"
        )


def package(manifest: dict[str, Any]) -> io.BytesIO:
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("__init__.py", "")
    data.seek(0)
    return data


@pytest.fixture
def addons(tmp_path: Path) -> AddonManager:
    """Anki's own installer, on an empty add-ons folder."""
    manager = AddonManager.__new__(AddonManager)
    manager.mw = SimpleNamespace(pm=SimpleNamespace(addonFolder=lambda: str(tmp_path)))  # type: ignore[assignment]
    return manager


def test_the_github_file_installs_into_ankiwebs_folder(
    addons: AddonManager, tmp_path: Path
) -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert manifest["package"] == ANKIWEB_ID

    # Someone who once installed an older file from GitHub has it in a folder named "statly".
    addons.install(package({"package": "statly", "name": "Statly"}))
    (tmp_path / ANKIWEB_ID).mkdir()
    (tmp_path / ANKIWEB_ID / "__init__.py").write_text("", encoding="utf-8")
    (tmp_path / ANKIWEB_ID / "user_files").mkdir()
    (tmp_path / ANKIWEB_ID / "user_files" / "kept.txt").write_text("mine", encoding="utf-8")

    result: Any = addons.install(package(manifest))

    assert sorted(path.name for path in tmp_path.iterdir()) == [ANKIWEB_ID, "statly"]
    # It replaced AnkiWeb's copy in place, kept its user files, and Anki checks it for updates.
    assert (tmp_path / ANKIWEB_ID / "user_files" / "kept.txt").read_text(encoding="utf-8") == "mine"
    assert addons.addon_meta(ANKIWEB_ID).ankiweb_id() == int(ANKIWEB_ID)
    assert addons.addon_meta(ANKIWEB_ID).update_enabled
    # The old copy stops, so two Statlys never run side by side.
    assert result.conflicts == {"statly"}
    assert not addons.addon_meta("statly").enabled
