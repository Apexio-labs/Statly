"""Statly's own database file, shared by every part that keeps its own measurements.

The file opens on first use and closes with the profile. Parts that hold rows in memory ask to
be told first (``LocalDatabase.before_close``), so nothing waiting is lost.
"""

from __future__ import annotations

from ...core.localdb import LocalDatabase
from ...core.module import Context


class StorageModule:
    def register(self, context: Context) -> None:
        host = context.host
        database = LocalDatabase(host.data_folder)
        context.services["localdb"] = database
        host.on_profile_closing(database.close)
