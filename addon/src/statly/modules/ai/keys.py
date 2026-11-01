"""Where API keys live, and the optional password that locks them away from other add-ons.

Python has no AES and Anki brings no cryptography package, so sealing is built from what the
standard library offers: scrypt for the password, HMAC-SHA256 in counter mode to encrypt, and a
second HMAC over the result to notice any change. ``docs/adr/0002`` explains what this stops.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import unicodedata
from collections.abc import Callable, Sequence

from ...core.errors import NotAllowed
from ...core.module import SecretStore
from .errors import AiError

_LOCK = "lock"
_LOCK_PREFIX = "statly-lock1."
_SEALED_PREFIX = "statly-sealed1."
_KEY_BYTES = 32
_NONCE_BYTES = 16
_SALT_BYTES = 16
_BLOCK_BYTES = 32
_SCRYPT_COST = 2**17
_SCRYPT_MEMORY_LIMIT = 2**28

WRONG_PASSWORD = "wrong_password"
KEYS_LOCKED = "keys_locked"


def _encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode()


def _decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text.encode())


def _subkey(key: bytes, purpose: bytes) -> bytes:
    return hmac.digest(key, purpose, "sha256")


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    blocks = range(length // _BLOCK_BYTES + 1)
    return b"".join(hmac.digest(key, nonce + block.to_bytes(8), "sha256") for block in blocks)


def _xor(data: bytes, stream: bytes) -> bytes:
    return bytes(left ^ right for left, right in zip(data, stream, strict=False))


def _tag(key: bytes, label: str, nonce: bytes, cipher: bytes) -> bytes:
    """The label ties a sealed value to its place, so items cannot be swapped in the keychain."""
    return hmac.digest(key, b"\0".join((label.encode(), nonce, cipher)), "sha256")


def seal(key: bytes, plain: bytes, label: str) -> str:
    nonce = secrets.token_bytes(_NONCE_BYTES)
    stream = _keystream(_subkey(key, b"encrypt"), nonce, len(plain))
    cipher = _xor(plain, stream)
    tag = _tag(_subkey(key, b"authenticate"), label, nonce, cipher)
    return ".".join(_encode(part) for part in (nonce, cipher, tag))


def unseal(key: bytes, sealed: str, label: str) -> bytes | None:
    """None means a wrong key or a changed value. Nothing is decrypted before the check."""
    try:
        nonce, cipher, tag = (_decode(part) for part in sealed.split("."))
    except ValueError:
        return None
    if len(nonce) != _NONCE_BYTES:
        return None
    expected = _tag(_subkey(key, b"authenticate"), label, nonce, cipher)
    if not hmac.compare_digest(expected, tag):
        return None
    return _xor(cipher, _keystream(_subkey(key, b"encrypt"), nonce, len(cipher)))


def derive(password: str, salt: bytes) -> bytes:
    """Slow and memory-hungry on purpose, because guessing has to stay expensive."""
    return hashlib.scrypt(
        unicodedata.normalize("NFKC", password).encode(),
        salt=salt,
        n=_SCRYPT_COST,
        r=8,
        p=1,
        maxmem=_SCRYPT_MEMORY_LIMIT,
        dklen=_KEY_BYTES,
    )


class KeyVault:
    """Keys for one profile. With a password, the keychain holds only sealed values.

    The password opens a random data key, and that key seals the API keys. Changing the password
    then rewrites a single keychain item, so a crash cannot leave keys nobody can open.
    """

    def __init__(
        self, store: SecretStore, profile: Callable[[], str], providers: Sequence[str]
    ) -> None:
        self._store = store
        self._profile = profile
        self._providers = providers
        self._data_key: bytes | None = None
        self._stored: dict[str, bool] = {}
        self._lock_exists: bool | None = None

    def _account(self, name: str) -> str:
        return f"{self._profile()}:{name}"

    def _has_lock(self) -> bool:
        if self._lock_exists is None:
            self._lock_exists = self._store.get(self._account(_LOCK)) is not None
        return self._lock_exists

    def lock_state(self) -> str:
        if not self._store.persistent or not hasattr(hashlib, "scrypt"):
            return "unavailable"
        if not self._has_lock():
            return "off"
        return "locked" if self._data_key is None else "unlocked"

    def has(self, provider: str) -> bool:
        if provider not in self._stored:
            self._stored[provider] = self._store.get(self._account(provider)) is not None
        return self._stored[provider]

    def get(self, provider: str) -> str | None:
        stored = self._store.get(self._account(provider))
        if stored is None or not stored.startswith(_SEALED_PREFIX):
            return stored
        if self._data_key is None:
            raise AiError(KEYS_LOCKED)
        plain = unseal(self._data_key, stored.removeprefix(_SEALED_PREFIX), provider)
        if plain is None:
            raise AiError("key_missing")
        return plain.decode()

    def put(self, provider: str, key: str) -> None:
        if self._has_lock() and self._data_key is None:
            raise NotAllowed(KEYS_LOCKED)
        value = key
        if self._data_key is not None:
            value = _SEALED_PREFIX + seal(self._data_key, key.encode(), provider)
        self._store.set(self._account(provider), value)
        self._stored[provider] = True

    def remove(self, provider: str) -> None:
        self._store.delete(self._account(provider))
        self._stored[provider] = False

    def _write_lock(self, password: str, data_key: bytes) -> None:
        salt = secrets.token_bytes(_SALT_BYTES)
        box = seal(derive(password, salt), data_key, _LOCK)
        self._store.set(self._account(_LOCK), f"{_LOCK_PREFIX}{_encode(salt)}.{box}")
        self._lock_exists = True

    def _open_lock(self, password: str) -> bytes:
        record = self._store.get(self._account(_LOCK))
        if record is None:
            raise NotAllowed("No password is set.")
        salt, _, box = record.removeprefix(_LOCK_PREFIX).partition(".")
        data_key = unseal(derive(password, _decode(salt)), box, _LOCK)
        if data_key is None:
            raise NotAllowed(WRONG_PASSWORD)
        return data_key

    def _seal_unsealed(self) -> None:
        """A crash while turning the lock on can leave a plain key, and this finishes the job."""
        for provider in self._providers:
            stored = self._store.get(self._account(provider))
            if stored is not None and not stored.startswith(_SEALED_PREFIX):
                self.put(provider, stored)

    def turn_on(self, password: str) -> None:
        if self.lock_state() != "off":
            raise NotAllowed("The password cannot be set right now.")
        # The lock comes first: a plain key can still be sealed later, the reverse cannot be undone.
        data_key = secrets.token_bytes(_KEY_BYTES)
        self._write_lock(password, data_key)
        self._data_key = data_key
        self._seal_unsealed()

    def turn_off(self, password: str) -> None:
        self._data_key = self._open_lock(password)
        for provider in self._providers:
            key = self.get(provider)
            if key is not None:
                self._store.set(self._account(provider), key)
        self._store.delete(self._account(_LOCK))
        self._lock_exists = False
        self.lock()

    def unlock(self, password: str) -> None:
        self._data_key = self._open_lock(password)
        self._seal_unsealed()

    def change_password(self, current: str, new: str) -> None:
        data_key = self._open_lock(current)
        self._write_lock(new, data_key)
        self._data_key = data_key

    def lock(self) -> None:
        self._data_key = None

    def close(self) -> None:
        """Another profile may follow, with keys and a password of its own."""
        self.lock()
        self._stored.clear()
        self._lock_exists = None

    def forget(self) -> None:
        """For a forgotten password: nothing sealed can be opened anymore, so all of it goes."""
        self.lock()
        for provider in self._providers:
            self.remove(provider)
        self._store.delete(self._account(_LOCK))
        self._lock_exists = False

    def forget_profiles(self, profiles: Sequence[str]) -> None:
        """Removing Statly must not leave a working key behind in the keychain."""
        self.close()
        for profile in profiles:
            for name in (*self._providers, _LOCK):
                self._store.delete(f"{profile}:{name}")
