"""Acceso a datos de la app MilOficios (BD separada en el mismo servidor SQL)."""
from __future__ import annotations

from typing import Any, Optional

from miloficios_db import mf_execute, mf_execute_scalar, mf_query_all, mf_query_one


def _bool(v: Any) -> bool:
    return bool(v) if v is not None else False


def _int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _long(v: Any, default: int = 0) -> int:
    return _int(v, default)


def _float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _str(v: Any, default: str = "") -> str:
    return str(v) if v is not None else default


def listar_maestros() -> list[dict[str, Any]]:
    rows = mf_query_all(
        """
        SELECT id, nombreCompleto, categoria, especialidadResumen, rating,
               trabajosCompletados, distrito, ciudad, precioMin, precioMax,
               verificado, enLinea, colorArgb
        FROM dbo.maestros
        """
    )
    return [
        {
            "id": _long(r["id"]),
            "nombreCompleto": _str(r["nombreCompleto"]),
            "categoria": _str(r["categoria"]),
            "especialidadResumen": _str(r["especialidadResumen"]),
            "rating": _float(r["rating"]),
            "trabajosCompletados": _int(r["trabajosCompletados"]),
            "distrito": _str(r["distrito"]),
            "ciudad": _str(r["ciudad"]),
            "precioMin": _int(r["precioMin"]),
            "precioMax": _int(r["precioMax"]),
            "verificado": _bool(r["verificado"]),
            "enLinea": _bool(r["enLinea"]),
            "colorArgb": _long(r["colorArgb"]),
        }
        for r in rows
    ]


def listar_publicaciones() -> list[dict[str, Any]]:
    rows = mf_query_all(
        """
        SELECT id, maestroId, titulo, descripcion, categoria, distrito, likes,
               imagenVariante, videoLocalPath, imagenLocalPath, imagenesGaleriaCsv
        FROM dbo.publicaciones
        """
    )
    return [
        {
            "id": _long(r["id"]),
            "maestroId": _long(r["maestroId"]),
            "titulo": _str(r["titulo"]),
            "descripcion": _str(r["descripcion"]),
            "categoria": _str(r["categoria"]),
            "distrito": _str(r["distrito"]),
            "likes": _int(r["likes"]),
            "imagenVariante": _int(r["imagenVariante"]),
            "videoLocalPath": _str(r["videoLocalPath"]),
            "imagenLocalPath": _str(r["imagenLocalPath"]),
            "imagenesGaleriaCsv": _str(r["imagenesGaleriaCsv"]),
        }
        for r in rows
    ]


def listar_conversaciones() -> list[dict[str, Any]]:
    rows = mf_query_all(
        """
        SELECT maestroId, estadoTag, noLeidos, ultimoMensaje, fechaEtiqueta,
               updatedAtMillis
        FROM dbo.conversaciones
        """
    )
    return [
        {
            "maestroId": _long(r["maestroId"]),
            "estadoTag": r.get("estadoTag"),
            "noLeidos": _int(r["noLeidos"]),
            "ultimoMensaje": _str(r["ultimoMensaje"]),
            "fechaEtiqueta": _str(r["fechaEtiqueta"]),
            "updatedAtMillis": _long(r["updatedAtMillis"]),
        }
        for r in rows
    ]


def listar_mensajes() -> list[dict[str, Any]]:
    rows = mf_query_all(
        """
        SELECT id, maestroId, texto, esMio, createdAtMillis, horaTexto
        FROM dbo.mensajes_chat
        ORDER BY maestroId ASC, id ASC
        """
    )
    return [
        {
            "id": _long(r["id"]),
            "maestroId": _long(r["maestroId"]),
            "texto": _str(r["texto"]),
            "esMio": _bool(r["esMio"]),
            "createdAtMillis": _long(r["createdAtMillis"]),
            "horaTexto": _str(r["horaTexto"]),
        }
        for r in rows
    ]


def listar_comentarios() -> list[dict[str, Any]]:
    rows = mf_query_all(
        """
        SELECT id, publicacionId, autorNombre, autorEmail, texto, createdAtMillis, esMio
        FROM dbo.comentarios
        ORDER BY publicacionId ASC, createdAtMillis ASC
        """
    )
    return [
        {
            "id": _long(r["id"]),
            "publicacionId": _long(r["publicacionId"]),
            "autorNombre": _str(r["autorNombre"]),
            "autorEmail": _str(r["autorEmail"]),
            "texto": _str(r["texto"]),
            "createdAtMillis": _long(r["createdAtMillis"]),
            "esMio": _bool(r["esMio"]),
        }
        for r in rows
    ]


def listar_usuarios() -> list[dict[str, Any]]:
    rows = mf_query_all(
        """
        SELECT id, email, nombreCompleto, authProvider, googleId, passwordSha256,
               tituloProfesional, distrito, ciudad, bio, esAdmin, adminMaestroId,
               createdAtMillis, ultimoAccesoMillis
        FROM dbo.usuarios
        ORDER BY ultimoAccesoMillis DESC
        """
    )
    return [
        {
            "id": _long(r["id"]),
            "email": _str(r["email"]),
            "nombreCompleto": _str(r["nombreCompleto"]),
            "authProvider": _str(r.get("authProvider"), "email"),
            "googleId": _str(r.get("googleId")),
            "passwordSha256": _str(r.get("passwordSha256")),
            "tituloProfesional": _str(r.get("tituloProfesional")),
            "distrito": _str(r.get("distrito")),
            "ciudad": _str(r.get("ciudad"), "Lima"),
            "bio": _str(r.get("bio")),
            "esAdmin": _bool(r.get("esAdmin")),
            "adminMaestroId": _long(r.get("adminMaestroId")),
            "createdAtMillis": _long(r["createdAtMillis"]),
            "ultimoAccesoMillis": _long(r["ultimoAccesoMillis"]),
        }
        for r in rows
    ]


def registrar_usuario(data: dict[str, Any]) -> Optional[int]:
    email = _str(data.get("email")).strip().lower()
    if not email:
        return None
    nombre = _str(data.get("nombreCompleto"))[:120]
    auth_provider = _str(data.get("authProvider"), "email")[:20]
    google_id = _str(data.get("googleId"))[:120]
    password_sha = _str(data.get("passwordSha256"))[:64]
    titulo = _str(data.get("tituloProfesional"))[:120]
    distrito = _str(data.get("distrito"))[:80]
    ciudad = _str(data.get("ciudad"), "Lima")[:80]
    bio = _str(data.get("bio"))[:500]
    es_admin = _bool(data.get("esAdmin"))
    admin_maestro_id = _long(data.get("adminMaestroId"))
    created_at = _long(data.get("createdAtMillis"))
    ultimo_acceso = _long(data.get("ultimoAccesoMillis"))

    actualizado = mf_execute(
        """
        UPDATE dbo.usuarios SET
            nombreCompleto = ?, authProvider = ?, googleId = ?, passwordSha256 = ?,
            tituloProfesional = ?, distrito = ?, ciudad = ?, bio = ?,
            esAdmin = ?, adminMaestroId = ?, ultimoAccesoMillis = ?
        WHERE email = ?
        """,
        (
            nombre, auth_provider, google_id, password_sha,
            titulo, distrito, ciudad, bio,
            es_admin, admin_maestro_id, ultimo_acceso,
            email,
        ),
    )
    if actualizado > 0:
        row = mf_query_one("SELECT id FROM dbo.usuarios WHERE email = ?", (email,))
        return _long(row["id"]) if row else None

    nuevo_id = mf_execute_scalar(
        """
        INSERT INTO dbo.usuarios
            (email, nombreCompleto, authProvider, googleId, passwordSha256,
             tituloProfesional, distrito, ciudad, bio, esAdmin, adminMaestroId,
             createdAtMillis, ultimoAccesoMillis)
        OUTPUT INSERTED.id
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            email, nombre, auth_provider, google_id, password_sha,
            titulo, distrito, ciudad, bio, es_admin, admin_maestro_id,
            created_at, ultimo_acceso,
        ),
    )
    return _long(nuevo_id) if nuevo_id is not None else None


def insertar_comentario(data: dict[str, Any]) -> Optional[int]:
    publicacion_id = _long(data.get("publicacionId"))
    texto = _str(data.get("texto")).strip()
    if not publicacion_id or not texto:
        return None
    nuevo_id = mf_execute_scalar(
        """
        INSERT INTO dbo.comentarios
            (publicacionId, autorNombre, autorEmail, texto, createdAtMillis, esMio)
        OUTPUT INSERTED.id
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            publicacion_id,
            _str(data.get("autorNombre"))[:120],
            _str(data.get("autorEmail"))[:200],
            texto[:500],
            _long(data.get("createdAtMillis")),
            _bool(data.get("esMio")),
        ),
    )
    return _long(nuevo_id) if nuevo_id is not None else None


def incrementar_like(publicacion_id: int) -> bool:
    if not publicacion_id:
        return False
    return mf_execute(
        "UPDATE dbo.publicaciones SET likes = likes + 1 WHERE id = ?",
        (publicacion_id,),
    ) > 0
