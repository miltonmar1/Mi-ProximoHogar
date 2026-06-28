"""Endpoints JSON ligeros para autocomplete y filtros dinamicos."""
from flask import Blueprint, jsonify, request
from flask_login import current_user

import models

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
