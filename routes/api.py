"""Endpoints JSON ligeros para autocomplete y filtros dinamicos."""
from flask import Blueprint, current_app, jsonify, request
from flask_login import current_user, login_user

import models
from models import Usuario

bp = Blueprint("api", __name__, url_prefix="/api")


def _filtros_api():
    args = request.args
    return {
        "operacion": args.get("operacion") or None,
        "tipo_codigo": args.get("tipo") or None,
        "ciudad_id": args.get("ciudad_id", type=int),
        "distrito": (args.get("distrito") or "").strip() or None,
        "precio_min": args.get("precio_min", type=float),
        "precio_max": args.get("precio_max", type=float),
        "habitaciones_min": args.get("habitaciones_min", type=int),
        "banos_min": args.get("banos_min", type=int),
        "area_min": args.get("area_min", type=float),
        "area_max": args.get("area_max", type=float),
        "solo_terreno": args.get("solo_terreno") == "1",
        "con_plano": args.get("con_plano") == "1",
        "texto": (args.get("q") or "").strip() or None,
    }


@bp.get("/ciudades")
def ciudades():
    return jsonify(models.listar_ciudades_simple())


@bp.get("/tipos")
def tipos():
    return jsonify(models.listar_tipos())


@bp.get("/autocomplete")
def autocomplete():
    q = (request.args.get("q") or "").strip()
    limite = min(24, max(1, request.args.get("limit", default=16, type=int)))
    data = models.sugerencias_busqueda_agrupadas(q, limit=limite)
    items: list = []
    for grupo in data.get("grupos", []):
        items.extend(grupo.get("items", []))
    data["items"] = items[:limite]
    return jsonify(data)


@bp.get("/buscar")
def buscar():
    args = request.args
    f = _filtros_api()
    resultado = models.buscar_propiedades(
        operacion=f["operacion"],
        tipo_codigo=f["tipo_codigo"],
        ciudad_id=f["ciudad_id"],
        distrito=f["distrito"],
        precio_min=f["precio_min"],
        precio_max=f["precio_max"],
        habitaciones_min=f["habitaciones_min"],
        banos_min=f["banos_min"],
        area_min=f["area_min"],
        area_max=f["area_max"],
        solo_terreno=f["solo_terreno"],
        con_plano=f["con_plano"],
        texto=f["texto"],
        orden=args.get("orden") or "recientes",
        pagina=max(1, args.get("pagina", default=1, type=int)),
        por_pagina=min(48, max(1, args.get("por_pagina", default=12, type=int))),
    )
    return jsonify(
        {
            "total": resultado["total"],
            "pagina": resultado["pagina"],
            "paginas": resultado["paginas"],
            "items": [
                {
                    "id": r["PropiedadId"],
                    "titulo": r["Titulo"],
                    "operacion": r["Operacion"],
                    "tipo": r["TipoNombre"],
                    "ciudad": r["Ciudad"],
                    "distrito": r.get("Distrito"),
                    "precio": float(r["Precio"]) if r.get("Precio") is not None else None,
                    "moneda": r["Moneda"],
                    "habitaciones": r.get("Habitaciones"),
                    "banos": r.get("Banos"),
                    "area_total": float(r["AreaTotal"]) if r.get("AreaTotal") is not None else None,
                    "imagen": r.get("ImagenPrincipal"),
                    "destacada": bool(r.get("Destacada")),
                    "telefono": r.get("AnuncianteTelefono"),
                    "anunciante": r.get("Anunciante"),
                }
                for r in resultado["propiedades"]
            ],
        }
    )


@bp.get("/mapa/compartido/<token>")
def mapa_compartido(token: str):
    lista, items, stats = models.propiedades_para_mapa_compartido(token)
    if not lista:
        return jsonify({"error": "Enlace no valido o expirado"}), 404
    return jsonify(
        {
            "total": len(items),
            "items": items,
            "stats": stats,
            "lista": {
                "titulo": lista.get("Titulo"),
                "propietario": lista.get("PropietarioNombre"),
            },
        }
    )


@bp.get("/mapa")
def mapa():
    """Puntos para mapa: propiedades con lat/lng (terrenos incluyen area para cuadro naranja)."""
    f = _filtros_api()
    items = models.propiedades_para_mapa(
        operacion=f["operacion"],
        tipo_codigo=f["tipo_codigo"],
        ciudad_id=f["ciudad_id"],
        distrito=f["distrito"],
        precio_min=f["precio_min"],
        precio_max=f["precio_max"],
        habitaciones_min=f["habitaciones_min"],
        banos_min=f["banos_min"],
        area_min=f["area_min"],
        area_max=f["area_max"],
        solo_terreno=f["solo_terreno"],
        con_plano=f["con_plano"],
        texto=f["texto"],
        limite=min(500, max(1, request.args.get("limite", default=500, type=int))),
    )
    return jsonify({"total": len(items), "items": items})


@bp.post("/analytics/lote")
def analytics_lote():
    """Registra vista/clic en un lote del masterplan (detalle publico)."""
    data = request.get_json(silent=True) or {}
    try:
        pid = int(data.get("propiedad_id"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "datos_invalidos"}), 400
    lote_ref = (data.get("lote_ref") or "").strip()
    if not pid or not lote_ref:
        return jsonify({"ok": False, "error": "datos_invalidos"}), 400

    prop = models.propiedad_por_id(pid)
    if not prop or not models.es_propiedad_publica(prop.get("Estado")):
        return jsonify({"ok": False, "error": "no_encontrado"}), 404

    uid = int(current_user.id) if current_user.is_authenticated else None
    if uid and models.es_dueno_propiedad(uid, pid):
        return jsonify({"ok": True, "skipped": "owner"})

    session_id = (data.get("session_id") or request.cookies.get("mph_sid") or "")[:64] or None
    models.registrar_evento_lote(
        pid,
        lote_ref,
        tipo_evento=(data.get("evento") or "view")[:30],
        session_id=session_id,
        usuario_id=uid,
    )
    return jsonify({"ok": True})


@bp.get("/propiedad/<int:pid>")
def propiedad_detalle(pid: int):
    """Detalle JSON de una propiedad (app movil)."""
    prop = models.propiedad_por_id(pid)
    if not prop or not models.es_propiedad_publica(prop.get("Estado")):
        return jsonify({"error": "no_encontrado"}), 404
    models.registrar_vista(pid)
    imagenes = [img["Url"] for img in models.imagenes_de(pid)]
    usuario = models.Usuario.por_id(int(prop["UsuarioId"]))
    return jsonify(
        {
            "id": prop["PropiedadId"],
            "titulo": prop["Titulo"],
            "descripcion": prop.get("Descripcion"),
            "operacion": prop["Operacion"],
            "tipo": prop.get("TipoNombre"),
            "ciudad": prop.get("Ciudad"),
            "distrito": prop.get("Distrito"),
            "direccion": prop.get("Direccion"),
            "precio": float(prop["Precio"]) if prop.get("Precio") is not None else None,
            "moneda": prop.get("Moneda"),
            "habitaciones": prop.get("Habitaciones"),
            "banos": prop.get("Banos"),
            "cocheras": prop.get("Cocheras"),
            "area_total": float(prop["AreaTotal"]) if prop.get("AreaTotal") is not None else None,
            "imagen": imagenes[0] if imagenes else None,
            "imagenes": imagenes,
            "destacada": bool(prop.get("Destacada")),
            "vistas": prop.get("Vistas"),
            "lat": float(prop["Latitud"]) if prop.get("Latitud") is not None else None,
            "lng": float(prop["Longitud"]) if prop.get("Longitud") is not None else None,
            "telefono": usuario.telefono if usuario else None,
            "anunciante": usuario.nombre if usuario else None,
            "email": usuario.email if usuario else None,
            "es_agente": bool(usuario.es_agente) if usuario else False,
            "foto_url": usuario.foto_url if usuario else None,
        }
    )


@bp.get("/agentes")
def agentes():
    items = models.Usuario.listar_agentes(limit=50)
    return jsonify(
        [
            {
                "UsuarioId": a["UsuarioId"],
                "NombreCompleto": a["NombreCompleto"],
                "Email": a.get("Email"),
                "Telefono": a.get("Telefono"),
                "FotoUrl": a.get("FotoUrl"),
                "Biografia": a.get("Biografia"),
                "TotalPropiedades": int(a.get("TotalPropiedades") or 0),
            }
            for a in items
        ]
    )


@bp.get("/stats/categorias")
def stats_categorias():
    return jsonify(models.stats_categorias())


@bp.get("/ciudades/populares")
def ciudades_populares():
    return jsonify(
        [
            {
                "CiudadId": c["CiudadId"],
                "Nombre": c["Nombre"],
                "Region": c.get("Region"),
                "ImagenUrl": c.get("ImagenUrl"),
                "Total": int(c.get("Total") or 0),
            }
            for c in models.listar_ciudades()
        ]
    )


@bp.post("/auth/login")
def auth_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"ok": False, "error": "datos_invalidos"}), 400
    usuario = Usuario.por_email(email)
    if not usuario or not usuario.activo or not usuario.check_password(password):
        return jsonify({"ok": False, "error": "credenciales_invalidas"}), 401
    login_user(usuario, remember=True)
    return jsonify(
        {
            "ok": True,
            "usuario": {
                "UsuarioId": int(usuario.id),
                "NombreCompleto": usuario.nombre,
                "Email": usuario.email,
                "EsAgente": bool(usuario.es_agente),
                "FotoUrl": usuario.foto_url,
                "Biografia": usuario.biografia,
                "Telefono": usuario.telefono,
            },
        }
    )


@bp.post("/auth/google")
def auth_google():
    """Login movil con Google ID token."""
    data = request.get_json(silent=True) or {}
    id_token = (data.get("id_token") or "").strip()
    if not id_token:
        return jsonify({"ok": False, "error": "datos_invalidos"}), 400

    client_id = current_app.config.get("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        return jsonify({"ok": False, "error": "google_no_configurado"}), 503

    try:
        import json
        import urllib.error
        import urllib.request

        with urllib.request.urlopen(
            f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}",
            timeout=10,
        ) as resp:
            info = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
        return jsonify({"ok": False, "error": "token_invalido"}), 401

    aud = info.get("aud") or info.get("azp")
    if aud != client_id:
        return jsonify({"ok": False, "error": "token_invalido"}), 401

    if info.get("email_verified") == "false":
        return jsonify({"ok": False, "error": "email_no_verificado"}), 401

    google_id = info.get("sub")
    email = (info.get("email") or "").strip().lower()
    nombre = (info.get("name") or email.split("@")[0] or "Usuario").strip()
    foto = info.get("picture")

    if not google_id or not email:
        return jsonify({"ok": False, "error": "datos_incompletos"}), 400

    usuario = Usuario.login_o_registrar_google(google_id, email, nombre, foto)
    if not usuario or not usuario.activo:
        return jsonify({"ok": False, "error": "cuenta_no_disponible"}), 403

    login_user(usuario, remember=True)
    return jsonify(
        {
            "ok": True,
            "usuario": {
                "UsuarioId": int(usuario.id),
                "NombreCompleto": usuario.nombre,
                "Email": usuario.email,
                "EsAgente": bool(usuario.es_agente),
                "FotoUrl": usuario.foto_url,
                "Biografia": usuario.biografia,
                "Telefono": usuario.telefono,
            },
        }
    )


@bp.get("/auth/me")
def auth_me():
    if not current_user.is_authenticated:
        return jsonify({"error": "no_autenticado"}), 401
    u = current_user
    return jsonify(
        {
            "UsuarioId": int(u.id),
            "NombreCompleto": u.nombre,
            "Email": u.email,
            "EsAgente": bool(u.es_agente),
            "FotoUrl": u.foto_url,
            "Biografia": u.biografia,
            "Telefono": u.telefono,
        }
    )
