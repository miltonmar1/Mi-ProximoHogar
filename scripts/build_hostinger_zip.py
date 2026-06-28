"""Genera ZIP limpio para subir a Hostinger (sin venv ni secretos)."""
from __future__ import annotations

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "deploy" / "miproximohogar-hostinger.zip"

SKIP_DIRS = {
    "venv",
    ".git",
    "__pycache__",
    ".cursor",
    "instance",
    "htmlcov",
    ".pytest_cache",
    "node_modules",
    "agent-transcripts",
    "terminals",
}
SKIP_FILES = {
    ".env",
    ".DS_Store",
    "Thumbs.db",
}
SKIP_SUFFIX = {".pyc", ".pyo", ".log"}


def should_include(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    if any(part in SKIP_DIRS for part in rel.parts):
        return False
    if path.name in SKIP_FILES:
        return False
    if path.suffix.lower() in SKIP_SUFFIX:
        return False
    if rel.parts[:2] == ("static", "uploads") and path.is_file() and path.name != ".gitkeep":
        return False
    if rel.name.endswith("-hostinger.zip"):
        return False
    return True


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()

    count = 0
    total = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(ROOT.rglob("*")):
            if not path.is_file():
                continue
            if not should_include(path):
                continue
            arc = path.relative_to(ROOT).as_posix()
            zf.write(path, arc)
            count += 1
            total += path.stat().st_size

        htaccess = ROOT / "deploy" / ".htaccess"
        if htaccess.exists():
            zf.write(htaccess, ".htaccess")

        readme = ROOT / "deploy" / "LEEME_HOSTINGER.txt"
        if readme.exists():
            zf.write(readme, "LEEME_HOSTINGER.txt")

    mb = total / (1024 * 1024)
    print(f"ZIP creado: {OUT}")
    print(f"Archivos: {count} | Tamano sin comprimir: {mb:.2f} MB")
    print(f"ZIP final: {OUT.stat().st_size / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    main()
