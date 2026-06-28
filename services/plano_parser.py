"""Extrae poligonos de planos DXF y SVG para georreferenciacion."""
from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from typing import Any


def _parse_lote_metadata(text: str) -> dict[str, str]:
    """Extrae etapa, manzana y lote de nombres de capa o etiquetas CAD."""
    raw = (text or "").strip()
    if not raw:
        return {"etapa": "", "manzana": "", "lote": ""}
    etapa = ""
    manzana = ""
    lote = ""
    m = re.search(r"(?:etapa|et\.?|e)\s*(\d+)", raw, re.I)
    if m:
        etapa = m.group(1)
    m = re.search(r"(?:manzana|mz\.?|m\.?\s*z\.?)\s*([A-Za-z0-9]+)", raw, re.I)
    if m:
        manzana = m.group(1).upper()
    m = re.search(r"(?:lote|lt\.?|l\.?\s*t\.?)\s*(\d+)", raw, re.I)
    if m:
        lote = m.group(1)
    if not lote:
        m = re.search(r"\b(\d{1,3})\b", raw)
        if m and not etapa:
            lote = m.group(1)
    return {"etapa": etapa, "manzana": manzana, "lote": lote}


def _feature_meta(layer: str, label: str) -> dict[str, str]:
    meta = _parse_lote_metadata(label)
    if not any(meta.values()):
        meta = _parse_lote_metadata(layer)
    return meta


def _guess_tipo_estado(layer: str, color: str | None = None) -> tuple[str, str]:
    layer_l = (layer or "").lower()
    if any(k in layer_l for k in ("calle", "street", "via", "vía", "road", "eje")):
        return "calle", "calle"
    if any(k in layer_l for k in ("vend", "sold", "rojo", "red")):
        return "lote", "vendido"
    if any(k in layer_l for k in ("reserv", "blue", "azul")):
        return "lote", "reservado"
    if any(k in layer_l for k in ("disp", "libre", "green", "verde", "avail")):
        return "lote", "disponible"
    if color:
        c = color.lower()
        if c in ("#ef4444", "#ff0000", "#f00", "red", "rojo"):
            return "lote", "vendido"
        if c in ("#3b82f6", "#0000ff", "#00f", "blue", "azul"):
            return "lote", "reservado"
        if c in ("#22c55e", "#00ff00", "#0f0", "green", "verde"):
            return "lote", "disponible"
    return "lote", "disponible"


def _ring_area(ring: list[tuple[float, float]]) -> float:
    if len(ring) < 3:
        return 0.0
    a = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _close_ring(
    pts: list[tuple[float, float]],
    min_area: float | None = None,
    span: float = 1.0,
) -> list[tuple[float, float]] | None:
    if len(pts) < 3:
        return None
    if pts[0] != pts[-1] and _dist(pts[0], pts[-1]) < span * 0.002:
        pts = list(pts) + [pts[0]]
    if pts[0] != pts[-1]:
        pts = list(pts) + [pts[0]]
    ring = pts[:-1] if len(pts) > 1 and pts[0] == pts[-1] else pts
    if len(ring) < 3:
        return None
    area = _ring_area(ring)
    thresh = min_area if min_area is not None else max((span * span) * 1e-10, 1e-8)
    if area < thresh:
        return None
    return ring


def _local_path_from_ring(ring: list[tuple[float, float]]) -> list[dict[str, float]]:
    return [{"x": float(x), "y": float(y)} for x, y in ring]


def _parse_numbers(raw: str) -> list[float]:
    return [float(x) for x in re.findall(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?", raw or "")]


def _path_d_to_points(d: str, curve_steps: int = 10) -> list[tuple[float, float]]:
    """Convierte atributo SVG path d en lista de puntos (aprox. curvas)."""
    if not d or not d.strip():
        return []
    s = re.sub(r",", " ", d.strip())
    s = re.sub(r"([MmLlHhVvCcSsQqTtAaZz])", r" \1 ", s)
    tokens = [t for t in s.split() if t]
    i = 0
    cmd = "M"
    x, y = 0.0, 0.0
    start_x, start_y = 0.0, 0.0
    out: list[tuple[float, float]] = []

    def read_float() -> float:
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    def line_to(nx: float, ny: float) -> None:
        nonlocal x, y
        out.append((nx, ny))
        x, y = nx, ny

    def cubic(x1: float, y1: float, x2: float, y2: float, x3: float, y3: float) -> None:
        for step in range(1, curve_steps + 1):
            t = step / curve_steps
            u = 1 - t
            nx = u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3
            ny = u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
            out.append((nx, ny))
        line_to(x3, y3)

    while i < len(tokens):
        t = tokens[i]
        if t.isalpha() and len(t) == 1:
            cmd = t
            i += 1
            continue
        rel = cmd.islower()
        c = cmd.upper()
        try:
            if c == "M":
                nx, ny = read_float(), read_float()
                if rel:
                    nx += x
                    ny += y
                x, y = nx, ny
                start_x, start_y = x, y
                out.append((x, y))
                cmd = "L" if rel else "L"
            elif c == "L":
                nx, ny = read_float(), read_float()
                if rel:
                    nx += x
                    ny += y
                line_to(nx, ny)
            elif c == "H":
                nx = read_float()
                if rel:
                    nx += x
                line_to(nx, y)
            elif c == "V":
                ny = read_float()
                if rel:
                    ny += y
                line_to(x, ny)
            elif c == "C":
                x1, y1 = read_float(), read_float()
                x2, y2 = read_float(), read_float()
                x3, y3 = read_float(), read_float()
                if rel:
                    x1 += x
                    y1 += y
                    x2 += x
                    y2 += y
                    x3 += x
                    y3 += y
                cubic(x1, y1, x2, y2, x3, y3)
            elif c == "Z":
                if out and (x != start_x or y != start_y):
                    line_to(start_x, start_y)
                x, y = start_x, start_y
            elif c == "A":
                # Arco: solo usar punto final
                _ = [read_float() for _ in range(5)]
                nx, ny = read_float(), read_float()
                if rel:
                    nx += x
                    ny += y
                line_to(nx, ny)
            else:
                i += 1
        except (IndexError, ValueError):
            break
    return out


def _add_feature(
    features: list[dict[str, Any]],
    ring: list[tuple[float, float]],
    layer: str,
    fill: str | None,
    idx_ref: list[int],
    min_area: float,
    span: float,
) -> None:
    closed = _close_ring(ring, min_area=min_area, span=span)
    if not closed:
        return
    tipo, estado = _guess_tipo_estado(layer, fill)
    idx_ref[0] += 1
    label = layer or f"Poligono {idx_ref[0]}"
    meta = _feature_meta(layer, label)
    features.append(
        {
            "id": f"svg-{idx_ref[0]}",
            "label": label,
            "tipo": tipo,
            "estado": estado,
            "layer": layer,
            "etapa": meta["etapa"],
            "manzana": meta["manzana"],
            "lote": meta["lote"],
            "tipologia": "",
            "localPath": _local_path_from_ring(closed),
        }
    )


def parse_dxf_bytes(data: bytes) -> dict[str, Any]:
    try:
        import ezdxf
    except ImportError as exc:
        raise RuntimeError("Instala ezdxf: pip install ezdxf") from exc

    try:
        from ezdxf import recover

        doc, _auditor = recover.read(data)
    except Exception:
        doc = ezdxf.read(data)

    msp = doc.modelspace()
    features: list[dict[str, Any]] = []
    idx = 0

    def add_ring(ring: list[tuple[float, float]], layer: str, label: str) -> None:
        nonlocal idx
        closed = _close_ring(ring, span=max(
            max((p[0] for p in ring), default=1) - min((p[0] for p in ring), default=0),
            max((p[1] for p in ring), default=1) - min((p[1] for p in ring), default=0),
            1.0,
        ))
        if not closed:
            return
        tipo, estado = _guess_tipo_estado(layer)
        idx += 1
        lbl = label or layer or f"Poligono {idx}"
        meta = _feature_meta(layer, lbl)
        features.append(
            {
                "id": f"dxf-{idx}",
                "label": lbl,
                "tipo": tipo,
                "estado": estado,
                "layer": layer,
                "etapa": meta["etapa"],
                "manzana": meta["manzana"],
                "lote": meta["lote"],
                "tipologia": "",
                "localPath": _local_path_from_ring(closed),
            }
        )

    for entity in msp:
        dxftype = entity.dxftype()
        layer = getattr(entity.dxf, "layer", "0") or "0"
        try:
            if dxftype == "LWPOLYLINE":
                pts = [(float(p[0]), float(p[1])) for p in entity.get_points("xy")]
                if entity.closed or (pts and pts[0] == pts[-1]):
                    add_ring(pts, layer, layer)
            elif dxftype == "POLYLINE" and entity.is_closed:
                pts = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in entity.vertices]
                add_ring(pts, layer, layer)
            elif dxftype == "HATCH":
                for path in entity.paths:
                    if hasattr(path, "vertices"):
                        pts = [(float(v[0]), float(v[1])) for v in path.vertices]
                        add_ring(pts, layer, layer)
        except Exception:
            continue

    bounds = _bounds_from_features(features)
    return {"features": features, "bounds": bounds, "format": "dxf"}


def _bounds_from_features(features: list[dict[str, Any]]) -> dict[str, float] | None:
    xs: list[float] = []
    ys: list[float] = []
    for f in features:
        for p in f.get("localPath") or []:
            xs.append(float(p["x"]))
            ys.append(float(p["y"]))
    if not xs:
        return None
    return {
        "minX": min(xs),
        "maxX": max(xs),
        "minY": min(ys),
        "maxY": max(ys),
        "width": max(xs) - min(xs),
        "height": max(ys) - min(ys),
    }


def parse_svg_bytes(data: bytes) -> dict[str, Any]:
    text = data.decode("utf-8", errors="replace")
    # Quitar BOM y entidades problematicas
    if text.startswith("\ufeff"):
        text = text[1:]
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise ValueError(f"SVG invalido: {exc}") from exc

    tag = root.tag.split("}")[-1].lower()
    if tag != "svg":
        raise ValueError("El archivo no es un SVG valido")

    features: list[dict[str, Any]] = []
    idx_ref = [0]

    def local_name(el: ET.Element) -> str:
        return el.tag.split("}")[-1].lower()

    def parse_points_attr(raw: str) -> list[tuple[float, float]]:
        nums = _parse_numbers(raw)
        pts: list[tuple[float, float]] = []
        for j in range(0, len(nums) - 1, 2):
            pts.append((nums[j], nums[j + 1]))
        return pts

    def walk(el: ET.Element, inherited_layer: str) -> None:
        layer = el.attrib.get("id") or el.attrib.get("class") or inherited_layer
        fill = el.attrib.get("fill") or el.attrib.get("stroke")
        if fill in ("none", "transparent"):
            fill = el.attrib.get("stroke")
        name = local_name(el)
        span = 100.0

        if name == "polygon":
            pts = parse_points_attr(el.attrib.get("points", ""))
            _add_feature(features, pts, layer, fill, idx_ref, 1e-8, span)
        elif name == "polyline":
            pts = parse_points_attr(el.attrib.get("points", ""))
            _add_feature(features, pts, layer, fill, idx_ref, 1e-8, span)
        elif name == "path":
            d = el.attrib.get("d", "")
            pts = _path_d_to_points(d)
            if len(pts) >= 3:
                _add_feature(features, pts, layer, fill, idx_ref, 1e-8, span)
        elif name == "rect":
            x = float(el.attrib.get("x", 0) or 0)
            y = float(el.attrib.get("y", 0) or 0)
            w = float(el.attrib.get("width", 0) or 0)
            h = float(el.attrib.get("height", 0) or 0)
            if w > 0 and h > 0:
                ring = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
                _add_feature(features, ring, layer, fill, idx_ref, 1e-8, span)
        elif name == "circle":
            cx = float(el.attrib.get("cx", 0) or 0)
            cy = float(el.attrib.get("cy", 0) or 0)
            r = float(el.attrib.get("r", 0) or 0)
            if r > 0:
                ring = []
                for k in range(16):
                    a = 2 * math.pi * k / 16
                    ring.append((cx + r * math.cos(a), cy + r * math.sin(a)))
                _add_feature(features, ring, layer, fill, idx_ref, 1e-8, span)

        for child in list(el):
            walk(child, layer)

    walk(root, "Capa")
    bounds = _bounds_from_features(features)
    if bounds:
        span = max(bounds["width"], bounds["height"], 1.0)
        # Segundo pase con umbral de area segun tamano del dibujo
        if not features:
            pass
    return {
        "features": features,
        "bounds": bounds,
        "format": "svg",
        "hint": (
            "Usa UTM de la esquina inferior izquierda del plano y el ancho real en metros."
            if features
            else None
        ),
    }
