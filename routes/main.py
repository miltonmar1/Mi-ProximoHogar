"""Rutas principales: home, busqueda y detalle de propiedades."""
from __future__ import annotations

from datetime import datetime
from xml.etree.ElementTree import Element, SubElement, tostring

from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, url_for
from flask import Response
from flask_login import current_user, login_required

import models
from forms import ContactoForm
from services.email_notifications import notificar_consulta_anunciante, url_detalle_propiedad

bp = Blueprint("main", __name__)

LANDINGS_TERRENOS: dict[str, dict[str, str]] = {
    "cusco": {
        "titulo": "Terrenos en venta en Cusco",
        "meta": "Compra terrenos y lotes en Cusco. Mapa interactivo, precios en soles y dolares, contacto directo con anunciantes.",
        "operacion": "venta",
        "tipo": "terreno",
        "ciudad": "Cusco",
    },
    "san-jeronimo": {
        "titulo": "Terrenos en San Jeronimo, Cusco",
        "meta": "Lotes y terrenos en venta en San Jeronimo. Zona de expansion con buena conectividad hacia el centro de Cusco.",
        "operacion": "venta",
        "tipo": "terreno",
        "ciudad": "Cusco",
        "distrito": "San Jeronimo",
    },
    "wanchaq": {
        "titulo": "Terrenos en Wanchaq, Cusco",
        "meta": "Terrenos comerciales y residenciales en Wanchaq, cerca de la Av. El Sol y servicios urbanos.",
        "operacion": "venta",
        "tipo": "terreno",
        "ciudad": "Cusco",
        "distrito": "Wanchaq",
    },
    "santiago": {
        "titulo": "Terrenos en Santiago, Cusco",
        "meta": "Lotes en venta en el distrito de Santiago, Cusco. Ideal para vivienda o inversion.",
        "operacion": "venta",
        "tipo": "terreno",
        "ciudad": "Cusco",
        "distrito": "Santiago",
    },
    "san-blas": {
        "titulo": "Terrenos en San Blas, Cusco",
        "meta": "Terrenos y lotes en el barrio historico de San Blas, Cusco.",
        "operacion": "venta",
        "tipo": "terreno",
        "ciudad": "Cusco",
        "distrito": "San Blas",
    },
}


def _redirect_detalle(pid: int, share_token: str = "") -> str:
    if share_token:
        return url_for("main.detalle", pid=pid, share=share_token)
    return url_for("main.detalle", pid=pid)


def _site_base() -> str:
    return (current_app.config.get("SITE_URL") or request.url_root).rstrip("/")


def _fmt_sitemap_date(value) -> str | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    try:
        return str(value)[:10]
    except Exception:
        return None


def _filtros_actuales():
    return {
        "operacion": request.args.get("operacion") or None,
        "tipo": request.args.get("tipo") or None,
        "ciudad_id": request.args.get("ciudad_id", type=int),
        "distrito": (request.args.get("distrito") or "").strip() or None,
        "precio_min": request.args.get("precio_min", type=float),
        "precio_max": request.args.get("precio_max", type=float),
        "habitaciones_min": request.args.get("habitaciones_min", type=int),
        "banos_min": request.args.get("banos_min", type=int),
        "area_min": request.args.get("area_min", type=float),
        "area_max": request.args.get("area_max", type=float),
        "solo_terreno": request.args.get("solo_terreno") == "1",
        "con_plano": request.args.get("con_plano") == "1",
        "texto": (request.args.get("q") or "").strip() or None,
        "orden": request.args.get("orden") or "recientes",
        "pagina": max(1, request.args.get("pagina", default=1, type=int)),
    }


def _buscar_con_filtros(f: dict, *, por_pagina: int = 12):
    ciudad_id = f.get("ciudad_id")
    if not ciudad_id and f.get("ciudad_nombre"):
        ciudad_id = models.ciudad_id_por_nombre(f["ciudad_nombre"])
    return models.buscar_propiedades(
        operacion=f.get("operacion"),
        tipo_codigo=f.get("tipo"),
        ciudad_id=ciudad_id,
        distrito=f.get("distrito"),
        precio_min=f.get("precio_min"),
        precio_max=f.get("precio_max"),
        habitaciones_min=f.get("habitaciones_min"),
        banos_min=f.get("banos_min"),
        area_min=f.get("area_min"),
        area_max=f.get("area_max"),
        solo_terreno=bool(f.get("solo_terreno")),
        con_plano=bool(f.get("con_plano")),
        texto=f.get("texto"),
        orden=f.get("orden") or "recientes",
        pagina=f.get("pagina") or 1,
        por_pagina=por_pagina,
    )


@bp.route("/")
def index():
    destacadas = models.propiedades_destacadas(limit=6)
    recientes = models.propiedades_recientes(limit=8)
    return render_template(
        "index.html",
        destacadas=destacadas,
        recientes=recientes,
        ciudades=models.listar_ciudades(),
        tipos=models.listar_tipos(),
        categorias=models.stats_categorias(),
    )


@bp.route("/propiedades")
def propiedades():
    f = _filtros_actuales()
    resultado = _buscar_con_filtros(f, por_pagina=12)
    cusco_id = models.ciudad_id_por_nombre("Cusco")
    return render_template(
        "propiedades.html",
        resultado=resultado,
        filtros=f,
        ciudades=models.listar_ciudades_simple(),
        tipos=models.listar_tipos(),
        mapa_ciudad_id=cusco_id,
        rango_precios=models.rango_precios_catalogo(),
    )


@bp.route("/propiedad/<int:pid>", methods=["GET", "POST"])
def detalle(pid: int):
    prop = models.propiedad_por_id(pid)
    if not prop:
        abort(404)

    es_dueno = (
        current_user.is_authenticated
        and int(current_user.id) == int(prop["UsuarioId"])
    )
    share_token = (request.args.get("share") or "").strip()
    via_compartido = bool(
        share_token and models.propiedad_en_lista_compartida(share_token, pid)
    )
    if not models.es_propiedad_publica(prop.get("Estado")) and not es_dueno and not via_compartido:
        abort(404)

    form = ContactoForm()
    if current_user.is_authenticated:
        form.nombre.data = form.nombre.data or current_user.nombre
        form.email.data = form.email.data or current_user.email

    if form.validate_on_submit():
        if not models.es_propiedad_publica(prop.get("Estado")) and not via_compartido:
            flash("Este anuncio esta deshabilitado y no acepta consultas.", "warning")
            return redirect(url_for("main.detalle", pid=pid, share=share_token) if share_token else url_for("main.detalle", pid=pid))
        models.guardar_contacto(
            propiedad_id=pid,
            nombre=form.nombre.data,
            email=form.email.data,
            telefono=form.telefono.data,
            mensaje=form.mensaje.data,
        )
        detalle_url = url_detalle_propiedad(pid)
        correo_ok = notificar_consulta_anunciante(
            prop,
            nombre=form.nombre.data,
            email=form.email.data,
            telefono=form.telefono.data,
            mensaje=form.mensaje.data,
            detalle_url=detalle_url,
        )
        if correo_ok:
            flash("Tu mensaje fue enviado al anunciante.", "success")
        elif current_app.config.get("MAIL_SERVER"):
            flash(
                "Tu mensaje fue registrado, pero no pudimos notificar al anunciante por correo en este momento.",
                "warning",
            )
        else:
            flash("Tu mensaje fue registrado correctamente.", "success")
        return redirect(_redirect_detalle(pid, share_token))

    models.registrar_vista(pid)
    imagenes = models.imagenes_de(pid)
    videos = models.videos_de(pid)
    es_fav = current_user.is_authenticated and models.es_favorito(int(current_user.id), pid)
    mas_del_anunciante = models.propiedades_relacionadas_anunciante(
        int(prop["UsuarioId"]),
        pid,
        limite=4,
    )

    map_lat, map_lng = models.resolver_coordenadas(prop)
    tiene_lote_dibujado = bool(models.parse_poligono_lote(prop.get("PoligonoLote")))
    lotes_resumen = models.resumen_lotes_plan(prop.get("PlanMasterplan"))

    return render_template(
        "detalle.html",
        prop=prop,
        imagenes=imagenes,
        videos=videos,
        form=form,
        es_favorito=es_fav,
        es_dueno=es_dueno,
        map_lat=map_lat,
        map_lng=map_lng,
        tiene_lote_dibujado=tiene_lote_dibujado,
        lotes_resumen=lotes_resumen,
        mas_del_anunciante=mas_del_anunciante,
        site_base=_site_base(),
    )


@bp.route("/mapa/compartido/<token>")
def mapa_compartido(token: str):
    lista, items, stats = models.propiedades_para_mapa_compartido(token)
    if not lista:
        abort(404)
    models.registrar_vista_lista_compartida(token)
    return render_template(
        "mapa_compartido.html",
        lista=lista,
        token=token,
        total=len(items),
        stats=stats,
    )


@bp.route("/mapa")
def mapa():
    f = _filtros_actuales()
    return render_template(
        "mapa.html",
        filtros=f,
        ciudades=models.listar_ciudades_simple(),
        tipos=models.listar_tipos(),
        destacar=request.args.get("destacar", type=int),
        rango_precios=models.rango_precios_catalogo(),
    )


@bp.route("/ciudades")
def ciudades():
    return render_template("ciudades.html", ciudades=models.listar_ciudades())


@bp.route("/agentes")
def agentes():
    return render_template("agentes.html", agentes=models.Usuario.listar_agentes(limit=24))


@bp.route("/agente/<int:uid>")
def agente(uid: int):
    agente_data = models.agente_publico_por_id(uid)
    if not agente_data:
        abort(404)
    anuncios = models.propiedades_publicas_de_usuario(uid)
    return render_template(
        "agente.html",
        agente=agente_data,
        anuncios=anuncios,
    )


@bp.route("/favoritos")
@login_required
def favoritos():
    items = models.favoritos_de(int(current_user.id))
    return render_template("favoritos.html", items=items)


@bp.route("/favoritos/comparar")
@login_required
def comparar_favoritos():
    raw = (request.args.get("ids") or "").strip()
    ids: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            ids.append(int(part))
    ids = ids[:6]
    items = models.favoritos_por_ids(int(current_user.id), ids)
    return render_template("comparar_favoritos.html", items=items, ids_solicitados=ids)


@bp.route("/terrenos/<slug>")
def landing_terrenos(slug: str):
    cfg = LANDINGS_TERRENOS.get(slug)
    if not cfg:
        abort(404)
    ciudad_id = models.ciudad_id_por_nombre(cfg.get("ciudad", "Cusco"))
    f = {
        "operacion": cfg.get("operacion", "venta"),
        "tipo": cfg.get("tipo", "terreno"),
        "ciudad_id": ciudad_id,
        "distrito": cfg.get("distrito"),
        "texto": None,
        "orden": "recientes",
        "pagina": max(1, request.args.get("pagina", default=1, type=int)),
        "precio_min": request.args.get("precio_min", type=float),
        "precio_max": request.args.get("precio_max", type=float),
        "habitaciones_min": None,
        "banos_min": None,
        "area_min": request.args.get("area_min", type=float),
        "area_max": request.args.get("area_max", type=float),
        "solo_terreno": False,
        "con_plano": request.args.get("con_plano") == "1",
    }
    resultado = _buscar_con_filtros(f, por_pagina=12)
    return render_template(
        "landing_terrenos.html",
        slug=slug,
        landing=cfg,
        resultado=resultado,
        filtros=f,
        ciudades=models.listar_ciudades_simple(),
        tipos=models.listar_tipos(),
        rango_precios=models.rango_precios_catalogo(),
    )


@bp.route("/legal/privacidad")
def legal_privacidad():
    return render_template("legal/privacidad.html")


@bp.route("/legal/terminos")
def legal_terminos():
    return render_template("legal/terminos.html")


@bp.route("/legal/cookies")
def legal_cookies():
    return render_template("legal/cookies.html")


@bp.route("/legal/aviso")
def legal_aviso():
    return render_template("legal/aviso_legal.html")


@bp.route("/robots.txt")
def robots_txt():
    base = _site_base()
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        f"Sitemap: {base}/sitemap.xml\n"
    )
    return Response(body, mimetype="text/plain")


@bp.route("/sitemap.xml")
def sitemap_xml():
    base = _site_base()
    urlset = Element(
        "urlset",
        xmlns="http://www.sitemaps.org/schemas/sitemap/0.9",
    )

    def add_url(loc: str, *, lastmod=None, changefreq: str = "weekly", priority: str = "0.6"):
        node = SubElement(urlset, "url")
        SubElement(node, "loc").text = loc
        lm = _fmt_sitemap_date(lastmod)
        if lm:
            SubElement(node, "lastmod").text = lm
        SubElement(node, "changefreq").text = changefreq
        SubElement(node, "priority").text = priority

    paginas = [
        (url_for("main.index"), None, "daily", "1.0"),
        (url_for("main.propiedades"), None, "daily", "0.9"),
        (url_for("main.propiedades", operacion="venta"), None, "daily", "0.8"),
        (url_for("main.propiedades", operacion="alquiler"), None, "daily", "0.8"),
        (url_for("main.mapa"), None, "daily", "0.8"),
        (url_for("main.ciudades"), None, "weekly", "0.7"),
        (url_for("main.agentes"), None, "weekly", "0.6"),
        (url_for("main.legal_privacidad"), None, "monthly", "0.3"),
        (url_for("main.legal_terminos"), None, "monthly", "0.3"),
        (url_for("main.legal_cookies"), None, "monthly", "0.3"),
        (url_for("main.legal_aviso"), None, "monthly", "0.3"),
    ]
    for path, lastmod, freq, prio in paginas:
        add_url(base + path, lastmod=lastmod, changefreq=freq, priority=prio)

    for slug in LANDINGS_TERRENOS:
        add_url(
            base + url_for("main.landing_terrenos", slug=slug),
            changefreq="weekly",
            priority="0.75",
        )

    for row in models.propiedades_para_sitemap():
        lastmod = row.get("FechaCreacion")
        add_url(
            base + url_for("main.detalle", pid=row["PropiedadId"]),
            lastmod=lastmod,
            changefreq="weekly",
            priority="0.7",
        )

    xml = b'<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(urlset, encoding="utf-8")
    return Response(xml, mimetype="application/xml")


@bp.route("/favorito/<int:pid>/toggle", methods=["POST"])
@login_required
def toggle_favorito(pid: int):
    estado = models.toggle_favorito(int(current_user.id), pid)
    flash(
        "Agregado a favoritos" if estado else "Removido de favoritos",
        "success" if estado else "info",
    )
    return redirect(request.referrer or url_for("main.detalle", pid=pid))


@bp.app_errorhandler(404)
def not_found(_):
    return render_template("404.html"), 404


@bp.app_errorhandler(500)
def server_error(e):
    return render_template("500.html", error=str(e)), 500
