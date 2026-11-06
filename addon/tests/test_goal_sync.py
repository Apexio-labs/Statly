"""Goals between computers: the rules for merging, the permission, and a real sync.

The real sync runs Anki's own sync server on this computer with two fresh collections, so no
account and no real collection is involved.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection

from statly.modules.changes.goal_sync import MAX_BYTES, key_of, size_of
from statly.modules.goals.sync import build_state, merge
from test_goals import Setup

TODAY = date(2026, 11, 5)
NOW = 1_793_900_000


def goal(
    goal_id: str, updated: int, name: str = "Anatomy", archived: bool = False
) -> dict[str, Any]:
    return {
        "id": goal_id,
        "version": 1,
        "name": name,
        "createdDay": "2026-11-01",
        "updatedAt": updated,
        "archived": archived,
        "config": {
            "kind": "exam",
            "decks": [{"id": 1, "name": "Anatomy"}],
            "examDate": "2026-12-20",
            "bufferDays": 3,
            "mode": "learned",
            "counts": "newAndDue",
            "studyWeekdays": [0, 1, 2, 3, 4, 5, 6],
            "freeDates": [],
        },
    }


def state(device: str, *goals: dict[str, Any], **parts: Any) -> dict[str, Any]:
    return {
        "v": 1,
        "device": device,
        "goals": list(goals),
        "archived": parts.get("archived", {}),
        "deleted": parts.get("deleted", {}),
        "days": parts.get("days", {}),
        "best": parts.get("best", {}),
    }


def day(target: int, frozen_at: int, config: str = "abc", celebrated: int = 0) -> list[Any]:
    return [target, 0, 100, 0, 1, frozen_at, celebrated, config]


# The rules -------------------------------------------------------------------------------------


def test_the_newest_change_of_a_goal_wins() -> None:
    mine = goal("exam-11111111", 100, "Old name")
    theirs = goal("exam-11111111", 200, "New name")
    merged = merge("aaaaaaaa", [mine], {}, [state("bbbbbbbb", theirs)])
    assert [found["name"] for found in merged.put] == ["New name"]
    assert merge("aaaaaaaa", [theirs], {}, [state("bbbbbbbb", mine)]).put == []


def test_deleting_wins_over_any_change() -> None:
    edited_later = goal("exam-11111111", 900)
    merged = merge(
        "aaaaaaaa",
        [goal("exam-11111111", 100)],
        {},
        [state("bbbbbbbb", deleted={"exam-11111111": 500}), state("cccccccc", edited_later)],
    )
    assert merged.remove == ["exam-11111111"]
    assert merged.put == []
    assert merged.deleted == {"exam-11111111": 500}


def test_archiving_counts_as_a_change() -> None:
    mine = goal("exam-11111111", 100)
    merged = merge("aaaaaaaa", [mine], {}, [state("bbbbbbbb", archived={"exam-11111111": 300})])
    assert merged.put[0]["archived"] is True
    # Restored here after it was archived elsewhere: the restore is newer and stays.
    restored = goal("exam-11111111", 400)
    assert (
        merge("aaaaaaaa", [restored], {}, [state("bbbbbbbb", archived={"exam-11111111": 300})]).put
        == []
    )


def test_the_days_goal_fixed_first_applies_everywhere() -> None:
    merged = merge(
        "aaaaaaaa",
        [],
        {},
        [
            state("bbbbbbbb", days={"exam-11111111": {"2026-11-05": day(12, 2000)}}),
            state("cccccccc", days={"exam-11111111": {"2026-11-05": day(15, 1000, celebrated=1)}}),
        ],
    )
    entry = merged.days["exam-11111111"]["2026-11-05"]
    assert (entry["newTarget"], entry["frozenAt"], entry["celebrated"]) == (15, 1000, True)


def test_the_best_streak_is_the_longest_anywhere() -> None:
    merged = merge(
        "aaaaaaaa",
        [],
        {},
        [
            state("bbbbbbbb", best={"exam-11111111": 4}),
            state("cccccccc", best={"exam-11111111": 9}),
        ],
    )
    assert merged.best == {"exam-11111111": 9}


def test_own_switched_off_and_broken_shares_are_ignored() -> None:
    broken: list[Any] = [
        None,
        "text",
        {"v": 2, "goals": [goal("exam-22222222", 1)]},
        {"v": 1, "device": "bbbbbbbb", "off": True, "goals": [goal("exam-33333333", 1)]},
        {"v": 1, "device": "cccccccc", "goals": [{"id": 5}], "deleted": {"x": "soon"}},
        {"v": 1, "device": "dddddddd", "days": {"exam-44444444": {"2026-11-05": ["a"]}}},
        state("aaaaaaaa", goal("exam-55555555", 1)),
    ]
    merged = merge("aaaaaaaa", [], {}, broken)
    assert (merged.put, merged.remove, merged.deleted, merged.days) == ([], [], {}, {})


def test_a_share_stays_small_and_drops_old_days_before_goals() -> None:
    goals = [goal(f"exam-{index:08x}", index, name="Long name " * 7) for index in range(40)]
    books = {
        item["id"]: {
            "best": 3,
            "days": {
                (TODAY - timedelta(days=offset)).isoformat(): {
                    "newTarget": 30,
                    "reviewsTarget": 80,
                    "openAtStart": 1200,
                    "reviewsAtStart": 80,
                    "newestCard": 1_790_000_000_000,
                    "frozenAt": NOW - offset * 86_400,
                    "config": "0123456789abcdef",
                }
                for offset in range(7)
            },
        }
        for item in goals
    }
    shared = build_state("aaaaaaaa", goals, {}, books, TODAY, NOW)
    assert size_of(shared) <= MAX_BYTES
    assert shared["partial"] is True
    assert shared["days"] == {}
    kept = {item["id"] for item in shared["goals"]}
    assert "exam-00000027" in kept and "exam-00000000" not in kept


def test_a_share_is_the_same_for_the_same_goals() -> None:
    goals = [goal("exam-22222222", 5), goal("exam-11111111", 7, archived=True)]
    first = build_state("aaaaaaaa", goals, {"exam-33333333": NOW}, {}, TODAY, NOW)
    second = build_state(
        "aaaaaaaa", list(reversed(goals)), {"exam-33333333": NOW}, {}, TODAY, NOW + 60
    )
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert first["archived"] == {"exam-11111111": 7}
    old = build_state("aaaaaaaa", [], {"exam-33333333": NOW - 61 * 86_400}, {}, TODAY, NOW)
    assert old["deleted"] == {}


# The permission and the collection -------------------------------------------------------------


@pytest.fixture
def setup(tmp_path: Path) -> Iterator[Setup]:
    collection = Collection(str(tmp_path / "sync.anki2"))
    yield Setup(collection)
    collection.close()


def shared_entries(collection: Collection) -> dict[str, Any]:
    return {
        key: value
        for key, value in collection.all_config().items()
        if key.startswith("statly.goals.")
    }


def test_nothing_is_shared_without_the_permission(setup: Setup) -> None:
    setup.save()
    setup.runtime.sync_starting()
    setup.runtime.before_sync(setup.collection)
    assert shared_entries(setup.collection) == {}


def test_with_the_permission_the_goals_go_into_one_entry_of_this_computer(setup: Setup) -> None:
    grants = setup.context.services["permissions"].grants
    grants.grant("goals.sync")
    saved = setup.save()
    device = setup.context.services["goals.shared"].device()
    database: Any = setup.collection.db
    scheme = database.scalar("SELECT scm FROM col")

    setup.runtime.sync_starting()
    assert setup.runtime.before_sync(setup.collection) is True
    entry = shared_entries(setup.collection)[key_of(device)]
    assert [item["id"] for item in entry["goals"]] == [saved["id"]]
    assert database.scalar("SELECT scm FROM col") == scheme

    # Nothing changed, so nothing is written again.
    setup.runtime.sync_starting()
    assert setup.runtime.before_sync(setup.collection) is False


def test_the_first_goal_asks_once_about_syncing(tmp_path: Path) -> None:
    collection = Collection(str(tmp_path / "ask.anki2"))
    try:
        setup = Setup(collection)
        shared = setup.context.services["goals.shared"]
        shared._write({})  # pyright: ignore[reportPrivateUsage]
        setup.runtime.default_answer = None
        setup.save()
        asked = [prompt for prompt in setup.runtime.prompts if "AnkiWeb" in prompt.title]
        assert len(asked) == 1
        assert [answer for answer, _label in asked[0].choices] == ["deny", "always"]
        setup.save(examDate=(setup.today + timedelta(days=20)).isoformat())
        assert len([prompt for prompt in setup.runtime.prompts if "AnkiWeb" in prompt.title]) == 1
    finally:
        collection.close()


def test_taking_the_permission_back_tells_the_other_computers(setup: Setup) -> None:
    from test_rpc import call

    setup.context.services["permissions"].grants.grant("goals.sync")
    setup.save()
    setup.runtime.sync_starting()
    setup.runtime.before_sync(setup.collection)
    call(setup.context.router, "permissions.revoke", {"id": "goals.sync"})
    device = setup.context.services["goals.shared"].device()
    assert shared_entries(setup.collection)[key_of(device)] == {
        "v": 1,
        "device": device,
        "off": True,
    }


# A real sync -----------------------------------------------------------------------------------


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@pytest.fixture
def sync_server(tmp_path: Path) -> Iterator[str]:
    """Anki's own sync server for this test only, on this computer, with a made-up user."""
    port = free_port()
    environment = {
        **os.environ,
        "SYNC_USER1": "statly-test:secret",
        "SYNC_BASE": str(tmp_path / "server"),
        "SYNC_HOST": "127.0.0.1",
        "SYNC_PORT": str(port),
    }
    server = subprocess.Popen(
        [sys.executable, "-m", "anki.syncserver"],
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.05)
        else:
            pytest.skip("Anki's sync server did not start.")
        yield f"http://127.0.0.1:{port}/"
    finally:
        server.terminate()
        server.wait(5)


def synced(collection: Collection, auth: Any, upload: bool | None = None) -> int:
    """One sync as Anki does it. A first sync of a new collection is a full one."""
    result = collection.sync_collection(auth, False)
    if upload is not None:
        collection.close_for_full_sync()
        collection.full_upload_or_download(
            auth=auth, server_usn=result.server_media_usn, upload=upload
        )
        collection.reopen(after_full_sync=True)
    return int(result.required)


def test_a_goal_reaches_another_computer_with_a_normal_sync(
    tmp_path: Path, sync_server: str
) -> None:
    first = Setup(Collection(str(tmp_path / "first.anki2")))
    second = Setup(Collection(str(tmp_path / "second.anki2")))
    try:
        for side in (first, second):
            side.context.services["permissions"].grants.grant("goals.sync")
        first_auth = first.collection.sync_login("statly-test", "secret", sync_server)
        second_auth = second.collection.sync_login("statly-test", "secret", sync_server)
        synced(first.collection, first_auth, upload=True)
        synced(second.collection, second_auth, upload=False)

        made = first.save()
        undo = first.collection.undo_status().undo
        first.runtime.sync_starting()
        first.runtime.before_sync(first.collection)
        # A normal sync, no full one, and the person's undo is still there.
        assert first.collection.undo_status().undo == undo
        assert synced(first.collection, first_auth) == 0
        assert synced(second.collection, second_auth) == 0
        second.runtime.sync_finished()
        from test_rpc import drain

        drain(second.runtime)
        arrived = second.result("goals.list", {})
        assert [item["id"] for item in arrived] == [made["id"]]
        assert ("goals.changed", {}) in second.runtime.emitted

        # Deleted on the second computer: gone on the first after the next syncs.
        second.result("goals.delete", {"id": made["id"]})
        second.runtime.sync_starting()
        second.runtime.before_sync(second.collection)
        assert synced(second.collection, second_auth) == 0
        assert synced(first.collection, first_auth) == 0
        first.runtime.sync_finished()
        drain(first.runtime)
        assert first.result("goals.list", {}) == []
    finally:
        first.collection.close()
        second.collection.close()
