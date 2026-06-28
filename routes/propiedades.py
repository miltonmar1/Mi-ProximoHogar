"""Rutas para publicar y administrar propiedades."""
import os
import uuid

from flask import (
    Blueprint, current_app, flash, jsonify, redirect, render_template, request, url_for,
)
from flask_login import current_user, login_required
from werkzeug.utils import secure_filename

import models
from forms import PropiedadForm
from services import plano_parser
from services.video_embed import parse_video_urls_text

bp = Blueprint("propiedades", __name__, url_prefix="/publicar")


def _requiere_dueno(pid: int) -> bool:
    if not models.es_dueno_propiedad(int(current_user.id), pid):
        flash("No tienes permiso para modificar este anuncio.", "danger")
        return False
    return True


def _archivo_permitido(filename: str) -> bool:
    allowed = current_app.config["ALLOWED_EXTENSIONS"]
    return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed


def _plan_tiene_lotes(plan_raw: str | None) -> bool:
    plan = models.parse_plan_masterplan(plan_raw)
    if not plan:
        return False
    return any((f.get("tipo") or "lote") == "lote" for f in plan.get("features") or [])


def _plan_tiene_geometria(plan_raw: str | None) -> bool:
    plan = models.parse_plan_masterplan(plan_raw)
    if not plan:
        return False
    return any(f.get("path") and len(f["path"]) >= 3 for f in plan.get("features") or [])


def _poligono_valido(poligono: str | None) -> bool:
    if not poligono or poligono.strip() in ("[]", "null", "{}"):
        return False
    return len(poligono.strip()) > 10


def _tipo_codigo(tipos: list[dict], tipo_id: int) -> str:
    return next((t["Codigo"] for t in tipos if t["TipoId"] == tipo_id), "")


def _datos_desde_form(form: PropiedadForm) -> dict:
    return {
        "tipo_id": form.tipo_id.data,
        "ciudad_id": form.ciudad_id.data,
        "operacion": form.operacion.data,
        "titulo": form.titulo.data.strip(),
        "descripcion": form.descripcion.data,
        "direccion": form.direccion.data,
        "distrito": form.distrito.data,
        "precio": float(form.precio.data),
        "moneda": form.moneda.data,
        "area_total": float(form.area_total.data) if form.area_total.data is not None else None,
        "area_construida": float(form.area_construida.data) if form.area_construida.data is not None else None,
        "habitaciones": form.habitaciones.data,
        "banos": form.banos.data,
        "cocheras": form.cocheras.data,
        "latitud": request.form.get("latitud", type=float),
        "longitud": request.form.get("longitud", type=float),
        "poligono_lote": (request.form.get("poligono_lote") or "").strip() or None,
        "plan_masterplan": (request.form.get("plan_masterplan") or "").strip() or None,
        "utm_zona": (request.form.get("utm_zona") or "").strip() or None,
        "utm_este": request.form.get("utm_este", type=float),
        "utm_norte": request.form.get("utm_norte", type=float),
        "area_mapa_m2": request.form.get("area_mapa_m2", type=float),
        "utm_vertices": (request.form.get("utm_vertices") or "").strip() or None,
    }


def _validar_mapa(
    form: PropiedadForm,
    tipos: list[dict],
    prop_existente: dict | None = None,
) -> str | None:
    plan_raw = (request.form.get("plan_masterplan") or "").strip() or None
    poligono = (request.form.get("poligono_lote") or "").strip() or None
    lat = request.form.get("latitud", type=float)
    lng = request.form.get("longitud", type=float)
    geo_modo = (request.form.get("geo_modo") or "punto").strip().lower()

    if prop_existente:
        if not plan_raw:
            plan_raw = (prop_existente.get("PlanMasterplan") or "").strip() or None
        if not poligono:
            poligono = (prop_existente.get("PoligonoLote") or "").strip() or None
        if lat is None and prop_existente.get("Latitud") is not None:
            lat = float(prop_existente["Latitud"])
        if lng is None and prop_existente.get("Longitud") is not None:
            lng = float(prop_existente["Longitud"])

    if geo_modo == "plano" and not _plan_tiene_lotes(plan_raw):
        return "En modo plano debes importar un SVG/DXF con poligonos de lotes."
    if geo_modo == "poligono" and not _poligono_valido(poligono) and not _plan_tiene_lotes(plan_raw):
        return "En modo poligono dibuja al menos un lote en el mapa."
    if lat is None or lng is None:
        return "Marca la ubicacion en el mapa o usa coordenadas UTM/GPS."
    return None


def _fusionar_mapa_editar(datos: dict, prop: dict) -> dict:
    """Conserva datos de mapa existentes si el POST no los envio (sync JS fallido)."""
    fusion = dict(datos)
    plan_post = (request.form.get("plan_masterplan") or "").strip()
    if plan_post and _plan_tiene_geometria(plan_post):
        fusion["plan_masterplan"] = plan_post
    else:
        fusion["plan_masterplan"] = prop.get("PlanMasterplan")
    if not _poligono_valido(fusion.get("poligono_lote")):
        fusion["poligono_lote"] = prop.get("PoligonoLote")
    if fusion.get("latitud") is None and prop.get("Latitud") is not None:
        fusion["latitud"] = float(prop["Latitud"])
    if fusion.get("longitud") is None and prop.get("Longitud") is not None:
        fusion["longitud"] = float(prop["Longitud"])
    if not fusion.get("utm_zona"):
        fusion["utm_zona"] = prop.get("UtmZona")
    if fusion.get("utm_este") is None and prop.get("UtmEste") is not None:
        fusion["utm_este"] = float(prop["UtmEste"])
    if fusion.get("utm_norte") is None and prop.get("UtmNorte") is not None:
        fusion["utm_norte"] = float(prop["UtmNorte"])
    if fusion.get("area_mapa_m2") is None and prop.get("AreaMapaM2") is not None:
        fusion["area_mapa_m2"] = float(prop["AreaMapaM2"])
    verts_post = (fusion.get("utm_vertices") or "").strip()
    if verts_post and verts_post not in ("[]", "null", "{}"):
        fusion["utm_vertices"] = verts_post
    elif prop.get("UtmVertices"):
        fusion["utm_vertices"] = prop.get("UtmVertices")
    return fusion


def _render_publicar(
    form: PropiedadForm,
    tipos: list[dict],
    *,
    editar: bool = False,
    propiedad: dict | None = None,
    imagenes_actuales: list[dict] | None = None,
    videos_actuales: list[dict] | None = None,
):
    return render_template(
        "publicar.html",
        form=form,
        tipos=tipos,
        requiere_google=not current_app.config.get("GOOGLE_MAPS_API_KEY"),
        editar=editar,
        propiedad=propiedad,
        imagenes_actuales=imagenes_actuales or [],
        videos_actuales=videos_actuales or [],
    )


def _subir_imagenes(pid: int, form: PropiedadForm, orden_inicial: int = 0) -> None:
    upload_folder = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(upload_folder, exist_ok=True)

    orden = orden_inicial
    if form.imagen_url.data:
        models.agregar_imagen(pid, form.imagen_url.data.strip(), es_principal=(orden == 0), orden=orden)
        orden += 1

    for archivo in request.files.getlist("imagenes"):
        if not archivo or not archivo.filename or not _archivo_permitido(archivo.filename):
            continue
        ext = archivo.filename.rsplit(".", 1)[1].lower()
        nombre = f"{uuid.uuid4().hex}.{ext}"
        ruta = os.path.join(upload_folder, secure_filename(nombre))
        archivo.save(ruta)
        url = url_for("static", filename=f"uploads/{nombre}")
        models.agregar_imagen(pid, url, es_principal=(orden == 0), orden=orden)
        orden += 1


def _guardar_videos_nuevos(pid: int, texto_urls: str | None) -> list[str]:
    """Agrega videos desde textarea. Devuelve lista de errores de URLs invalidas."""
    actuales = models.contar_videos(pid)
    max_nuevos = max(0, 6 - actuales)
    videos, errores = parse_video_urls_text(texto_urls or "", max_videos=max_nuevos)
    orden = actuales
    for v in videos:
        models.agregar_video(
            pid,
            v["url_original"],
            v["plataforma"],
            v["url_embed"],
            orden=orden,
        )
        orden += 1
    return errores


def _gestionar_videos_existentes(pid: int) -> None:
    for raw_id in request.form.getlist("eliminar_video"):
        try:
            video_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        models.eliminar_video(video_id, pid)


def _gestionar_imagenes_existentes(pid: int) -> None:
    upload_folder = current_app.config["UPLOAD_FOLDER"]

    for raw_id in request.form.getlist("eliminar_imagen"):
        try:
            imagen_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        url = models.eliminar_imagen(imagen_id, pid)
        if url and "/static/uploads/" in url:
            nombre = url.rsplit("/static/uploads/", 1)[-1].split("?")[0]
            ruta = os.path.join(upload_folder, secure_filename(nombre))
            if os.path.isfile(ruta):
                try:
                    os.remove(ruta)
                except OSError:
                    pass

    principal_id = request.form.get("imagen_principal", type=int)
    if principal_id:
        models.marcar_imagen_principal(principal_id, pid)


@bp.route("/api/importar-plano", methods=["POST"])
@login_required
def importar_plano():
    archivo = request.files.get("archivo")
    if not archivo or not archivo.filename:
        return jsonify({"ok": False, "error": "Selecciona un archivo SVG o DXF."}), 400

    ext = archivo.filename.rsplit(".", 1)[-1].lower()
    data = archivo.read()
    if len(data) > 12 * 1024 * 1024:
        return jsonify({"ok": False, "error": "Archivo demasiado grande (max 12 MB)."}), 400

    try:
        if ext == "svg":
            resultado = plano_parser.parse_svg_bytes(data)
        elif ext == "dxf":
            resultado = plano_parser.parse_dxf_bytes(data)
        elif ext == "dwg":
            return jsonify(
                {
                    "ok": False,
                    "error": (
                        "DWG binario no se puede leer directamente. "
                        "Exporta el plano como DXF o SVG desde AutoCAD / Civil 3D / LibreCAD."
                    ),
                }
            ), 400
        else:
            return jsonify({"ok": False, "error": "Formato no soportado. Usa .svg o .dxf"}), 400
    except Exception as exc:
        return jsonify({"ok": False, "error": f"No se pudo leer el plano: {exc}"}), 400

    if not resultado.get("features"):
        return jsonify(
            {"ok": False, "error": "No se encontraron poligonos cerrados en el archivo."}
        ), 400

    return jsonify({"ok": True, **resultado})


@bp.route("/compartir", methods=["GET", "POST"])
@login_required
def compartir():
    anuncios = models.propiedades_de_usuario(int(current_user.id))
    if request.method == "POST":
        titulo = (request.form.get("titulo") or "").strip()
        raw_ids = request.form.getlist("propiedad_ids")
        try:
            ids = [int(x) for x in raw_ids if str(x).strip().isdigit()]
            resultado = models.crear_lista_compartida(int(current_user.id), titulo, ids)
            url = url_for("main.mapa_compartido", token=resultado["token"], _external=True)
            flash(
                f"Enlace creado con {resultado['total']} anuncio(s). Copia y comparte el enlace con tus clientes.",
                "success",
            )
            return render_template(
                "compartir.html",
                anuncios=anuncios,
                enlace_creado=url,
                lista_titulo=resultado["titulo"],
            )
        except ValueError as exc:
            flash(str(exc), "warning")
    return render_template("compartir.html", anuncios=anuncios)


@bp.route("/compartir/enlaces")
@login_required
def compartir_enlaces():
    listas = models.listas_compartidas_de_usuario(int(current_user.id))
    return render_template("compartir_enlaces.html", listas=listas)


@bp.route("/compartir/<int:lista_id>/revocar", methods=["POST"])
@login_required
def revocar_compartir(lista_id: int):
    if models.desactivar_lista_compartida(int(current_user.id), lista_id):
        flash("Enlace revocado. Ya no se puede abrir el mapa compartido.", "success")
    else:
        flash("No se pudo revocar el enlace.", "warning")
    return redirect(url_for("propiedades.compartir_enlaces"))


@bp.route("/mis-anuncios")
@login_required
def mis_anuncios():
    items = models.propiedades_de_usuario(int(current_user.id))
    inactivos = sum(1 for a in items if a.get("Estado") == "inactivo")
    return render_template(
        "mis_anuncios.html",
        anuncios=items,
        total_inactivos=inactivos,
        total_consultas=models.contar_consultas_usuario(int(current_user.id)),
    )


@bp.route("/consultas")
@login_required
def consultas():
    uid = int(current_user.id)
    filtro_pid = request.args.get("propiedad_id", type=int)
    if filtro_pid is not None and not models.es_dueno_propiedad(uid, filtro_pid):
        flash("No puedes ver consultas de ese anuncio.", "warning")
        return redirect(url_for("propiedades.consultas"))

    return render_template(
        "consultas.html",
        consultas=models.consultas_de_usuario(uid, propiedad_id=filtro_pid),
        anuncios=models.propiedades_de_usuario(uid),
        filtro_pid=filtro_pid,
        total=models.contar_consultas_usuario(uid),
    )


@bp.route("/reactivar-todos", methods=["POST"])
@login_required
def reactivar_todos():
    n = models.reactivar_todos_anuncios_usuario(int(current_user.id))
    if n:
        flash(f"Se reactivaron {n} anuncio(s). Ya aparecen en busquedas y en el mapa.", "success")
    else:
        flash("No hay anuncios deshabilitados para reactivar.", "info")
    return redirect(url_for("propiedades.mis_anuncios"))


@bp.route("/<int:pid>/pausar", methods=["POST"])
@login_required
def pausar(pid: int):
    if not _requiere_dueno(pid):
        return redirect(url_for("propiedades.mis_anuncios"))
    models.actualizar_estado_propiedad(pid, "inactivo")
    flash("Anuncio deshabilitado. Ya no aparece en busquedas ni en el mapa.", "success")
    return redirect(url_for("propiedades.mis_anuncios"))


@bp.route("/<int:pid>/activar", methods=["POST"])
@login_required
def activar(pid: int):
    if not _requiere_dueno(pid):
        return redirect(url_for("propiedades.mis_anuncios"))
    models.actualizar_estado_propiedad(pid, "activo")
    flash("Anuncio reactivado. Vuelve a estar visible para todos.", "success")
    return redirect(url_for("propiedades.mis_anuncios"))


@bp.route("/<int:pid>/eliminar", methods=["POST"])
@login_required
def eliminar(pid: int):
    if not _requiere_dueno(pid):
        return redirect(url_for("propiedades.mis_anuncios"))
    models.eliminar_propiedad(pid)
    flash("Anuncio eliminado permanentemente.", "success")
    return redirect(url_for("propiedades.mis_anuncios"))


@bp.route("/<int:pid>/editar", methods=["GET", "POST"])
@login_required
def editar(pid: int):
    if not _requiere_dueno(pid):
        return redirect(url_for("propiedades.mis_anuncios"))

    prop = models.propiedad_por_id(pid)
    if not prop:
        flash("Anuncio no encontrado.", "danger")
        return redirect(url_for("propiedades.mis_anuncios"))

    form = PropiedadForm()
    form.tipo_id.choices = [(t["TipoId"], t["Nombre"]) for t in models.listar_tipos()]
    form.ciudad_id.choices = [(c["CiudadId"], c["Nombre"]) for c in models.listar_ciudades_simple()]
    tipos = models.listar_tipos()
    imagenes = models.imagenes_de(pid)
    videos = models.videos_de(pid)

    if request.method == "GET":
        form.titulo.data = prop["Titulo"]
        form.descripcion.data = prop.get("Descripcion")
        form.operacion.data = prop["Operacion"]
        form.tipo_id.data = prop["TipoId"]
        form.ciudad_id.data = prop["CiudadId"]
        form.distrito.data = prop.get("Distrito")
        form.direccion.data = prop.get("Direccion")
        form.precio.data = prop["Precio"]
        form.moneda.data = prop.get("Moneda") or "PEN"
        form.area_total.data = prop.get("AreaTotal")
        form.area_construida.data = prop.get("AreaConstruida")
        form.habitaciones.data = prop.get("Habitaciones")
        form.banos.data = prop.get("Banos")
        form.cocheras.data = prop.get("Cocheras")

    if form.validate_on_submit():
        error_mapa = _validar_mapa(form, tipos, prop_existente=prop)
        if error_mapa:
            flash(error_mapa, "error")
            return _render_publicar(
                form, tipos, editar=True, propiedad=prop,
                imagenes_actuales=imagenes, videos_actuales=videos,
            )

        datos = _fusionar_mapa_editar(_datos_desde_form(form), prop)
        models.actualizar_propiedad(pid, datos)
        _gestionar_imagenes_existentes(pid)
        _gestionar_videos_existentes(pid)

        restantes = models.imagenes_de(pid)
        orden = len(restantes)
        if orden == 0:
            _subir_imagenes(pid, form, orden_inicial=0)
        else:
            _subir_imagenes(pid, form, orden_inicial=orden)

        errores_video = _guardar_videos_nuevos(pid, form.video_urls.data)
        if errores_video:
            flash("Algunas URLs de video no se guardaron: " + errores_video[0], "warning")

        flash("Anuncio actualizado correctamente.", "success")
        return redirect(url_for("main.detalle", pid=pid))

    if request.method == "POST" and form.errors:
        detalle_errores = []
        for campo, errs in form.errors.items():
            for err in errs:
                detalle_errores.append(f"{campo}: {err}")
        flash(
            "No se pudo guardar. " + ("; ".join(detalle_errores) if detalle_errores else "Revisa los campos."),
            "danger",
        )

    return _render_publicar(
        form, tipos, editar=True, propiedad=prop,
        imagenes_actuales=imagenes, videos_actuales=videos,
    )


@bp.route("/", methods=["GET", "POST"])
@login_required
def publicar():
    form = PropiedadForm()
    form.tipo_id.choices = [(t["TipoId"], t["Nombre"]) for t in models.listar_tipos()]
    form.ciudad_id.choices = [(c["CiudadId"], c["Nombre"]) for c in models.listar_ciudades_simple()]

    tipos = models.listar_tipos()
    cusco_id = models.ciudad_id_por_nombre("Cusco")
    if request.method == "GET" and cusco_id and not form.ciudad_id.data:
        form.ciudad_id.data = cusco_id

    if form.validate_on_submit():
        error_mapa = _validar_mapa(form, tipos)
        if error_mapa:
            flash(error_mapa, "error")
            return _render_publicar(form, tipos)

        datos = _datos_desde_form(form)
        datos["usuario_id"] = int(current_user.id)
        pid = models.crear_propiedad(datos)
        _subir_imagenes(pid, form)
        errores_video = _guardar_videos_nuevos(pid, form.video_urls.data)
        if errores_video:
            flash("Algunas URLs de video no se guardaron: " + errores_video[0], "warning")

        flash("Tu terreno fue publicado y ya aparece en el mapa de Cusco.", "success")
        return redirect(url_for("main.mapa", destacar=pid))

    return _render_publicar(form, tipos)
