"""Detecta y normaliza URLs de video (YouTube, TikTok, Facebook) para embeber."""
from __future__ import annotations

import re
from urllib.parse import quote, urlparse, parse_qs

_PLATAFORMAS = frozenset({"youtube", "tiktok", "facebook"})


def _limpiar_url(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    return u


def _youtube_id(url: str, parsed) -> str | None:
    host = (parsed.netloc or "").lower().replace("www.", "")
    path = parsed.path or ""
    if host in {"youtu.be", "www.youtu.be"}:
        vid = path.strip("/").split("/")[0]
        return vid if vid else None
    if "youtube.com" in host or "youtube-nocookie.com" in host:
        if path.startswith("/embed/"):
            return path.split("/embed/")[1].split("/")[0] or None
        if path.startswith("/shorts/"):
            return path.split("/shorts/")[1].split("/")[0] or None
        qs = parse_qs(parsed.query or "")
        if qs.get("v"):
            return qs["v"][0]
    return None


def _tiktok_id(url: str, parsed) -> str | None:
    host = (parsed.netloc or "").lower().replace("www.", "")
    path = parsed.path or ""
    if "tiktok.com" not in host:
        return None
    m = re.search(r"/video/(\d+)", path)
    if m:
        return m.group(1)
    return None


def _facebook_url_original(url: str, parsed) -> str | None:
    host = (parsed.netloc or "").lower().replace("www.", "")
    if host in {"fb.watch", "www.fb.watch"}:
        return url
    if "facebook.com" in host or "fb.com" in host:
        if "/watch" in (parsed.path or "") or "/videos/" in (parsed.path or "") or "/reel/" in (parsed.path or ""):
            return url
        qs = parse_qs(parsed.query or "")
        if qs.get("v"):
            return url
    return None


def parse_video_url(url: str) -> dict[str, str] | None:
    """
    Devuelve dict con plataforma, url_original, url_embed.
    None si la URL no es de YouTube, TikTok o Facebook reconocible.
    """
    original = _limpiar_url(url)
    if not original:
        return None
    try:
        parsed = urlparse(original)
    except Exception:
        return None
    if not parsed.netloc:
        return None

    yt = _youtube_id(original, parsed)
    if yt:
        return {
            "plataforma": "youtube",
            "url_original": original,
            "url_embed": f"https://www.youtube.com/embed/{yt}",
        }

    tt = _tiktok_id(original, parsed)
    if tt:
        return {
            "plataforma": "tiktok",
            "url_original": original,
            "video_id": tt,
            "url_embed": (
                f"https://www.tiktok.com/player/v1/{tt}"
                "?autoplay=1&music_info=0&description=0&rel=0&native_context_menu=0"
            ),
        }

    if _facebook_url_original(original, parsed):
        href = quote(original, safe="")
        return {
            "plataforma": "facebook",
            "url_original": original,
            "url_embed": (
                f"https://www.facebook.com/plugins/video.php?href={href}"
                "&show_text=false&width=560"
            ),
        }

    return None


def parse_video_urls_text(texto: str, *, max_videos: int = 6) -> tuple[list[dict[str, str]], list[str]]:
    """Parsea lineas de texto; devuelve (videos validos, errores por linea)."""
    videos: list[dict[str, str]] = []
    errores: list[str] = []
    vistos: set[str] = set()

    for linea in (texto or "").splitlines():
        raw = linea.strip()
        if not raw:
            continue
        if len(videos) >= max_videos:
            errores.append(f"Maximo {max_videos} videos por anuncio.")
            break
        info = parse_video_url(raw)
        if not info:
            errores.append(f"URL no valida (solo YouTube, TikTok o Facebook): {raw[:80]}")
            continue
        clave = info["url_original"].lower()
        if clave in vistos:
            continue
        vistos.add(clave)
        videos.append(info)

    return videos, errores
