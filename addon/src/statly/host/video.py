"""Converts videos with the mpv player that ships with Anki."""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import sys
from pathlib import Path

from aqt.sound import _packagedCmd

from ..core.errors import NotAllowed

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 15 * 60
_MAX_EDGE = 1280
_PROBE_SECONDS = 30
_MAX_FPS = 30
_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def _video_size(command: list[str], source: Path, env: dict[str, str]) -> tuple[int, int] | None:
    try:
        finished = subprocess.run(
            [*command, str(source), "--no-config", "--vo=null", "--ao=null", "--frames=1"],
            env=env,
            capture_output=True,
            text=True,
            timeout=_PROBE_SECONDS,
            check=False,
            creationflags=_FLAGS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = re.search(r"VO: \[null\] (\d+)x(\d+)", finished.stdout)
    return (int(match[1]), int(match[2])) if match else None


def _scale_filter(size: tuple[int, int] | None) -> list[str]:
    """Shrink large videos and leave small ones alone. This mpv has no expression filters."""
    if size is None or max(size) <= _MAX_EDGE:
        return []
    side = f"w={_MAX_EDGE}:h=-2" if size[0] >= size[1] else f"w=-2:h={_MAX_EDGE}"
    return [f"--vf-add=scale={side}"]


def _mpv_command(source: Path, target: Path) -> tuple[list[str], dict[str, str]]:
    command, env = _packagedCmd(["mpv"])
    return (
        [
            *command,
            str(source),
            "--no-config",
            "--no-terminal",
            "--aid=no",
            f"--o={target}",
            "--of=webm",
            "--ovc=libvpx-vp9",
            "--ovcopts=b=0,crf=33,deadline=realtime,cpu-used=6,row-mt=1",
            f"--vf-add=fps={_MAX_FPS}",
            *_scale_filter(_video_size(command, source, env)),
        ],
        env,
    )


def _ffmpeg_command(source: Path, target: Path) -> list[str] | None:
    """Linux has no packaged mpv, and system builds may lack encoders."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        return None
    return [
        ffmpeg,
        "-y",
        "-i",
        str(source),
        "-an",
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "33",
        "-b:v",
        "0",
        "-deadline",
        "realtime",
        "-cpu-used",
        "6",
        "-r",
        str(_MAX_FPS),
        "-vf",
        f"scale='min({_MAX_EDGE},iw)':-2",
        str(target),
    ]


def _run(command: list[str], env: dict[str, str] | None) -> bool:
    try:
        finished = subprocess.run(
            command,
            env=env,
            capture_output=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
            creationflags=_FLAGS,
        )
    except (OSError, subprocess.TimeoutExpired):
        logger.exception("Statly could not convert a video")
        return False
    return finished.returncode == 0


def convert_to_webm(source: Path, target: Path) -> None:
    command, env = _mpv_command(source, target)
    if _run(command, env) and target.is_file() and target.stat().st_size > 0:
        return
    fallback = _ffmpeg_command(source, target)
    if fallback and _run(fallback, None) and target.is_file():
        return
    raise NotAllowed("This video could not be converted. Please try a WebM file.")
