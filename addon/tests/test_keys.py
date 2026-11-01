"""The password around stored keys: what it seals, and that no step can lose a key."""

from __future__ import annotations

import base64
import json
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection

from statly.core.errors import NotAllowed
from statly.host.keychain import MacKeychain, SessionSecrets
from statly.modules.ai.errors import AiError
from statly.modules.ai.keys import KeyVault, _subkey, _tag, seal, unseal
from test_ai import KEY, Setup, configured

PASSWORD = "correct horse"
OTHER_KEY = "sk-other-0123456789abcdef"
PROVIDERS = ["openai", "anthropic", "custom"]
DATA_KEY = bytes(range(32))


class Keychain(SessionSecrets):
    """Stands in for a real keychain, and can stop working halfway to test a crash."""

    persistent = True

    def __init__(self) -> None:
        super().__init__()
        self.writes_left: int | None = None

    def set(self, account: str, secret: str) -> None:
        if self.writes_left == 0:
            raise OSError("the keychain went away")
        if self.writes_left is not None:
            self.writes_left -= 1
        super().set(account, secret)


@pytest.fixture
def store() -> Keychain:
    return Keychain()


@pytest.fixture
def vault(store: Keychain) -> KeyVault:
    return KeyVault(store, lambda: "profile", PROVIDERS)


def stored(store: Keychain, name: str) -> str | None:
    return store.get(f"profile:{name}")


def test_sealing_round_trips_every_length() -> None:
    for length in (0, 1, 31, 32, 33, 64, 512):
        plain = bytes(index % 251 for index in range(length))
        assert unseal(DATA_KEY, seal(DATA_KEY, plain, "here"), "here") == plain


def test_a_sealed_value_does_not_contain_the_key() -> None:
    sealed = seal(DATA_KEY, KEY.encode(), "here")
    _, cipher, _ = (base64.urlsafe_b64decode(part) for part in sealed.split("."))
    assert KEY.encode() not in cipher
    assert KEY not in sealed


def test_the_same_key_never_seals_to_the_same_value() -> None:
    assert seal(DATA_KEY, b"same", "here") != seal(DATA_KEY, b"same", "here")


def test_a_changed_value_is_refused_wherever_it_changed() -> None:
    sealed = seal(DATA_KEY, KEY.encode(), "here")
    parts = sealed.split(".")
    for index, part in enumerate(parts):
        raw = bytearray(base64.urlsafe_b64decode(part))
        raw[0] ^= 1
        changed = [*parts]
        changed[index] = base64.urlsafe_b64encode(bytes(raw)).decode()
        assert unseal(DATA_KEY, ".".join(changed), "here") is None


@pytest.mark.parametrize("sealed", ["", "a.b", "a.b.c.d", "!!.??.%%"])
def test_broken_values_are_refused(sealed: str) -> None:
    assert unseal(DATA_KEY, sealed, "here") is None


def test_a_moved_boundary_between_nonce_and_text_is_refused() -> None:
    """The check joins the parts with a zero byte, which a longer nonce must not exploit."""
    nonce = bytes(16)
    cipher = b"abc\0defgh"
    label = "here"
    tag = _tag(_subkey(DATA_KEY, b"authenticate"), label, nonce, cipher)
    moved = [nonce + b"\0abc", b"defgh", tag]
    sealed = ".".join(base64.urlsafe_b64encode(part).decode() for part in moved)
    assert unseal(DATA_KEY, sealed, label) is None


def test_a_value_only_opens_with_its_key_and_in_its_place() -> None:
    sealed = seal(DATA_KEY, KEY.encode(), "openai")
    assert unseal(bytes(32), sealed, "openai") is None
    assert unseal(DATA_KEY, sealed, "anthropic") is None


def test_turning_it_on_leaves_no_readable_key_in_the_keychain(
    store: Keychain, vault: KeyVault
) -> None:
    vault.put("openai", KEY)
    vault.put("anthropic", OTHER_KEY)
    vault.turn_on(PASSWORD)
    everything = json.dumps(store._values)
    assert KEY not in everything
    assert OTHER_KEY not in everything
    assert PASSWORD not in everything
    assert vault.get("openai") == KEY
    assert vault.get("anthropic") == OTHER_KEY


def test_a_locked_key_cannot_be_read(vault: KeyVault) -> None:
    vault.put("openai", KEY)
    vault.turn_on(PASSWORD)
    vault.lock()
    assert vault.lock_state() == "locked"
    assert vault.has("openai") is True
    with pytest.raises(AiError) as caught:
        vault.get("openai")
    assert caught.value.code == "keys_locked"


def test_a_new_start_begins_locked(store: Keychain, vault: KeyVault) -> None:
    vault.put("openai", KEY)
    vault.turn_on(PASSWORD)
    restarted = KeyVault(store, lambda: "profile", PROVIDERS)
    assert restarted.lock_state() == "locked"
    restarted.unlock(PASSWORD)
    assert restarted.get("openai") == KEY


def test_a_wrong_password_opens_nothing(vault: KeyVault) -> None:
    vault.put("openai", KEY)
    vault.turn_on(PASSWORD)
    vault.lock()
    with pytest.raises(NotAllowed, match="wrong_password"):
        vault.unlock("not the password")
    assert vault.lock_state() == "locked"


def test_a_key_saved_after_unlocking_is_sealed_too(store: Keychain, vault: KeyVault) -> None:
    vault.turn_on(PASSWORD)
    vault.put("openai", KEY)
    assert KEY not in (stored(store, "openai") or "")
    assert vault.get("openai") == KEY


def test_no_key_can_be_saved_while_locked(vault: KeyVault) -> None:
    vault.turn_on(PASSWORD)
    vault.lock()
    with pytest.raises(NotAllowed, match="keys_locked"):
        vault.put("openai", KEY)


def test_keys_can_be_removed_without_the_password(store: Keychain, vault: KeyVault) -> None:
    vault.put("openai", KEY)
    vault.turn_on(PASSWORD)
    vault.lock()
    vault.remove("openai")
    assert stored(store, "openai") is None


def test_changing_the_password_keeps_every_key(store: Keychain, vault: KeyVault) -> None:
    vault.put("openai", KEY)
    vault.turn_on(PASSWORD)
    sealed = stored(store, "openai")
    vault.change_password(PASSWORD, "a different password")
    assert stored(store, "openai") == sealed
    vault.lock()
    with pytest.raises(NotAllowed, match="wrong_password"):
        vault.unlock(PASSWORD)
    vault.unlock("a different password")
    assert vault.get("openai") == KEY


def test_changing_the_password_needs_the_old_one(vault: KeyVault) -> None:
    vault.turn_on(PASSWORD)
    with pytest.raises(NotAllowed, match="wrong_password"):
        vault.change_password("not the password", "a different password")


def test_turning_it_off_needs_the_password_and_returns_to_plain_storage(
    store: Keychain, vault: KeyVault
) -> None:
    vault.put("openai", KEY)
    vault.turn_on(PASSWORD)
    vault.lock()
    with pytest.raises(NotAllowed, match="wrong_password"):
        vault.turn_off("not the password")
    assert vault.lock_state() == "locked"
    vault.turn_off(PASSWORD)
    assert vault.lock_state() == "off"
    assert stored(store, "openai") == KEY
    assert stored(store, "lock") is None


@pytest.mark.parametrize("writes", [0, 1, 2])
def test_a_crash_while_turning_it_on_loses_no_key(
    store: Keychain, vault: KeyVault, writes: int
) -> None:
    vault.put("openai", KEY)
    vault.put("anthropic", OTHER_KEY)
    store.writes_left = writes
    with pytest.raises(OSError, match="went away"):
        vault.turn_on(PASSWORD)
    store.writes_left = None

    restarted = KeyVault(store, lambda: "profile", PROVIDERS)
    if restarted.lock_state() == "locked":
        restarted.unlock(PASSWORD)
    assert restarted.get("openai") == KEY
    assert restarted.get("anthropic") == OTHER_KEY
    if restarted.lock_state() == "unlocked":
        assert KEY not in json.dumps(store._values)


@pytest.mark.parametrize("writes", [0, 1])
def test_a_crash_while_turning_it_off_loses_no_key(
    store: Keychain, vault: KeyVault, writes: int
) -> None:
    vault.put("openai", KEY)
    vault.put("anthropic", OTHER_KEY)
    vault.turn_on(PASSWORD)
    store.writes_left = writes
    with pytest.raises(OSError, match="went away"):
        vault.turn_off(PASSWORD)
    store.writes_left = None

    restarted = KeyVault(store, lambda: "profile", PROVIDERS)
    restarted.unlock(PASSWORD)
    assert restarted.get("openai") == KEY
    assert restarted.get("anthropic") == OTHER_KEY


def test_forgetting_removes_keys_and_password(store: Keychain, vault: KeyVault) -> None:
    vault.put("openai", KEY)
    vault.turn_on(PASSWORD)
    vault.lock()
    vault.forget()
    assert store._values == {}
    assert vault.lock_state() == "off"
    assert vault.has("openai") is False


def test_each_profile_has_its_own_keys_and_password(store: Keychain) -> None:
    profile = ["one"]
    vault = KeyVault(store, lambda: profile[0], PROVIDERS)
    vault.put("openai", KEY)
    vault.turn_on(PASSWORD)
    vault.close()

    profile[0] = "two"
    assert vault.lock_state() == "off"
    assert vault.has("openai") is False


def test_uninstalling_reaches_profiles_that_are_not_open(store: Keychain) -> None:
    store.set("other:openai", KEY)
    store.set("other:lock", "statly-lock1.x")
    vault = KeyVault(store, lambda: "profile", PROVIDERS)
    vault.put("openai", KEY)
    vault.forget_profiles(["profile", "other"])
    assert store._values == {}


def test_a_lock_needs_a_real_keychain() -> None:
    assert KeyVault(SessionSecrets(), lambda: "p", PROVIDERS).lock_state() == "unavailable"
    vault = KeyVault(SessionSecrets(), lambda: "p", PROVIDERS)
    with pytest.raises(NotAllowed):
        vault.turn_on(PASSWORD)


@pytest.mark.skipif(sys.platform != "darwin", reason="needs the macOS keychain tool")
def test_the_longest_sealed_key_fits_the_mac_keychain(tmp_path: Path) -> None:
    """On a throwaway keychain, so the real one stays untouched."""
    keychain = str(tmp_path / "statly-test.keychain-db")
    subprocess.run(["/usr/bin/security", "create-keychain", "-p", "x", keychain], check=True)
    try:
        vault = KeyVault(MacKeychain(keychain), lambda: "profile", PROVIDERS)
        vault.turn_on(PASSWORD)
        longest = "k" * 512
        vault.put("openai", longest)
        vault.lock()
        vault.unlock(PASSWORD)
        assert vault.get("openai") == longest
    finally:
        subprocess.run(["/usr/bin/security", "delete-keychain", keychain], check=False)


class Locked:
    """The real assistant on top of a keychain, with calls answered like the router does."""

    def __init__(self, setup: Setup) -> None:
        self.setup = setup
        setup.runtime.secret_store = Keychain()
        setup.assistant = setup._assistant()
        setup.chat = setup.assistant.chat

    def call(self, method: Callable[..., None], params: dict[str, Any]) -> Any:
        answers: list[Any] = []
        problems: list[Exception] = []
        method(params, answers.append, problems.append)
        self.setup.drain()
        if problems:
            raise problems[0]
        return answers[0]


@pytest.fixture
def locked(collection: Collection) -> Locked:
    return Locked(Setup(collection))


def test_the_status_follows_the_lock(locked: Locked) -> None:
    assistant = locked.setup.assistant
    configured(locked.setup)
    assistant.set_key({"key": KEY})
    assert assistant.status()["keyLock"] == "off"
    status = locked.call(assistant.enable_key_lock, {"password": PASSWORD})
    assert status["keyLock"] == "unlocked"
    assert assistant.lock_keys({})["keyLock"] == "locked"
    assert assistant.status()["hasKey"] is True
    assert locked.call(assistant.unlock_keys, {"password": PASSWORD})["keyLock"] == "unlocked"
    locked.setup.router.contract.check_result("ai.status", assistant.status())


def test_a_locked_key_stops_the_chat_with_a_clear_reason(locked: Locked) -> None:
    assistant = locked.setup.assistant
    configured(locked.setup)
    assistant.set_key({"key": KEY})
    assistant.consent({})
    locked.call(assistant.enable_key_lock, {"password": PASSWORD})
    assistant.lock_keys({})
    with pytest.raises(AiError) as caught:
        assistant._connect()
    assert caught.value.code == "keys_locked"


def test_local_models_work_while_keys_are_locked(locked: Locked) -> None:
    assistant = locked.setup.assistant
    configured(locked.setup)
    assistant.set_key({"key": KEY})
    locked.call(assistant.enable_key_lock, {"password": PASSWORD})
    assistant.lock_keys({})
    configured(locked.setup, "lmstudio")
    assert assistant.status()["hasKey"] is False
    assistant._connect()


def test_closing_a_profile_locks_again(locked: Locked) -> None:
    assistant = locked.setup.assistant
    locked.call(assistant.enable_key_lock, {"password": PASSWORD})
    assistant.close()
    assert assistant.status()["keyLock"] == "locked"


def test_a_wrong_password_reaches_the_page_as_a_failure(locked: Locked) -> None:
    assistant = locked.setup.assistant
    locked.call(assistant.enable_key_lock, {"password": PASSWORD})
    assistant.lock_keys({})
    with pytest.raises(NotAllowed, match="wrong_password"):
        locked.call(assistant.unlock_keys, {"password": "not the password"})


def test_no_password_or_key_lands_in_a_file(locked: Locked) -> None:
    assistant = locked.setup.assistant
    configured(locked.setup)
    assistant.set_key({"key": KEY})
    locked.call(assistant.enable_key_lock, {"password": PASSWORD})
    for path in locked.setup.runtime.folder.rglob("*"):
        if path.is_file():
            content = path.read_bytes()
            assert KEY.encode() not in content, path
            assert PASSWORD.encode() not in content, path
