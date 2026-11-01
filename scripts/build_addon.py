"""Package the add-on as dist/statly.ankiaddon."""

from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "addon" / "src" / "statly"
OUTPUT = ROOT / "dist" / "statly.ankiaddon"
SKIPPED_NAMES = {".DS_Store"}
SKIPPED_DIRECTORIES = {"__pycache__", "user_files"}


def package_files() -> list[Path]:
    return sorted(
        path
        for path in SOURCE.rglob("*")
        if path.is_file()
        and path.name not in SKIPPED_NAMES
        and not SKIPPED_DIRECTORIES & set(path.relative_to(SOURCE).parts)
    )


def main() -> None:
    if not (SOURCE / "web" / "index.html").exists():
        raise SystemExit("Run `pnpm build` first.")
    OUTPUT.parent.mkdir(exist_ok=True)
    with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as archive:
        for path in package_files():
            archive.write(path, path.relative_to(SOURCE).as_posix())
        archive.write(ROOT / "LICENSE", "LICENSE")
        archive.write(ROOT / "TRADEMARKS.md", "TRADEMARKS.md")

    with ZipFile(OUTPUT) as archive:
        names = archive.namelist()
        manifest = json.loads(archive.read("manifest.json"))
    required = {
        "__init__.py",
        "manifest.json",
        "LICENSE",
        "TRADEMARKS.md",
        "web/index.html",
        "web/THIRD_PARTY_NOTICES.txt",
    }
    if not required <= set(names) or manifest["package"] != "statly":
        raise SystemExit("The package is incomplete.")
    print(f"{OUTPUT} ({OUTPUT.stat().st_size // 1024} KB, {len(names)} files)")


if __name__ == "__main__":
    main()
