"""Stores API keys in the operating system's keychain instead of any file of ours."""

from __future__ import annotations

import ctypes
import logging
import shutil
import subprocess
import sys
from pathlib import Path

from ..core.errors import NotAllowed
from ..core.module import SecretStore

logger = logging.getLogger(__name__)

_SERVICE = "Statly"
_TIMEOUT_SECONDS = 10
_MAC_TOOL = Path("/usr/bin/security")
_NOT_FOUND = 44


class MacKeychain:
    """The login keychain. It stays on this Mac unless the user moves it themselves."""

    persistent = True

    def __init__(self, keychain: str | None = None) -> None:
        self._target = [keychain] if keychain else []

    def _run(self, *arguments: str) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [str(_MAC_TOOL), *arguments, *self._target],
            capture_output=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
        )

    def get(self, account: str) -> str | None:
        result = self._run("find-generic-password", "-s", _SERVICE, "-a", account, "-w")
        return result.stdout.decode().strip() or None if result.returncode == 0 else None

    def set(self, account: str, secret: str) -> None:
        target = f' "{self._target[0]}"' if self._target else ""
        command = f'add-generic-password -U -s {_SERVICE} -a "{account}" -w "{secret}"{target}\n'
        # Commands go in through stdin, because arguments are visible in the process list.
        subprocess.run(
            [str(_MAC_TOOL), "-i"],
            input=command.encode(),
            capture_output=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
        )
        if self.get(account) != secret:
            raise NotAllowed("The keychain did not accept the key.")

    def delete(self, account: str) -> None:
        result = self._run("delete-generic-password", "-s", _SERVICE, "-a", account)
        if result.returncode not in (0, _NOT_FOUND):
            raise NotAllowed("The keychain did not remove the key.")


class LinuxKeyring:
    """The desktop's secret service, through the tool that most distributions ship."""

    persistent = True

    def __init__(self, tool: str) -> None:
        self._tool = tool

    def _run(
        self, *arguments: str, secret: str | None = None
    ) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [self._tool, *arguments],
            input=secret.encode() if secret is not None else None,
            capture_output=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
        )

    def get(self, account: str) -> str | None:
        result = self._run("lookup", "service", _SERVICE, "account", account)
        return result.stdout.decode().strip() or None if result.returncode == 0 else None

    def set(self, account: str, secret: str) -> None:
        arguments = ("store", f"--label={_SERVICE}", "service", _SERVICE, "account", account)
        if self._run(*arguments, secret=secret).returncode != 0:
            raise NotAllowed("The keyring did not accept the key.")

    def delete(self, account: str) -> None:
        self._run("clear", "service", _SERVICE, "account", account)


class _FileTime(ctypes.Structure):
    _fields_ = [("low", ctypes.c_uint32), ("high", ctypes.c_uint32)]


class _Credential(ctypes.Structure):
    _fields_ = [
        ("Flags", ctypes.c_uint32),
        ("Type", ctypes.c_uint32),
        ("TargetName", ctypes.c_wchar_p),
        ("Comment", ctypes.c_wchar_p),
        ("LastWritten", _FileTime),
        ("CredentialBlobSize", ctypes.c_uint32),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_char)),
        ("Persist", ctypes.c_uint32),
        ("AttributeCount", ctypes.c_uint32),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", ctypes.c_wchar_p),
        ("UserName", ctypes.c_wchar_p),
    ]


class WindowsCredentials:
    """The Windows Credential Manager, set to stay on this machine."""

    persistent = True
    _GENERIC = 1
    _LOCAL_MACHINE = 2

    def __init__(self) -> None:
        loader = getattr(ctypes, "WinDLL")  # noqa: B009
        self._api = loader("advapi32", use_last_error=True)

    def _target(self, account: str) -> str:
        return f"{_SERVICE}/{account}"

    def get(self, account: str) -> str | None:
        found = ctypes.POINTER(_Credential)()
        if not self._api.CredReadW(self._target(account), self._GENERIC, 0, ctypes.byref(found)):
            return None
        try:
            credential = found.contents
            blob = ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
            return blob.decode("utf-16-le")
        finally:
            self._api.CredFree(found)

    def set(self, account: str, secret: str) -> None:
        blob = secret.encode("utf-16-le")
        buffer = ctypes.create_string_buffer(blob, len(blob))
        credential = _Credential(
            Type=self._GENERIC,
            TargetName=self._target(account),
            CredentialBlobSize=len(blob),
            CredentialBlob=ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)),
            Persist=self._LOCAL_MACHINE,
            UserName=_SERVICE,
        )
        if not self._api.CredWriteW(ctypes.byref(credential), 0):
            raise NotAllowed("Windows did not accept the key.")

    def delete(self, account: str) -> None:
        self._api.CredDeleteW(self._target(account), self._GENERIC, 0)


class SessionSecrets:
    """Without a keychain, a key lasts until Anki closes rather than going into a file."""

    persistent = False

    def __init__(self) -> None:
        self._values: dict[str, str] = {}

    def get(self, account: str) -> str | None:
        return self._values.get(account)

    def set(self, account: str, secret: str) -> None:
        self._values[account] = secret

    def delete(self, account: str) -> None:
        self._values.pop(account, None)


def system_secrets() -> SecretStore:
    try:
        if sys.platform == "darwin" and _MAC_TOOL.exists():
            return MacKeychain()
        if sys.platform == "win32":
            return WindowsCredentials()
        tool = shutil.which("secret-tool")
        if tool:
            return LinuxKeyring(tool)
    except OSError:
        logger.warning("Statly found no keychain and keeps keys for this session only")
    return SessionSecrets()
