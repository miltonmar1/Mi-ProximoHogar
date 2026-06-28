"""Rutas de autenticacion (email + Google OAuth)."""
from __future__ import annotations

from flask import Blueprint, current_app, flash, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required, login_user, logout_user

import models
from extensions import oauth
from forms import (
    GoogleTermsForm,
    LoginForm,
    PerfilForm,
    RecuperarPasswordForm,
    RegisterForm,
    RestablecerPasswordForm,
)
from services.email_notifications import enviar_recuperacion_password, mail_configured, url_restablecer_password

bp = Blueprint("auth", __name__, url_prefix="/cuenta")


def _destino_seguro() -> str:
    destino = request.args.get("next") or session.pop("oauth_next", None) or url_for("main.index")
    if destino.startswith("/") and not destino.startswith("//"):
        return destino
    return url_for("main.index")


def _redirect_uri_google() -> str:
    fijo = current_app.config.get("GOOGLE_OAUTH_REDIRECT_URI")
    if fijo:
        return fijo
    return url_for("auth.google_callback", _external=True)


@bp.route("/ingresar")
@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))

    form = LoginForm()
    if form.validate_on_submit():
        usuario = models.Usuario.por_email(form.email.data.strip().lower())
        if usuario and usuario.activo and usuario.check_password(form.password.data):
            login_user(usuario, remember=form.recordar.data)
            destino = _destino_seguro()
            flash(f"Bienvenido de vuelta, {usuario.nombre}!", "success")
            return redirect(destino)
        flash("Credenciales invalidas. Verifica tu email y contrasena.", "danger")

    return render_template("login.html", form=form)


@bp.route("/recuperar", methods=["GET", "POST"])
def recuperar_password():
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))

    form = RecuperarPasswordForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        usuario = models.Usuario.por_email(email)
        mensaje_generico = (
            "Si existe una cuenta con ese email, enviamos un enlace para restablecer tu contrasena."
        )
        if usuario and usuario.activo:
            horas = int(current_app.config.get("PASSWORD_RESET_HOURS", 2))
            token = models.crear_token_recuperacion(int(usuario.id), horas_validez=horas)
            reset_url = url_restablecer_password(token)
            correo_ok = enviar_recuperacion_password(
                usuario.email,
                usuario.nombre,
                reset_url,
                horas,
            )
            if not correo_ok and current_app.debug:
                flash(f"(Desarrollo) Enlace de recuperacion: {reset_url}", "info")
            elif not correo_ok:
                logger = current_app.logger
                logger.warning("No se pudo enviar recuperacion de password a %s", email)
        flash(mensaje_generico, "success")
        return redirect(url_for("auth.login"))

    return render_template("recuperar_password.html", form=form, mail_configured=mail_configured())


@bp.route("/restablecer/<token>", methods=["GET", "POST"])
def restablecer_password(token: str):
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))

    uid = models.validar_token_recuperacion(token)
    if not uid:
        flash("El enlace de recuperacion no es valido o ya expiro. Solicita uno nuevo.", "warning")
        return redirect(url_for("auth.recuperar_password"))

    usuario = models.Usuario.por_id(uid)
    if not usuario or not usuario.activo:
        flash("No se pudo restablecer la contrasena para esta cuenta.", "danger")
        return redirect(url_for("auth.recuperar_password"))

    form = RestablecerPasswordForm()
    if form.validate_on_submit():
        models.Usuario.actualizar_password(uid, form.password.data)
        models.consumir_token_recuperacion(token)
        flash("Tu contrasena fue actualizada. Ya puedes ingresar.", "success")
        return redirect(url_for("auth.login"))

    return render_template(
        "restablecer_password.html",
        form=form,
        token=token,
        usuario=usuario,
    )


@bp.route("/registro", methods=["GET", "POST"])
def registro():
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))

    form = RegisterForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        if models.Usuario.por_email(email):
            flash("Ya existe una cuenta con ese email.", "warning")
        else:
            uid = models.Usuario.crear(
                nombre=form.nombre.data.strip(),
                email=email,
                password=form.password.data,
                telefono=form.telefono.data or None,
                es_agente=form.es_agente.data,
            )
            usuario = models.Usuario.por_id(uid)
            if usuario:
                login_user(usuario)
                flash("Tu cuenta fue creada. Bienvenido!", "success")
                return redirect(url_for("main.index"))

    return render_template("registro.html", form=form)


@bp.route("/google")
def google_login():
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))
    if not current_app.config.get("GOOGLE_CLIENT_ID"):
        flash("Google no esta configurado. Usa email y contrasena.", "warning")
        return redirect(url_for("auth.login"))

    nxt = request.args.get("next")
    if nxt and nxt.startswith("/") and not nxt.startswith("//"):
        session["oauth_next"] = nxt

    return oauth.google.authorize_redirect(_redirect_uri_google())


@bp.route("/google/callback")
def google_callback():
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))

    try:
        token = oauth.google.authorize_access_token()
    except Exception:
        flash("No se pudo completar el inicio con Google. Intenta de nuevo.", "danger")
        return redirect(url_for("auth.login"))

    info = token.get("userinfo")
    if not info:
        flash("Google no devolvio datos del usuario.", "danger")
        return redirect(url_for("auth.login"))

    if info.get("email_verified") is False:
        flash("Tu correo de Google no esta verificado.", "warning")
        return redirect(url_for("auth.login"))

    google_id = info.get("sub")
    email = (info.get("email") or "").strip().lower()
    nombre = (info.get("name") or email.split("@")[0] or "Usuario").strip()
    foto = info.get("picture")

    if not google_id or not email:
        flash("Faltan datos de la cuenta de Google.", "danger")
        return redirect(url_for("auth.login"))

    if models.Usuario.por_google_id(google_id) or models.Usuario.por_email(email):
        usuario = models.Usuario.login_o_registrar_google(google_id, email, nombre, foto)
        if not usuario or not usuario.activo:
            flash("No se pudo crear o activar tu cuenta.", "danger")
            return redirect(url_for("auth.login"))
        login_user(usuario, remember=True)
        flash(f"Bienvenido, {usuario.nombre}!", "success")
        return redirect(_destino_seguro())

    session["pending_google"] = {
        "google_id": google_id,
        "email": email,
        "nombre": nombre,
        "foto": foto,
    }
    return redirect(url_for("auth.google_terminos"))


@bp.route("/google/terminos", methods=["GET", "POST"])
def google_terminos():
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))

    pending = session.get("pending_google")
    if not pending:
        flash("Inicia sesion con Google para continuar.", "info")
        return redirect(url_for("auth.login"))

    form = GoogleTermsForm()
    if form.validate_on_submit():
        uid = models.Usuario.crear_con_google(
            pending["nombre"],
            pending["email"],
            pending["google_id"],
            pending.get("foto"),
        )
        session.pop("pending_google", None)
        usuario = models.Usuario.por_id(uid) if uid else None
        if not usuario or not usuario.activo:
            flash("No se pudo crear tu cuenta.", "danger")
            return redirect(url_for("auth.login"))
        login_user(usuario, remember=True)
        flash(f"Bienvenido, {usuario.nombre}!", "success")
        return redirect(_destino_seguro())

    return render_template(
        "google_terminos.html",
        form=form,
        email=pending.get("email", ""),
        nombre=pending.get("nombre", ""),
    )


@bp.route("/logout")
@login_required
def logout():
    logout_user()
    flash("Sesion cerrada.", "info")
    return redirect(url_for("main.index"))


@bp.route("/perfil")
@login_required
def perfil():
    uid = int(current_user.id)
    favs = models.favoritos_de(uid)
    anuncios = models.propiedades_de_usuario(uid)
    return render_template(
        "perfil.html",
        favoritos=favs,
        anuncios=anuncios,
        total_consultas=models.contar_consultas_usuario(uid),
        analytics=models.analytics_anunciante(uid, dias=28),
    )


@bp.route("/perfil/editar", methods=["GET", "POST"])
@login_required
def editar_perfil():
    uid = int(current_user.id)
    form = PerfilForm()
    if request.method == "GET":
        form.nombre.data = current_user.nombre
        form.telefono.data = current_user.telefono or ""
        form.biografia.data = current_user.biografia or ""
        form.foto_url.data = current_user.foto_url or ""
        form.es_agente.data = bool(current_user.es_agente)

    if form.validate_on_submit():
        models.Usuario.actualizar_perfil(
            uid,
            nombre=form.nombre.data.strip(),
            telefono=(form.telefono.data or "").strip() or None,
            biografia=(form.biografia.data or "").strip() or None,
            foto_url=(form.foto_url.data or "").strip() or None,
            es_agente=bool(form.es_agente.data),
        )
        flash("Tu perfil fue actualizado.", "success")
        return redirect(url_for("auth.perfil"))

    return render_template("perfil_editar.html", form=form)
