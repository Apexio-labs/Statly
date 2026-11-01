"""Feature modules. Add a new module to ``MODULES`` to switch it on."""

from __future__ import annotations

from ..core.module import Module
from .ai import AiModule
from .dashboard import DashboardModule
from .deck_overview import DeckOverviewModule
from .feedback import FeedbackModule
from .mobile import MobileModule
from .settings import SettingsModule
from .statistics import StatisticsModule
from .system import SystemModule
from .wallpaper import WallpaperModule
from .widgets import WidgetsModule

MODULES: tuple[Module, ...] = (
    SystemModule(),
    StatisticsModule(),
    WidgetsModule(),
    DashboardModule(),
    SettingsModule(),
    WallpaperModule(),
    DeckOverviewModule(),
    FeedbackModule(),
    MobileModule(),
    AiModule(),
)
