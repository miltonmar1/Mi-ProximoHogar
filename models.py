"""Modelos / repositorios de acceso a datos."""
from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from flask_login import UserMixin
from werkzeug.security import check_password_hash, generate_password_hash

from database import cursor, execute, execute_scalar, query_all, query_one
from sql_dialect import (
    T,
    fetch_inserted_id,
    imagen_principal_subquery,
    page,
    page_limit,
    str_len,
    upsert_vista_diaria_sql,
)


# Coordenadas aproximadas (Peru) para mapa cuando falten Lat/Long en BD
CIUDAD_COORDS: dict[str, tuple[float, float]] = {
    "Lima": (-12.0464, -77.0428),
    "Arequipa": (-16.4090, -71.5375),
    "Trujillo": (-8.1116, -79.0288),
    "Huancayo": (-12.0653, -75.2045),
    "Cusco": (-13.5319, -71.9675),
    "Piura": (-5.1945, -80.6328),
    "Chiclayo": (-6.7714, -79.8409),
    "Iquitos": (-3.7491, -73.2538),
}

DISTRITO_COORDS: dict[str, tuple[float, float]] = {
    "Miraflores": (-12.1195, -77.0282),
    "San Isidro": (-12.0990, -77.0340),
    "Lince": (-12.0850, -77.0350),
    "Cayma": (-16.3800, -71.5350),
    "Victor Larco": (-8.1280, -79.0340),
    "El Tambo": (-12.0653, -75.2045),
    "Cusco": (-13.5167, -71.9787),
    "San Blas": (-13.5148, -71.9755),
    "Wanchaq": (-13.5255, -71.9682),
    "Santiago": (-13.5188, -71.9825),
    "San Jeronimo": (-13.5288, -71.9055),
    "Saylla": (-13.5585, -71.8540),
}


def ciudad_id_por_nombre(nombre: str) -> int | None:
    row = query_one("SELECT CiudadId FROM dbo.Ciudades WHERE Nombre = ?", (nombre,))
    return int(row["CiudadId"]) if row else None


_ESTADO_LOTE_LABEL = {
    "disponible": "Disponible",
    "reservado": "Reservado",
    "vendido": "Vendido",
    "calle": "Calle",
}

_SQL_ESTADO_PUBLICO = "(p.Estado = 'activo' OR p.Estado IS NULL)"


def es_propiedad_publica(estado: Any) -> bool:
    return estado in (None, "", "activo")


def resumen_lotes_plan(plan_raw: Any) -> list[dict[str, Any]]:
    """Lista lotes del masterplan para mostrar en detalle publico."""
    plan = parse_plan_masterplan(plan_raw)
    if not plan:
        return []
    items: list[dict[str, Any]] = []
    for feat in plan.get("features") or []:
        if (feat.get("tipo") or "lote") == "calle":
            continue
        if not feat.get("path") and not feat.get("localPath"):
            continue
        estado = feat.get("estado") or "disponible"
        lote_num = feat.get("lote") or ""
        if not lote_num and feat.get("label"):
            m = re.search(r"\b(\d{1,3})\b", str(feat.get("label")))
            if m:
                lote_num = m.group(1)
        items.append(
            {
                "etapa": feat.get("etapa") or "",
                "manzana": feat.get("manzana") or "",
                "lote": lote_num,
                "tipologia": feat.get("tipologia") or "",
                "estado": estado,
                "estado_label": _ESTADO_LOTE_LABEL.get(estado, estado.title()),
                "area_m2": feat.get("area_m2"),
            }
        )
    return items


def _lotes_vendibles_plan(plan: dict[str, Any]) -> list[dict[str, Any]]:
    lotes: list[dict[str, Any]] = []
    for feat in plan.get("features") or []:
        if (feat.get("tipo") or "lote") == "calle" or feat.get("estado") == "calle":
            continue
        path = feat.get("path") or feat.get("localPath")
        if not path or len(path) < 3:
            continue
        lotes.append(feat)
    return lotes


def _precio_estimado_lote(
    feat: dict[str, Any],
    listing_precio: float | None,
    total_area_lotes: float,
    listing_area_total: float | None,
) -> float | None:
    if feat.get("precio") is not None:
        try:
            p = float(feat["precio"])
            if p > 0:
                return p
        except (TypeError, ValueError):
            pass
    if listing_precio is None or listing_precio <= 0:
        return None
    try:
        area = float(feat.get("area_m2") or 0)
    except (TypeError, ValueError):
        area = 0
    if area <= 0:
        return None
    if total_area_lotes > 0:
        return listing_precio * (area / total_area_lotes)
    if listing_area_total and listing_area_total > 0:
        return listing_precio * (area / listing_area_total)
    return listing_precio


def calc_min_lote_price(
    plan_raw: Any,
    listing_precio: Any = None,
    listing_area_total: Any = None,
    moneda: str = "PEN",
) -> float | None:
    """Precio minimo entre lotes del masterplan (misma logica que mapa.js)."""
    _ = moneda
    plan = parse_plan_masterplan(plan_raw)
    try:
        lp = float(listing_precio) if listing_precio is not None else None
    except (TypeError, ValueError):
        lp = None
    try:
        la = float(listing_area_total) if listing_area_total is not None else None
    except (TypeError, ValueError):
        la = None

    if not plan:
        return lp

    lotes = _lotes_vendibles_plan(plan)
    total_area = 0.0
    for feat in lotes:
        try:
            total_area += float(feat.get("area_m2") or 0)
        except (TypeError, ValueError):
            pass

    rows: list[dict[str, Any]] = []
    for feat in lotes:
        estado = feat.get("estado") or "disponible"
        precio = _precio_estimado_lote(feat, lp, total_area, la)
        rows.append({"estado": estado, "precio": precio})

    vendibles = [r for r in rows if r["estado"] in ("disponible", "reservado")]
    pool = vendibles if vendibles else rows
    prices = [float(r["precio"]) for r in pool if r.get("precio") and float(r["precio"]) > 0]
    if prices:
        return min(prices)
    return lp


def precio_presentacion_tarjeta(row: dict[str, Any]) -> dict[str, Any]:
    """Precio para cards: incluye flag 'desde' si el anuncio tiene lotes en masterplan."""
    moneda = row.get("Moneda") or "PEN"
    try:
        listing = float(row["Precio"]) if row.get("Precio") is not None else None
    except (TypeError, ValueError):
        listing = None

    plan = parse_plan_masterplan(row.get("PlanMasterplan"))
    lotes = _lotes_vendibles_plan(plan) if plan else []
    min_p = calc_min_lote_price(
        row.get("PlanMasterplan"),
        listing,
        row.get("AreaTotal"),
        moneda,
    )

    desde = bool(lotes and min_p is not None and min_p > 0)
    return {
        "precio": min_p if min_p is not None else listing,
        "moneda": moneda,
        "desde": desde,
    }


def parse_plan_masterplan(raw: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(data, dict) or not isinstance(data.get("features"), list):
            return None
        return data
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def parse_poligono_lote(raw: Any) -> list[dict[str, float]] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(data, list) or len(data) < 3:
            return None
        out: list[dict[str, float]] = []
        for p in data:
            out.append({"lat": float(p["lat"]), "lng": float(p["lng"])})
        return out
    except (TypeError, ValueError, KeyError, json.JSONDecodeError):
        return None


def _coords_plausibles(lat: float, lng: float, row: dict[str, Any]) -> bool:
    """Evita lat/lng incoherentes (ej. Cusco con longitud de Lima)."""
    if not (-19.0 <= lat <= 0.5 and -85.0 <= lng <= -68.0):
        return False
    ciudad = (row.get("Ciudad") or "").strip().lower()
    if ciudad == "cusco" and lng < -72.3:
        return False
    return True


def resolver_coordenadas(row: dict[str, Any]) -> tuple[float | None, float | None]:
    """Devuelve lat/lng de la propiedad o una aproximacion por distrito/ciudad."""
    plan = parse_plan_masterplan(row.get("PlanMasterplan"))
    if plan and plan.get("features"):
        lats: list[float] = []
        lngs: list[float] = []
        for feat in plan["features"]:
            for p in feat.get("path") or []:
                try:
                    lats.append(float(p["lat"]))
                    lngs.append(float(p["lng"]))
                except (TypeError, ValueError, KeyError):
                    pass
        if lats and lngs:
            lat_p = sum(lats) / len(lats)
            lng_p = sum(lngs) / len(lngs)
            if _coords_plausibles(lat_p, lng_p, row):
                return lat_p, lng_p

    paths = parse_poligono_lote(row.get("PoligonoLote"))
    if paths:
        lat_c = sum(p["lat"] for p in paths) / len(paths)
        lng_c = sum(p["lng"] for p in paths) / len(paths)
        if _coords_plausibles(lat_c, lng_c, row):
            return lat_c, lng_c

    lat = row.get("Latitud")
    lng = row.get("Longitud")
    if lat is not None and lng is not None:
        try:
            la, ln = float(lat), float(lng)
            if _coords_plausibles(la, ln, row):
                return la, ln
        except (TypeError, ValueError):
            pass

    distrito = (row.get("Distrito") or "").strip()
    if distrito:
        for nombre, coords in DISTRITO_COORDS.items():
            if nombre.lower() in distrito.lower():
                lat0, lng0 = coords
                pid = int(row.get("PropiedadId") or 0)
                return lat0 + (pid % 7 - 3) * 0.0015, lng0 + (pid % 5 - 2) * 0.0015

    ciudad = (row.get("Ciudad") or "").strip()
    base = CIUDAD_COORDS.get(ciudad)
    if not base:
        return None, None
    pid = int(row.get("PropiedadId") or 0)
    return base[0] + (pid % 11 - 5) * 0.008, base[1] + (pid % 13 - 6) * 0.008


# -----------------------------------------------------------------------------
# Usuarios
# -----------------------------------------------------------------------------

_USER_SELECT = (
    "SELECT UsuarioId, NombreCompleto, Email, Telefono, PasswordHash, EsAgente, "
    "FotoUrl, Biografia, Activo, GoogleId, OAuthProvider "
    "FROM dbo.Usuarios"
)


class Usuario(UserMixin):
    def __init__(self, row: dict[str, Any]):
        self.id = row["UsuarioId"]
        self.nombre = row["NombreCompleto"]
        self.email = row["Email"]
        self.telefono = row.get("Telefono")
        self.password_hash = row.get("PasswordHash")
        self.es_agente = bool(row.get("EsAgente"))
        self.foto_url = row.get("FotoUrl")
        self.biografia = row.get("Biografia")
        self.activo = bool(row.get("Activo", True))
        self.google_id = row.get("GoogleId")
        self.oauth_provider = row.get("OAuthProvider")

    def get_id(self) -> str:
        return str(self.id)

    def check_password(self, password: str) -> bool:
        if not self.password_hash:
            return False
        try:
            return check_password_hash(self.password_hash, password)
        except Exception:
            return False

    @staticmethod
    def _from_row(row: dict[str, Any] | None) -> Optional["Usuario"]:
        if not row:
            return None
        try:
            return Usuario(row)
        except KeyError:
            row_legacy = dict(row)
            row_legacy.setdefault("GoogleId", None)
            row_legacy.setdefault("OAuthProvider", None)
            return Usuario(row_legacy)

    @staticmethod
    def por_id(uid: int) -> Optional["Usuario"]:
        return Usuario._from_row(query_one(_USER_SELECT + " WHERE UsuarioId = ?", (uid,)))

    @staticmethod
    def por_email(email: str) -> Optional["Usuario"]:
        return Usuario._from_row(query_one(_USER_SELECT + " WHERE Email = ?", (email,)))

    @staticmethod
    def por_google_id(google_id: str) -> Optional["Usuario"]:
        return Usuario._from_row(query_one(_USER_SELECT + " WHERE GoogleId = ?", (google_id,)))

    @staticmethod
    def crear(nombre: str, email: str, password: str, telefono: str | None = None, es_agente: bool = False) -> int:
        ph = generate_password_hash(password)
        with cursor() as cur:
            cur.execute(
                f"INSERT INTO {T('Usuarios')} (NombreCompleto, Email, Telefono, PasswordHash, EsAgente) "
                "VALUES (?, ?, ?, ?, ?)",
                (nombre, email, telefono, ph, 1 if es_agente else 0),
            )
            return fetch_inserted_id(cur)

    @staticmethod
    def vincular_google(usuario_id: int, google_id: str, foto_url: str | None = None) -> None:
        execute(
            "UPDATE dbo.Usuarios SET GoogleId = ?, OAuthProvider = 'google', "
            "FotoUrl = COALESCE(?, FotoUrl) WHERE UsuarioId = ?",
            (google_id, foto_url, usuario_id),
        )

    @staticmethod
    def crear_con_google(
        nombre: str,
        email: str,
        google_id: str,
        foto_url: str | None = None,
        telefono: str | None = None,
    ) -> int:
        import secrets

        ph = generate_password_hash(secrets.token_urlsafe(48))
        with cursor() as cur:
            cur.execute(
                f"INSERT INTO {T('Usuarios')} "
                "(NombreCompleto, Email, Telefono, PasswordHash, EsAgente, FotoUrl, GoogleId, OAuthProvider) "
                "VALUES (?, ?, ?, ?, 0, ?, ?, 'google')",
                (nombre, email, telefono, ph, foto_url, google_id),
            )
            return fetch_inserted_id(cur)

    @staticmethod
    def login_o_registrar_google(
        google_id: str,
        email: str,
        nombre: str,
        foto_url: str | None = None,
    ) -> Optional["Usuario"]:
        email = (email or "").strip().lower()
        if not google_id or not email:
            return None

        existente = Usuario.por_google_id(google_id)
        if existente:
            if foto_url and not existente.foto_url:
                execute("UPDATE dbo.Usuarios SET FotoUrl = ? WHERE UsuarioId = ?", (foto_url, existente.id))
            return Usuario.por_id(int(existente.id))

        por_mail = Usuario.por_email(email)
        if por_mail:
            Usuario.vincular_google(int(por_mail.id), google_id, foto_url)
            return Usuario.por_id(int(por_mail.id))

        uid = Usuario.crear_con_google(nombre, email, google_id, foto_url)
        return Usuario.por_id(uid) if uid else None

    @staticmethod
    def actualizar_password(usuario_id: int, password: str) -> None:
        ph = generate_password_hash(password)
        execute(
            "UPDATE dbo.Usuarios SET PasswordHash = ? WHERE UsuarioId = ?",
            (ph, usuario_id),
        )

    @staticmethod
    def actualizar_perfil(
        usuario_id: int,
        nombre: str,
        telefono: str | None = None,
        biografia: str | None = None,
        foto_url: str | None = None,
        es_agente: bool | None = None,
    ) -> None:
        if es_agente is not None:
            execute(
                "UPDATE dbo.Usuarios SET NombreCompleto = ?, Telefono = ?, Biografia = ?, "
                "FotoUrl = COALESCE(?, FotoUrl), EsAgente = ? WHERE UsuarioId = ?",
                (nombre, telefono, biografia, foto_url, 1 if es_agente else 0, usuario_id),
            )
        else:
            execute(
                "UPDATE dbo.Usuarios SET NombreCompleto = ?, Telefono = ?, Biografia = ?, "
                "FotoUrl = COALESCE(?, FotoUrl) WHERE UsuarioId = ?",
                (nombre, telefono, biografia, foto_url, usuario_id),
            )

    @staticmethod
    def listar_agentes(limit: int = 20) -> list[dict[str, Any]]:
        return query_all(
            f"SELECT UsuarioId, NombreCompleto, Email, Telefono, FotoUrl, Biografia, "
            f"(SELECT COUNT(*) FROM {T('Propiedades')} p "
            " WHERE p.UsuarioId = u.UsuarioId AND (p.Estado = 'activo' OR p.Estado IS NULL)) AS TotalPropiedades "
            f"FROM {T('Usuarios')} u WHERE EsAgente = 1 AND Activo = 1 "
            f"ORDER BY TotalPropiedades DESC, NombreCompleto"
            + page_limit(limit),
        )


def agente_publico_por_id(usuario_id: int) -> dict[str, Any] | None:
    """Perfil publico de agente activo."""
    return query_one(
        "SELECT u.UsuarioId, u.NombreCompleto, u.Email, u.Telefono, u.FotoUrl, u.Biografia, "
        "(SELECT COUNT(*) FROM dbo.Propiedades p "
        f" WHERE p.UsuarioId = u.UsuarioId AND {_SQL_ESTADO_PUBLICO}) AS TotalPublicas, "
        "(SELECT COUNT(*) FROM dbo.Propiedades p WHERE p.UsuarioId = u.UsuarioId) AS TotalAnuncios "
        "FROM dbo.Usuarios u "
        "WHERE u.UsuarioId = ? AND u.EsAgente = 1 AND u.Activo = 1",
        (usuario_id,),
    )


def propiedades_publicas_de_usuario(usuario_id: int, limite: int = 48) -> list[dict[str, Any]]:
    return query_all(
        _PROPIEDAD_SELECT
        + f" WHERE p.UsuarioId = ? AND {_SQL_ESTADO_PUBLICO} "
        + " ORDER BY p.Destacada DESC, p.FechaCreacion DESC "
        + " OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY",
        (usuario_id, limite),
    )


def propiedades_relacionadas_anunciante(
    usuario_id: int,
    exclude_id: int,
    limite: int = 4,
) -> list[dict[str, Any]]:
    return query_all(
        _PROPIEDAD_SELECT
        + f" WHERE p.UsuarioId = ? AND p.PropiedadId <> ? AND {_SQL_ESTADO_PUBLICO} "
        + " ORDER BY p.Destacada DESC, p.FechaCreacion DESC "
        + " OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY",
        (usuario_id, exclude_id, limite),
    )


def sugerencias_busqueda(q: str, limit: int = 10) -> list[dict[str, Any]]:
    """Lista plana de sugerencias (compatibilidad)."""
    data = sugerencias_busqueda_agrupadas(q, limit=limit)
    items: list[dict[str, Any]] = []
    for grupo in data.get("grupos", []):
        items.extend(grupo.get("items", []))
    return items[:limit]


def sugerencias_busqueda_agrupadas(q: str, limit: int = 16) -> dict[str, Any]:
    """Sugerencias agrupadas por region para desplegable de busqueda."""
    texto = (q or "").strip()
    lim = max(1, min(24, limit))
    grupos_map: dict[str, list[dict[str, Any]]] = {}
    total = 0
    vistos: set[str] = set()

    def agregar(region: str, item: dict[str, Any]) -> None:
        nonlocal total
        if total >= lim:
            return
        clave = f"{item.get('tipo')}:{(item.get('texto') or '').lower()}"
        if clave in vistos:
            return
        vistos.add(clave)
        reg = (region or "Peru").strip() or "Peru"
        grupos_map.setdefault(reg, []).append(item)
        total += 1

    if not texto:
        for row in query_all(
            "SELECT c.CiudadId, c.Nombre, c.Region, "
            f"(SELECT COUNT(*) FROM dbo.Propiedades p WHERE p.CiudadId = c.CiudadId AND {_SQL_ESTADO_PUBLICO}) AS Total "
            "FROM dbo.Ciudades c ORDER BY c.Region, c.Nombre"
        ):
            agregar(
                row["Region"],
                {
                    "tipo": "ciudad",
                    "texto": row["Nombre"],
                    "q": row["Nombre"],
                    "ciudad_id": row["CiudadId"],
                    "region": row["Region"],
                    "total": int(row["Total"] or 0),
                },
            )
        return _grupos_ordenados(grupos_map)

    if len(texto) < 2:
        return {"grupos": []}

    like = f"%{texto}%"

    for row in query_all(
        "SELECT c.CiudadId, c.Nombre, c.Region, "
        f"(SELECT COUNT(*) FROM dbo.Propiedades p WHERE p.CiudadId = c.CiudadId AND {_SQL_ESTADO_PUBLICO}) AS Total "
        "FROM dbo.Ciudades c WHERE c.Nombre LIKE ? OR c.Region LIKE ? ORDER BY c.Nombre",
        (like, like),
    ):
        agregar(
            row["Region"],
            {
                "tipo": "ciudad",
                "texto": row["Nombre"],
                "q": row["Nombre"],
                "ciudad_id": row["CiudadId"],
                "region": row["Region"],
                "total": int(row["Total"] or 0),
            },
        )

    for row in query_all(
        f"SELECT DISTINCT TOP 6 p.Distrito, c.Nombre AS Ciudad, c.Region "
        f"FROM dbo.Propiedades p "
        f"JOIN dbo.Ciudades c ON c.CiudadId = p.CiudadId "
        f"WHERE {_SQL_ESTADO_PUBLICO} AND p.Distrito IS NOT NULL AND p.Distrito LIKE ? "
        f"ORDER BY p.Distrito",
        (like,),
    ):
        agregar(
            row["Region"],
            {
                "tipo": "distrito",
                "texto": row["Distrito"],
                "q": row["Distrito"],
                "ciudad": row["Ciudad"],
                "region": row["Region"],
            },
        )

    for row in query_all(
        _PROPIEDAD_SELECT
        + f" WHERE {_SQL_ESTADO_PUBLICO} AND p.Titulo LIKE ? "
        + " ORDER BY p.Destacada DESC, p.FechaCreacion DESC OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY",
        (like,),
    ):
        agregar(
            row.get("Region") or row.get("Ciudad"),
            {
                "tipo": "propiedad",
                "texto": row["Titulo"],
                "propiedad_id": row["PropiedadId"],
                "ciudad": row.get("Ciudad"),
                "region": row.get("Region"),
            },
        )

    for row in query_all(
        f"SELECT DISTINCT TOP 4 p.Direccion, p.Distrito, c.Nombre AS Ciudad, c.Region "
        f"FROM dbo.Propiedades p JOIN dbo.Ciudades c ON c.CiudadId = p.CiudadId "
        f"WHERE {_SQL_ESTADO_PUBLICO} AND p.Direccion IS NOT NULL AND p.Direccion LIKE ?",
        (like,),
    ):
        dir_txt = row["Direccion"]
        agregar(
            row["Region"],
            {
                "tipo": "direccion",
                "texto": dir_txt,
                "q": dir_txt,
                "ciudad": row.get("Ciudad"),
                "distrito": row.get("Distrito"),
                "region": row["Region"],
            },
        )

    return _grupos_ordenados(grupos_map)


def _grupos_ordenados(grupos_map: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    grupos = [{"region": k, "items": v} for k, v in sorted(grupos_map.items(), key=lambda x: x[0])]
    return {"grupos": grupos}


def _hash_token_recuperacion(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _dt_utc_naive(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def crear_token_recuperacion(usuario_id: int, horas_validez: int = 2) -> str:
    """Genera token de un solo uso y devuelve el valor en texto plano para el enlace."""
    token = secrets.token_urlsafe(32)
    token_hash = _hash_token_recuperacion(token)
    expira = datetime.now(timezone.utc) + timedelta(hours=horas_validez)
    execute(
        "UPDATE dbo.PasswordResetTokens SET Usado = 1 "
        "WHERE UsuarioId = ? AND Usado = 0",
        (usuario_id,),
    )
    execute(
        "INSERT INTO dbo.PasswordResetTokens (UsuarioId, TokenHash, FechaExpiracion) "
        "VALUES (?, ?, ?)",
        (usuario_id, token_hash, _dt_utc_naive(expira)),
    )
    return token


def validar_token_recuperacion(token: str) -> int | None:
    """Devuelve UsuarioId si el token es valido; si no, None."""
    if not token or len(token) < 16:
        return None
    row = query_one(
        "SELECT UsuarioId, FechaExpiracion, Usado FROM dbo.PasswordResetTokens "
        "WHERE TokenHash = ?",
        (_hash_token_recuperacion(token),),
    )
    if not row or row.get("Usado"):
        return None
    expira = row.get("FechaExpiracion")
    if not isinstance(expira, datetime):
        return None
    if expira < _dt_utc_naive(datetime.now(timezone.utc)):
        return None
    try:
        return int(row["UsuarioId"])
    except (TypeError, ValueError, KeyError):
        return None


def consumir_token_recuperacion(token: str) -> bool:
    n = execute(
        "UPDATE dbo.PasswordResetTokens SET Usado = 1 "
        "WHERE TokenHash = ? AND Usado = 0",
        (_hash_token_recuperacion(token),),
    )
    return n > 0


# -----------------------------------------------------------------------------
# Catalogos
# -----------------------------------------------------------------------------

def listar_tipos() -> list[dict[str, Any]]:
    return query_all("SELECT TipoId, Codigo, Nombre, Icono FROM dbo.TiposPropiedad ORDER BY Nombre")


def listar_ciudades() -> list[dict[str, Any]]:
    return query_all(
        "SELECT c.CiudadId, c.Nombre, c.Region, c.ImagenUrl, "
        f"(SELECT COUNT(*) FROM dbo.Propiedades p WHERE p.CiudadId = c.CiudadId AND {_SQL_ESTADO_PUBLICO}) AS Total "
        "FROM dbo.Ciudades c ORDER BY Total DESC, c.Nombre"
    )


def listar_ciudades_simple() -> list[dict[str, Any]]:
    return query_all("SELECT CiudadId, Nombre FROM dbo.Ciudades ORDER BY Nombre")


def stats_categorias() -> list[dict[str, Any]]:
    return query_all(
        "SELECT t.TipoId, t.Codigo, t.Nombre, t.Icono, "
        "COUNT(p.PropiedadId) AS Total "
        "FROM dbo.TiposPropiedad t "
        f"LEFT JOIN dbo.Propiedades p ON p.TipoId = t.TipoId AND {_SQL_ESTADO_PUBLICO} "
        "GROUP BY t.TipoId, t.Codigo, t.Nombre, t.Icono "
        "ORDER BY Total DESC"
    )


# -----------------------------------------------------------------------------
# Propiedades
# -----------------------------------------------------------------------------

_PROPIEDAD_SELECT = f"""
    SELECT p.PropiedadId, p.Titulo, p.Descripcion, p.Direccion, p.Distrito,
           p.Precio, p.Moneda, p.AreaTotal, p.AreaConstruida,
           p.Habitaciones, p.Banos, p.Cocheras, p.Operacion, p.Destacada, p.Estado,
           p.FechaCreacion, p.Vistas, p.Latitud, p.Longitud, p.PoligonoLote,
           p.PlanMasterplan,
           p.UtmZona, p.UtmEste, p.UtmNorte, p.AreaMapaM2, p.UtmVertices,
           t.TipoId, t.Codigo AS TipoCodigo, t.Nombre AS TipoNombre, t.Icono AS TipoIcono,
           c.CiudadId, c.Nombre AS Ciudad, c.Region,
           u.UsuarioId, u.NombreCompleto AS Anunciante, u.Telefono AS AnuncianteTelefono,
           u.Email AS AnuncianteEmail, u.EsAgente,
           {imagen_principal_subquery()} AS ImagenPrincipal
    FROM {T('Propiedades')} p
    JOIN {T('TiposPropiedad')} t ON t.TipoId = p.TipoId
    JOIN {T('Ciudades')} c       ON c.CiudadId = p.CiudadId
    JOIN {T('Usuarios')} u       ON u.UsuarioId = p.UsuarioId
"""


def rango_precios_catalogo(
    piso: int = 0,
    techo: int = 3_000_000,
    paso: int = 10_000,
) -> dict[str, int]:
    """Limites del slider de precio segun anuncios activos."""
    row = query_one(
        f"SELECT MIN(p.Precio) AS MinP, MAX(p.Precio) AS MaxP "
        f"FROM dbo.Propiedades p WHERE {_SQL_ESTADO_PUBLICO}"
    )
    min_db = max_db = None
    if row:
        try:
            if row.get("MinP") is not None:
                min_db = float(row["MinP"])
            if row.get("MaxP") is not None:
                max_db = float(row["MaxP"])
        except (TypeError, ValueError):
            pass

    min_val = piso
    if min_db is not None and min_db > 0:
        min_val = max(piso, int(min_db // paso) * paso)

    max_val = techo
    if max_db is not None and max_db > 0:
        redondeado = int((max_db + paso - 1) // paso) * paso
        max_val = min(techo, max(redondeado, min_val + paso))

    if max_val <= min_val:
        max_val = min_val + paso

    return {"min": min_val, "max": max_val, "step": paso}


def buscar_propiedades(
    operacion: str | None = None,
    tipo_codigo: str | None = None,
    ciudad_id: int | None = None,
    distrito: str | None = None,
    precio_min: float | None = None,
    precio_max: float | None = None,
    habitaciones_min: int | None = None,
    banos_min: int | None = None,
    area_min: float | None = None,
    area_max: float | None = None,
    solo_terreno: bool = False,
    con_plano: bool = False,
    texto: str | None = None,
    solo_destacadas: bool = False,
    orden: str = "recientes",
    pagina: int = 1,
    por_pagina: int = 12,
) -> dict[str, Any]:
    where_sql, params = _where_busqueda(
        operacion=operacion,
        tipo_codigo=tipo_codigo,
        ciudad_id=ciudad_id,
        distrito=distrito,
        precio_min=precio_min,
        precio_max=precio_max,
        habitaciones_min=habitaciones_min,
        banos_min=banos_min,
        area_min=area_min,
        area_max=area_max,
        solo_terreno=solo_terreno,
        con_plano=con_plano,
        texto=texto,
        solo_destacadas=solo_destacadas,
    )

    order_map = {
        "recientes":  "p.FechaCreacion DESC",
        "precio_asc": "p.Precio ASC",
        "precio_desc":"p.Precio DESC",
        "destacadas": "p.Destacada DESC, p.FechaCreacion DESC",
    }
    order_sql = " ORDER BY " + order_map.get(orden, order_map["recientes"])

    total = execute_scalar(
        "SELECT COUNT(*) FROM dbo.Propiedades p "
        "JOIN dbo.TiposPropiedad t ON t.TipoId = p.TipoId "
        "JOIN dbo.Ciudades c ON c.CiudadId = p.CiudadId" + where_sql,
        params,
    ) or 0

    offset = max(0, (pagina - 1) * por_pagina)
    sql = (
        _PROPIEDAD_SELECT
        + where_sql
        + order_sql
        + page(offset, por_pagina)
    )
    rows = query_all(sql, params + [offset, por_pagina])

    return {
        "propiedades": rows,
        "total": total,
        "pagina": pagina,
        "por_pagina": por_pagina,
        "paginas": max(1, (total + por_pagina - 1) // por_pagina),
    }


def _where_busqueda(
    operacion: str | None = None,
    tipo_codigo: str | None = None,
    ciudad_id: int | None = None,
    distrito: str | None = None,
    precio_min: float | None = None,
    precio_max: float | None = None,
    habitaciones_min: int | None = None,
    banos_min: int | None = None,
    area_min: float | None = None,
    area_max: float | None = None,
    solo_terreno: bool = False,
    con_plano: bool = False,
    texto: str | None = None,
    solo_destacadas: bool = False,
) -> tuple[str, list[Any]]:
    where = [_SQL_ESTADO_PUBLICO]
    params: list[Any] = []

    if operacion in {"venta", "alquiler"}:
        where.append("p.Operacion = ?")
        params.append(operacion)
    if tipo_codigo:
        where.append("t.Codigo = ?")
        params.append(tipo_codigo)
    elif solo_terreno:
        where.append("t.Codigo = N'terreno'")
    if ciudad_id:
        where.append("p.CiudadId = ?")
        params.append(ciudad_id)
    if distrito:
        where.append("p.Distrito LIKE ?")
        params.append(f"%{distrito.strip()}%")
    if precio_min is not None:
        where.append("p.Precio >= ?")
        params.append(precio_min)
    if precio_max is not None:
        where.append("p.Precio <= ?")
        params.append(precio_max)
    if habitaciones_min is not None:
        where.append("p.Habitaciones >= ?")
        params.append(habitaciones_min)
    if banos_min is not None:
        where.append("p.Banos >= ?")
        params.append(banos_min)
    if area_min is not None:
        where.append("p.AreaTotal >= ?")
        params.append(area_min)
    if area_max is not None:
        where.append("p.AreaTotal <= ?")
        params.append(area_max)
    if con_plano:
        where.append(
            f"(p.PlanMasterplan IS NOT NULL AND {str_len('p.PlanMasterplan')} > 10 "
            f"OR p.PoligonoLote IS NOT NULL AND {str_len('p.PoligonoLote')} > 10)"
        )
    if texto:
        where.append("(p.Titulo LIKE ? OR p.Descripcion LIKE ? OR p.Distrito LIKE ? OR c.Nombre LIKE ? OR p.Direccion LIKE ?)")
        like = f"%{texto}%"
        params.extend([like, like, like, like, like])
    if solo_destacadas:
        where.append("p.Destacada = 1")

    return " WHERE " + " AND ".join(where), params


def propiedades_para_mapa(
    operacion: str | None = None,
    tipo_codigo: str | None = None,
    ciudad_id: int | None = None,
    distrito: str | None = None,
    precio_min: float | None = None,
    precio_max: float | None = None,
    habitaciones_min: int | None = None,
    banos_min: int | None = None,
    area_min: float | None = None,
    area_max: float | None = None,
    solo_terreno: bool = False,
    con_plano: bool = False,
    texto: str | None = None,
    limite: int = 500,
) -> list[dict[str, Any]]:
    """Propiedades activas con coordenadas para el mapa interactivo."""
    where_sql, params = _where_busqueda(
        operacion=operacion,
        tipo_codigo=tipo_codigo,
        ciudad_id=ciudad_id,
        distrito=distrito,
        precio_min=precio_min,
        precio_max=precio_max,
        habitaciones_min=habitaciones_min,
        banos_min=banos_min,
        area_min=area_min,
        area_max=area_max,
        solo_terreno=solo_terreno,
        con_plano=con_plano,
        texto=texto,
    )
    limite = max(1, min(300, limite))
    sql = (
        _PROPIEDAD_SELECT
        + where_sql
        + " ORDER BY p.Destacada DESC, p.FechaCreacion DESC "
        + " OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY"
    )
    rows = query_all(sql, params + [limite])
    items: list[dict[str, Any]] = []
    for r in rows:
        item = _fila_a_item_mapa(r)
        if item:
            items.append(item)
    return items


def _fila_a_item_mapa(r: dict[str, Any]) -> dict[str, Any] | None:
    lat, lng = resolver_coordenadas(r)
    if lat is None or lng is None:
        return None
    return {
        "id": r["PropiedadId"],
        "titulo": r["Titulo"],
        "operacion": r["Operacion"],
        "tipo_codigo": r["TipoCodigo"],
        "tipo": r["TipoNombre"],
        "ciudad": r["Ciudad"],
        "distrito": r.get("Distrito"),
        "precio": float(r["Precio"]) if r.get("Precio") is not None else None,
        "moneda": r["Moneda"],
        "area_total": float(r["AreaTotal"]) if r.get("AreaTotal") is not None else None,
        "habitaciones": r.get("Habitaciones"),
        "imagen": r.get("ImagenPrincipal"),
        "destacada": bool(r.get("Destacada")),
        "lat": lat,
        "lng": lng,
        "telefono": r.get("AnuncianteTelefono"),
        "anunciante": r.get("Anunciante"),
        "poligono": r.get("PoligonoLote"),
        "plan_masterplan": r.get("PlanMasterplan"),
    }


def propiedad_por_id(pid: int) -> Optional[dict[str, Any]]:
    return query_one(_PROPIEDAD_SELECT + " WHERE p.PropiedadId = ?", (pid,))


def imagenes_de(pid: int) -> list[dict[str, Any]]:
    return query_all(
        "SELECT ImagenId, Url, EsPrincipal, Orden FROM dbo.ImagenesPropiedad "
        "WHERE PropiedadId = ? ORDER BY EsPrincipal DESC, Orden",
        (pid,),
    )


def registrar_vista(pid: int) -> None:
    try:
        execute(f"UPDATE {T('Propiedades')} SET Vistas = Vistas + 1 WHERE PropiedadId = ?", (pid,))
        execute(upsert_vista_diaria_sql(), (pid,))
    except Exception:
        pass


def registrar_evento_lote(
    propiedad_id: int,
    lote_ref: str,
    *,
    tipo_evento: str = "view",
    session_id: str | None = None,
    usuario_id: int | None = None,
) -> None:
    ref = (lote_ref or "").strip()[:80]
    if not ref:
        return
    try:
        execute(
            """
            INSERT INTO dbo.LoteEventos
                (PropiedadId, LoteRef, TipoEvento, SessionId, UsuarioId)
            VALUES (?, ?, ?, ?, ?)
            """,
            (propiedad_id, ref, (tipo_evento or "view")[:30], session_id, usuario_id),
        )
    except Exception:
        pass


def _rango_dias_utc(dias: int) -> tuple[datetime, datetime]:
    hoy = datetime.now(timezone.utc).date()
    inicio = hoy - timedelta(days=max(1, dias) - 1)
    return (
        datetime.combine(inicio, datetime.min.time()).replace(tzinfo=timezone.utc),
        datetime.combine(hoy, datetime.max.time()).replace(tzinfo=timezone.utc),
    )


def _serie_dias_llena(
    filas: list[dict[str, Any]],
    dias: int,
    *,
    campo_fecha: str = "Fecha",
    campo_total: str = "Total",
) -> list[dict[str, Any]]:
    hoy = datetime.now(timezone.utc).date()
    mapa: dict[str, int] = {}
    for r in filas:
        raw = r.get(campo_fecha)
        if isinstance(raw, datetime):
            key = raw.date().isoformat()
        else:
            key = str(raw)[:10]
        mapa[key] = int(r.get(campo_total) or 0)
    serie: list[dict[str, Any]] = []
    for i in range(dias - 1, -1, -1):
        d = hoy - timedelta(days=i)
        key = d.isoformat()
        serie.append({"fecha": key, "total": mapa.get(key, 0)})
    return serie


def contar_lotes_estado_usuario(usuario_id: int) -> dict[str, int]:
    rows = query_all(
        "SELECT PlanMasterplan FROM dbo.Propiedades WHERE UsuarioId = ? AND PlanMasterplan IS NOT NULL",
        (usuario_id,),
    )
    counts = {"disponible": 0, "reservado": 0, "vendido": 0}
    for row in rows:
        plan = parse_plan_masterplan(row.get("PlanMasterplan"))
        if not plan:
            continue
        for feat in plan.get("features") or []:
            if (feat.get("tipo") or "lote") == "calle":
                continue
            if not feat.get("path") and not feat.get("localPath"):
                continue
            estado = feat.get("estado") or "disponible"
            if estado in counts:
                counts[estado] += 1
    return counts


def analytics_anunciante(usuario_id: int, *, dias: int = 28) -> dict[str, Any]:
    dias = max(7, min(90, int(dias)))
    inicio_actual, fin_actual = _rango_dias_utc(dias)
    inicio_anterior = inicio_actual - timedelta(days=dias)

    vistas_rows = query_all(
        """
        SELECT v.Fecha, SUM(v.TotalVistas) AS Total
        FROM dbo.PropiedadVistasDiarias v
        INNER JOIN dbo.Propiedades p ON p.PropiedadId = v.PropiedadId
        WHERE p.UsuarioId = ?
          AND v.Fecha >= CAST(? AS DATE)
        GROUP BY v.Fecha
        ORDER BY v.Fecha
        """,
        (usuario_id, inicio_actual.date()),
    )
    vistas_chart = _serie_dias_llena(vistas_rows, dias)

    total_actual = sum(p["total"] for p in vistas_chart)
    total_anterior = execute_scalar(
        """
        SELECT COALESCE(SUM(v.TotalVistas), 0)
        FROM dbo.PropiedadVistasDiarias v
        INNER JOIN dbo.Propiedades p ON p.PropiedadId = v.PropiedadId
        WHERE p.UsuarioId = ?
          AND v.Fecha >= CAST(? AS DATE)
          AND v.Fecha < CAST(? AS DATE)
        """,
        (usuario_id, inicio_anterior.date(), inicio_actual.date()),
    ) or 0
    promedio_anterior = round(float(total_anterior) / dias, 1) if dias else 0
    promedio_actual = round(float(total_actual) / dias, 1) if dias else 0
    delta = int(total_actual - float(total_anterior))

    lote_rows = query_all(
        """
        SELECT CAST(e.FechaHora AS DATE) AS Fecha, COUNT(*) AS Total
        FROM dbo.LoteEventos e
        INNER JOIN dbo.Propiedades p ON p.PropiedadId = e.PropiedadId
        WHERE p.UsuarioId = ?
          AND e.FechaHora >= ?
        GROUP BY CAST(e.FechaHora AS DATE)
        ORDER BY CAST(e.FechaHora AS DATE)
        """,
        (usuario_id, inicio_actual),
    )
    lotes_chart = _serie_dias_llena(lote_rows, dias)

    top_lotes = query_all(
        f"""
        SELECT
            e.PropiedadId,
            p.Titulo,
            e.LoteRef,
            COUNT(*) AS Eventos
        FROM {T('LoteEventos')} e
        INNER JOIN {T('Propiedades')} p ON p.PropiedadId = e.PropiedadId
        WHERE p.UsuarioId = ?
          AND e.FechaHora >= ?
        GROUP BY e.PropiedadId, p.Titulo, e.LoteRef
        ORDER BY COUNT(*) DESC
        """
        + page_limit(8),
        (usuario_id, inicio_actual),
    )

    dia_pico = max(vistas_chart, key=lambda x: x["total"], default={"fecha": None, "total": 0})
    dia_pico_lotes = max(lotes_chart, key=lambda x: x["total"], default={"fecha": None, "total": 0})

    return {
        "dias": dias,
        "vistas_chart": vistas_chart,
        "vistas_total": total_actual,
        "vistas_delta": delta,
        "vistas_promedio": promedio_actual,
        "vistas_promedio_anterior": promedio_anterior,
        "lotes_chart": lotes_chart,
        "lotes_eventos_total": sum(p["total"] for p in lotes_chart),
        "lotes_estado": contar_lotes_estado_usuario(usuario_id),
        "top_lotes": [
            {
                "propiedad_id": int(r["PropiedadId"]),
                "titulo": r["Titulo"],
                "lote_ref": r["LoteRef"],
                "eventos": int(r["Eventos"]),
            }
            for r in top_lotes
        ],
        "dia_pico_vistas": dia_pico,
        "dia_pico_lotes": dia_pico_lotes,
    }


def crear_propiedad(data: dict[str, Any]) -> int:
    with cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {T('Propiedades')}
                (UsuarioId, TipoId, CiudadId, Operacion, Titulo, Descripcion,
                 Direccion, Distrito, Precio, Moneda, AreaTotal, AreaConstruida,
                 Habitaciones, Banos, Cocheras, Latitud, Longitud, PoligonoLote,
                 PlanMasterplan, UtmZona, UtmEste, UtmNorte, AreaMapaM2, UtmVertices)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["usuario_id"], data["tipo_id"], data["ciudad_id"], data["operacion"],
                data["titulo"], data.get("descripcion"), data.get("direccion"), data.get("distrito"),
                data["precio"], data.get("moneda", "PEN"),
                data.get("area_total"), data.get("area_construida"),
                data.get("habitaciones"), data.get("banos"), data.get("cocheras"),
                data.get("latitud"), data.get("longitud"), data.get("poligono_lote"),
                data.get("plan_masterplan"),
                data.get("utm_zona"), data.get("utm_este"), data.get("utm_norte"),
                data.get("area_mapa_m2"), data.get("utm_vertices"),
            ),
        )
        return fetch_inserted_id(cur)


def agregar_imagen(propiedad_id: int, url: str, es_principal: bool = False, orden: int = 0) -> None:
    execute(
        "INSERT INTO dbo.ImagenesPropiedad (PropiedadId, Url, EsPrincipal, Orden) VALUES (?, ?, ?, ?)",
        (propiedad_id, url, 1 if es_principal else 0, orden),
    )


def propiedades_de_usuario(usuario_id: int) -> list[dict[str, Any]]:
    return query_all(
        _PROPIEDAD_SELECT
        + " WHERE p.UsuarioId = ? "
        + " ORDER BY p.FechaCreacion DESC",
        (usuario_id,),
    )


def es_dueno_propiedad(usuario_id: int, propiedad_id: int) -> bool:
    return bool(
        execute_scalar(
            "SELECT 1 FROM dbo.Propiedades WHERE PropiedadId = ? AND UsuarioId = ?",
            (propiedad_id, usuario_id),
        )
    )


def actualizar_estado_propiedad(propiedad_id: int, estado: str) -> None:
    execute(
        "UPDATE dbo.Propiedades SET Estado = ? WHERE PropiedadId = ?",
        (estado, propiedad_id),
    )


def reactivar_todos_anuncios_usuario(usuario_id: int) -> int:
    """Reactiva anuncios deshabilitados del usuario. Devuelve cantidad actualizada."""
    with cursor() as cur:
        cur.execute(
            "UPDATE dbo.Propiedades SET Estado = 'activo' "
            "WHERE UsuarioId = ? AND Estado = 'inactivo'",
            (usuario_id,),
        )
        return cur.rowcount


def eliminar_propiedad(propiedad_id: int) -> None:
    execute("DELETE FROM dbo.Propiedades WHERE PropiedadId = ?", (propiedad_id,))


def actualizar_propiedad(propiedad_id: int, data: dict[str, Any]) -> None:
    execute(
        """
        UPDATE dbo.Propiedades SET
            TipoId = ?, CiudadId = ?, Operacion = ?, Titulo = ?, Descripcion = ?,
            Direccion = ?, Distrito = ?, Precio = ?, Moneda = ?, AreaTotal = ?,
            AreaConstruida = ?, Habitaciones = ?, Banos = ?, Cocheras = ?,
            Latitud = ?, Longitud = ?, PoligonoLote = ?, PlanMasterplan = ?,
            UtmZona = ?, UtmEste = ?, UtmNorte = ?, AreaMapaM2 = ?, UtmVertices = ?
        WHERE PropiedadId = ?
        """,
        (
            data["tipo_id"], data["ciudad_id"], data["operacion"],
            data["titulo"], data.get("descripcion"), data.get("direccion"), data.get("distrito"),
            data["precio"], data.get("moneda", "PEN"),
            data.get("area_total"), data.get("area_construida"),
            data.get("habitaciones"), data.get("banos"), data.get("cocheras"),
            data.get("latitud"), data.get("longitud"), data.get("poligono_lote"),
            data.get("plan_masterplan"),
            data.get("utm_zona"), data.get("utm_este"), data.get("utm_norte"),
            data.get("area_mapa_m2"), data.get("utm_vertices"),
            propiedad_id,
        ),
    )


def eliminar_imagen(imagen_id: int, propiedad_id: int) -> str | None:
    """Elimina una imagen y devuelve su URL (para borrar archivo local si aplica)."""
    row = query_one(
        "SELECT Url FROM dbo.ImagenesPropiedad WHERE ImagenId = ? AND PropiedadId = ?",
        (imagen_id, propiedad_id),
    )
    if not row:
        return None
    execute(
        "DELETE FROM dbo.ImagenesPropiedad WHERE ImagenId = ? AND PropiedadId = ?",
        (imagen_id, propiedad_id),
    )
    return row["Url"]


def marcar_imagen_principal(imagen_id: int, propiedad_id: int) -> bool:
    existe = execute_scalar(
        "SELECT 1 FROM dbo.ImagenesPropiedad WHERE ImagenId = ? AND PropiedadId = ?",
        (imagen_id, propiedad_id),
    )
    if not existe:
        return False
    execute(
        "UPDATE dbo.ImagenesPropiedad SET EsPrincipal = 0 WHERE PropiedadId = ?",
        (propiedad_id,),
    )
    execute(
        "UPDATE dbo.ImagenesPropiedad SET EsPrincipal = 1 WHERE ImagenId = ? AND PropiedadId = ?",
        (imagen_id, propiedad_id),
    )
    return True


def videos_de(pid: int) -> list[dict[str, Any]]:
    return query_all(
        "SELECT VideoId, UrlOriginal, Plataforma, UrlEmbed, Orden "
        "FROM dbo.VideosPropiedad WHERE PropiedadId = ? ORDER BY Orden, VideoId",
        (pid,),
    )


def agregar_video(
    propiedad_id: int,
    url_original: str,
    plataforma: str,
    url_embed: str,
    orden: int = 0,
) -> None:
    execute(
        "INSERT INTO dbo.VideosPropiedad "
        "(PropiedadId, UrlOriginal, Plataforma, UrlEmbed, Orden) VALUES (?, ?, ?, ?, ?)",
        (propiedad_id, url_original, plataforma, url_embed, orden),
    )


def eliminar_video(video_id: int, propiedad_id: int) -> bool:
    n = execute(
        "DELETE FROM dbo.VideosPropiedad WHERE VideoId = ? AND PropiedadId = ?",
        (video_id, propiedad_id),
    )
    return bool(n)


def contar_videos(propiedad_id: int) -> int:
    return int(
        execute_scalar(
            "SELECT COUNT(*) FROM dbo.VideosPropiedad WHERE PropiedadId = ?",
            (propiedad_id,),
        )
        or 0
    )


def propiedades_destacadas(limit: int = 6) -> list[dict[str, Any]]:
    return query_all(
        _PROPIEDAD_SELECT
        + f" WHERE {_SQL_ESTADO_PUBLICO} AND p.Destacada = 1 "
        + " ORDER BY p.FechaCreacion DESC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY",
        (limit,),
    )


def propiedades_recientes(limit: int = 12) -> list[dict[str, Any]]:
    return query_all(
        _PROPIEDAD_SELECT
        + f" WHERE {_SQL_ESTADO_PUBLICO} "
        + " ORDER BY p.FechaCreacion DESC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY",
        (limit,),
    )


def propiedades_para_sitemap(limit: int = 5000) -> list[dict[str, Any]]:
    """IDs y fechas de anuncios publicos (para sitemap.xml)."""
    return query_all(
        "SELECT p.PropiedadId, p.FechaCreacion "
        f"FROM dbo.Propiedades p WHERE {_SQL_ESTADO_PUBLICO} "
        "ORDER BY p.FechaCreacion DESC "
        "OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY",
        (limit,),
    )


def guardar_contacto(propiedad_id: int, nombre: str, email: str, telefono: str | None, mensaje: str) -> None:
    execute(
        "INSERT INTO dbo.Contactos (PropiedadId, Nombre, Email, Telefono, Mensaje) "
        "VALUES (?, ?, ?, ?, ?)",
        (propiedad_id, nombre, email, telefono, mensaje),
    )


def consultas_de_usuario(
    usuario_id: int,
    *,
    propiedad_id: int | None = None,
    limite: int = 200,
) -> list[dict[str, Any]]:
    """Consultas recibidas en los anuncios del usuario."""
    sql = (
        "SELECT c.ContactoId, c.PropiedadId, c.Nombre, c.Email, c.Telefono, c.Mensaje, c.FechaEnvio, "
        "p.Titulo, p.Operacion, p.Distrito, p.Estado, ci.Nombre AS Ciudad "
        "FROM dbo.Contactos c "
        "JOIN dbo.Propiedades p ON p.PropiedadId = c.PropiedadId "
        "JOIN dbo.Ciudades ci ON ci.CiudadId = p.CiudadId "
        "WHERE p.UsuarioId = ?"
    )
    params: list[Any] = [usuario_id]
    if propiedad_id is not None:
        sql += " AND c.PropiedadId = ?"
        params.append(propiedad_id)
    sql += " ORDER BY c.FechaEnvio DESC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY"
    params.append(limite)
    return query_all(sql, params)


def contar_consultas_usuario(usuario_id: int) -> int:
    n = execute_scalar(
        "SELECT COUNT(*) FROM dbo.Contactos c "
        "JOIN dbo.Propiedades p ON p.PropiedadId = c.PropiedadId "
        "WHERE p.UsuarioId = ?",
        (usuario_id,),
    )
    try:
        return int(n or 0)
    except (TypeError, ValueError):
        return 0


# -----------------------------------------------------------------------------
# Favoritos
# -----------------------------------------------------------------------------

def toggle_favorito(usuario_id: int, propiedad_id: int) -> bool:
    """Devuelve True si quedo marcado como favorito, False si se removio."""
    existe = execute_scalar(
        "SELECT 1 FROM dbo.Favoritos WHERE UsuarioId = ? AND PropiedadId = ?",
        (usuario_id, propiedad_id),
    )
    if existe:
        execute(
            "DELETE FROM dbo.Favoritos WHERE UsuarioId = ? AND PropiedadId = ?",
            (usuario_id, propiedad_id),
        )
        return False
    execute(
        "INSERT INTO dbo.Favoritos (UsuarioId, PropiedadId) VALUES (?, ?)",
        (usuario_id, propiedad_id),
    )
    return True


def favoritos_de(usuario_id: int) -> list[dict[str, Any]]:
    return query_all(
        _PROPIEDAD_SELECT
        + " JOIN dbo.Favoritos f ON f.PropiedadId = p.PropiedadId "
        + f" WHERE f.UsuarioId = ? AND {_SQL_ESTADO_PUBLICO} "
        + " ORDER BY f.FechaAgregado DESC",
        (usuario_id,),
    )


def favoritos_por_ids(usuario_id: int, propiedad_ids: list[int]) -> list[dict[str, Any]]:
    ids = [int(i) for i in propiedad_ids if isinstance(i, int) or str(i).isdigit()]
    ids = [i for i in ids if i > 0][:6]
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    return query_all(
        _PROPIEDAD_SELECT
        + " JOIN dbo.Favoritos f ON f.PropiedadId = p.PropiedadId "
        + f" WHERE f.UsuarioId = ? AND p.PropiedadId IN ({placeholders}) AND {_SQL_ESTADO_PUBLICO}",
        [usuario_id] + ids,
    )


def es_favorito(usuario_id: int, propiedad_id: int) -> bool:
    return bool(
        execute_scalar(
            "SELECT 1 FROM dbo.Favoritos WHERE UsuarioId = ? AND PropiedadId = ?",
            (usuario_id, propiedad_id),
        )
    )


# -----------------------------------------------------------------------------
# Listas compartidas (mapa privado por enlace)
# -----------------------------------------------------------------------------

def lista_compartida_por_token(token: str) -> dict[str, Any] | None:
    if not token or len(token) < 16:
        return None
    return query_one(
        """
        SELECT l.ListaId, l.UsuarioId, l.Token, l.Titulo, l.FechaCreacion, l.Activa,
               u.NombreCompleto AS PropietarioNombre, u.Email AS PropietarioEmail,
               u.Telefono AS PropietarioTelefono, u.FotoUrl AS PropietarioFoto,
               u.EsAgente AS PropietarioEsAgente
        FROM dbo.ListasCompartidas l
        JOIN dbo.Usuarios u ON u.UsuarioId = l.UsuarioId
        WHERE l.Token = ? AND l.Activa = 1
        """,
        (token.strip(),),
    )


def propiedad_en_lista_compartida(token: str, propiedad_id: int) -> bool:
    lista = lista_compartida_por_token(token)
    if not lista:
        return False
    return bool(
        execute_scalar(
            """
            SELECT 1 FROM dbo.ListasCompartidasPropiedades lp
            WHERE lp.ListaId = ? AND lp.PropiedadId = ?
            """,
            (lista["ListaId"], propiedad_id),
        )
    )


def ids_propiedades_de_lista(lista_id: int) -> list[int]:
    rows = query_all(
        "SELECT PropiedadId FROM dbo.ListasCompartidasPropiedades WHERE ListaId = ? ORDER BY PropiedadId",
        (lista_id,),
    )
    return [int(r["PropiedadId"]) for r in rows]


def crear_lista_compartida(
    usuario_id: int,
    titulo: str,
    propiedad_ids: list[int],
) -> dict[str, Any]:
    import secrets

    titulo = (titulo or "Seleccion de propiedades").strip()[:200]
    ids_unicos: list[int] = []
    for pid in propiedad_ids:
        pid = int(pid)
        if pid not in ids_unicos and es_dueno_propiedad(usuario_id, pid):
            ids_unicos.append(pid)
    if not ids_unicos:
        raise ValueError("Selecciona al menos un anuncio tuyo para compartir.")

    token = secrets.token_urlsafe(32)
    with cursor() as cur:
        cur.execute(
            f"INSERT INTO {T('ListasCompartidas')} (UsuarioId, Token, Titulo, Activa) VALUES (?, ?, ?, 1)",
            (usuario_id, token, titulo),
        )
        lista_id = fetch_inserted_id(cur)
        for pid in ids_unicos:
            cur.execute(
                "INSERT INTO dbo.ListasCompartidasPropiedades (ListaId, PropiedadId) VALUES (?, ?)",
                (lista_id, pid),
            )
    return {
        "lista_id": lista_id,
        "token": token,
        "titulo": titulo,
        "total": len(ids_unicos),
    }


def listas_compartidas_de_usuario(usuario_id: int) -> list[dict[str, Any]]:
    return query_all(
        """
        SELECT l.ListaId, l.Token, l.Titulo, l.FechaCreacion, l.Activa,
               COALESCE(l.Vistas, 0) AS Vistas,
               (SELECT COUNT(*) FROM dbo.ListasCompartidasPropiedades lp
                WHERE lp.ListaId = l.ListaId) AS TotalPropiedades
        FROM dbo.ListasCompartidas l
        WHERE l.UsuarioId = ? AND l.Activa = 1
        ORDER BY l.FechaCreacion DESC
        """,
        (usuario_id,),
    )


def registrar_vista_lista_compartida(token: str) -> None:
    if not token or len(token) < 16:
        return
    execute(
        "UPDATE dbo.ListasCompartidas SET Vistas = COALESCE(Vistas, 0) + 1 "
        "WHERE Token = ? AND Activa = 1",
        (token.strip(),),
    )


def desactivar_lista_compartida(usuario_id: int, lista_id: int) -> bool:
    n = execute(
        "UPDATE dbo.ListasCompartidas SET Activa = 0 WHERE ListaId = ? AND UsuarioId = ? AND Activa = 1",
        (lista_id, usuario_id),
    )
    return bool(n)


def estadisticas_mapa_compartido(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Resumen de anuncios incluidos en un mapa compartido."""
    if not rows:
        return {
            "total": 0,
            "en_mapa": 0,
            "ventas": 0,
            "alquileres": 0,
            "precio_min": None,
            "precio_max": None,
            "precio_desde": None,
            "moneda": "PEN",
            "ciudades": [],
            "tipos": [],
        }

    ventas = 0
    alquileres = 0
    precios: list[float] = []
    ciudades: dict[str, int] = {}
    tipos: dict[str, int] = {}
    en_mapa = 0
    moneda = "PEN"

    for r in rows:
        op = r.get("Operacion")
        if op == "venta":
            ventas += 1
        elif op == "alquiler":
            alquileres += 1
        moneda = r.get("Moneda") or moneda
        try:
            listing = float(r["Precio"]) if r.get("Precio") is not None else None
        except (TypeError, ValueError):
            listing = None
        min_p = calc_min_lote_price(
            r.get("PlanMasterplan"),
            listing,
            r.get("AreaTotal"),
            r.get("Moneda"),
        )
        show_p = min_p if min_p is not None else listing
        if show_p is not None and show_p > 0:
            precios.append(float(show_p))
        ciudad = (r.get("Ciudad") or "").strip() or "—"
        ciudades[ciudad] = ciudades.get(ciudad, 0) + 1
        tipo = (r.get("TipoNombre") or "Otro").strip()
        tipos[tipo] = tipos.get(tipo, 0) + 1
        lat, lng = resolver_coordenadas(r)
        if lat is not None and lng is not None:
            en_mapa += 1

    return {
        "total": len(rows),
        "en_mapa": en_mapa,
        "ventas": ventas,
        "alquileres": alquileres,
        "precio_min": min(precios) if precios else None,
        "precio_max": max(precios) if precios else None,
        "precio_desde": min(precios) if precios else None,
        "moneda": moneda,
        "ciudades": sorted(ciudades.items(), key=lambda x: (-x[1], x[0])),
        "tipos": sorted(tipos.items(), key=lambda x: (-x[1], x[0])),
    }


def propiedades_para_mapa_compartido(
    token: str,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], dict[str, Any]]:
    lista = lista_compartida_por_token(token)
    vacio = estadisticas_mapa_compartido([])
    if not lista:
        return None, [], vacio
    pids = ids_propiedades_de_lista(int(lista["ListaId"]))
    if not pids:
        return lista, [], vacio
    placeholders = ",".join("?" * len(pids))
    sql = (
        _PROPIEDAD_SELECT
        + f" WHERE p.PropiedadId IN ({placeholders}) AND p.UsuarioId = ? "
        + " ORDER BY p.FechaCreacion DESC"
    )
    rows = query_all(sql, pids + [int(lista["UsuarioId"])])
    stats = estadisticas_mapa_compartido(rows)
    items: list[dict[str, Any]] = []
    for r in rows:
        item = _fila_a_item_mapa(r)
        if item:
            items.append(item)
    return lista, items, stats
