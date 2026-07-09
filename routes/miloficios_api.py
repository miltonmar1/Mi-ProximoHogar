"""API JSON para la app Android MilOficios (APK → Flask → Azure SQL MilOficios)."""
from flask import Blueprint, jsonify, request

import miloficios_models as mf

bp = Blueprint("miloficios_api", __name__, url_prefix="/api/miloficios")


@bp.get("/health")
def health():
    try:
        from miloficios_db import mf_health

        mf_health()
        return jsonify({"ok": True, "database": "MilOficios"})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)[:200]}), 503


@bp.get("/sync")
def sync():
    """Carga inicial: maestros, publicaciones, conversaciones, mensajes, comentarios, usuarios."""
    try:
        maestros = mf.listar_maestros()
        if not maestros:
            return jsonify({"ok": False, "error": "sin_maestros"}), 404
        return jsonify(
            {
                "ok": True,
                "maestros": maestros,
                "publicaciones": mf.listar_publicaciones(),
                "conversaciones": mf.listar_conversaciones(),
                "mensajes": mf.listar_mensajes(),
                "comentarios": mf.listar_comentarios(),
                "usuarios": mf.listar_usuarios(),
            }
        )
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)[:300]}), 500


@bp.post("/usuarios")
def usuarios_registrar():
    data = request.get_json(silent=True) or {}
    try:
        uid = mf.registrar_usuario(data)
        if not uid:
            return jsonify({"ok": False, "error": "datos_invalidos"}), 400
        return jsonify({"ok": True, "id": uid})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)[:300]}), 500


@bp.post("/comentarios")
def comentarios_insertar():
    data = request.get_json(silent=True) or {}
    try:
        cid = mf.insertar_comentario(data)
        if not cid:
            return jsonify({"ok": False, "error": "datos_invalidos"}), 400
        return jsonify({"ok": True, "id": cid})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)[:300]}), 500


@bp.post("/publicaciones/<int:pid>/like")
def publicacion_like(pid: int):
    try:
        if not mf.incrementar_like(pid):
            return jsonify({"ok": False, "error": "no_encontrado"}), 404
        return jsonify({"ok": True})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)[:300]}), 500
