"""Feature modules. Add a new module to ``MODULES`` to switch it on."""

from __future__ import annotations

from ..core.module import Module
from .ai import AiModule
from .changes import ChangesModule
from .creation import CreationModule
from .dashboard import DashboardModule
from .deck_overview import DeckOverviewModule
from .estimates import EstimatesModule
from .feedback import FeedbackModule
from .goals import GoalsModule
from .mobile import MobileModule
from .notes import NotesModule
from .permissions import PermissionsModule
from .release_notes import ReleaseNotesModule
from .review import ReviewModule
from .settings import SettingsModule
from .statistics import StatisticsModule
from .storage import StorageModule
from .system import SystemModule
from .timing import TimingModule
from .wallpaper import WallpaperModule
from .widgets import WidgetsModule

MODULES: tuple[Module, ...] = (
    SystemModule(),
    # Every module that asks for a permission or changes Anki needs these two first.
    PermissionsModule(),
    ChangesModule(),
    StatisticsModule(),
    # Statly's own database file, before every part that keeps rows in it.
    StorageModule(),
    # The reviewer's events, then the modules that listen to them.
    ReviewModule(),
    TimingModule(),
    CreationModule(),
    EstimatesModule(),
    WidgetsModule(),
    NotesModule(),
    DashboardModule(),
    GoalsModule(),
    SettingsModule(),
    WallpaperModule(),
    DeckOverviewModule(),
    FeedbackModule(),
    ReleaseNotesModule(),
    MobileModule(),
    AiModule(),
)
