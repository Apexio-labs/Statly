"""Feature modules. Add a new module to ``MODULES`` to switch it on."""

from __future__ import annotations

from ..core.module import Module
from .ai import AiModule
from .changes import ChangesModule
from .dashboard import DashboardModule
from .deck_overview import DeckOverviewModule
from .estimates import EstimatesModule
from .feedback import FeedbackModule
from .goals import GoalsModule
from .mobile import MobileModule
from .permissions import PermissionsModule
from .review import ReviewModule
from .settings import SettingsModule
from .statistics import StatisticsModule
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
    # The reviewer's events, then the modules that listen to them.
    ReviewModule(),
    TimingModule(),
    EstimatesModule(),
    WidgetsModule(),
    DashboardModule(),
    GoalsModule(),
    SettingsModule(),
    WallpaperModule(),
    DeckOverviewModule(),
    FeedbackModule(),
    MobileModule(),
    AiModule(),
)
