"""Notificaciones por correo (consultas a anunciantes)."""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any
from urllib.parse import urljoin

from flask import current_app

logger = logging.getLogger(__name__)


def mail_configured() -> bool:
    cfg = current_app.config
    return bool(cfg.get("MAIL_SERVER") and cfg.get("MAIL_DEFAULT_SENDER"))


def _fmt_precio(value: Any, moneda: str = "PEN") -> str:
    if value is None:
        return "—"
    try:
        n = float(value)
    except (TypeError, ValueError):
        return str(value)
    pref = "US$ " if (moneda or "").upper() == "USD" else "S/ "
    return f"{pref}{n:,.0f}".replace(",", ".")


def enviar_correo(destinatario: str, asunto: str, cuerpo_texto: str, cuerpo_html: str | None = None) -> bool:
    if not destinatario or "@" not in destinatario:
        return False
    cfg = current_app.config
    if not mail_configured():
        logger.warning(
            "Correo no configurado (MAIL_SERVER / MAIL_DEFAULT_SENDER). Mensaje no enviado a %s",
            destinatario,
        )
        return False

    remitente = cfg["MAIL_DEFAULT_SENDER"]
    msg = MIMEMultipart("alternative")
    msg["Subject"] = asunto
    msg["From"] = remitente
    msg["To"] = destinatario
    msg.attach(MIMEText(cuerpo_texto, "plain", "utf-8"))
    if cuerpo_html:
        msg.attach(MIMEText(cuerpo_html, "html", "utf-8"))

    use_tls = cfg.get("MAIL_USE_TLS", True)
    port = int(cfg.get("MAIL_PORT", 587))
    server_host = cfg["MAIL_SERVER"]
    username = cfg.get("MAIL_USERNAME") or ""
    password = cfg.get("MAIL_PASSWORD") or ""

    try:
        with smtplib.SMTP(server_host, port, timeout=20) as smtp:
            if use_tls:
                smtp.starttls()
            if username:
                smtp.login(username, password)
            smtp.sendmail(remitente, [destinatario], msg.as_string())
        return True
    except Exception:
        logger.exception("Error al enviar correo a %s", destinatario)
        return False


def notificar_consulta_anunciante(
    prop: dict[str, Any],
    *,
    nombre: str,
    email: str,
    telefono: str | None,
    mensaje: str,
    detalle_url: str,
) -> bool:
    """Avisa al dueno del anuncio que recibio una consulta. Devuelve True si se envio el correo."""
    destinatario = (prop.get("AnuncianteEmail") or "").strip()
    if not destinatario:
        logger.warning("Propiedad %s sin email de anunciante", prop.get("PropiedadId"))
        return False

    titulo = prop.get("Titulo") or "tu anuncio"
    precio = _fmt_precio(prop.get("Precio"), prop.get("Moneda") or "PEN")
    ubicacion = ", ".join(
        x for x in [prop.get("Distrito"), prop.get("Ciudad")] if x
    )
    tel_linea = f"Telefono: {telefono}\n" if telefono else ""
    asunto = f"Nueva consulta — {titulo}"

    cuerpo = (
        f"Hola {prop.get('Anunciante') or 'anunciante'},\n\n"
        f"Recibiste una consulta sobre tu anuncio en Mi Proximo Hogar.\n\n"
        f"Propiedad: {titulo}\n"
        f"Precio: {precio}\n"
        f"Ubicacion: {ubicacion or '—'}\n"
        f"Ver anuncio: {detalle_url}\n\n"
        f"--- Datos del interesado ---\n"
        f"Nombre: {nombre}\n"
        f"Email: {email}\n"
        f"{tel_linea}"
        f"Mensaje:\n{mensaje}\n\n"
        f"— Mi Proximo Hogar\n"
    )

    html = (
        "<div style='font-family:Montserrat,Arial,sans-serif;max-width:560px'>"
        f"<h2 style='color:#ff6b00'>Nueva consulta</h2>"
        f"<p>Recibiste un mensaje sobre <strong>{titulo}</strong>.</p>"
        "<table style='width:100%;border-collapse:collapse;margin:12px 0'>"
        f"<tr><td style='padding:4px 0;color:#64748b'>Precio</td><td><strong>{precio}</strong></td></tr>"
        f"<tr><td style='padding:4px 0;color:#64748b'>Ubicacion</td><td>{ubicacion or '—'}</td></tr>"
        "</table>"
        f"<p><a href='{detalle_url}' style='color:#ff6b00'>Ver anuncio en el portal</a></p>"
        "<hr style='border:none;border-top:1px solid #e2e8f0;margin:16px 0'>"
        f"<p><strong>{nombre}</strong><br>"
        f"<a href='mailto:{email}'>{email}</a>"
        + (f"<br>{telefono}" if telefono else "")
        + "</p>"
        f"<p style='background:#f8fafc;padding:12px;border-radius:8px'>{mensaje}</p>"
        "</div>"
    )

    return enviar_correo(destinatario, asunto, cuerpo, html)


def url_detalle_propiedad(propiedad_id: int) -> str:
    base = (current_app.config.get("SITE_URL") or "").rstrip("/")
    if not base:
        base = "http://127.0.0.1:5000"
    return urljoin(base + "/", f"propiedad/{propiedad_id}")


def url_restablecer_password(token: str) -> str:
    base = (current_app.config.get("SITE_URL") or "").rstrip("/")
    if not base:
        base = "http://127.0.0.1:5000"
    return urljoin(base + "/", f"cuenta/restablecer/{token}")


def enviar_recuperacion_password(email: str, nombre: str, reset_url: str, horas_validez: int) -> bool:
    asunto = "Recupera tu contrasena — Mi Proximo Hogar"
    cuerpo = (
        f"Hola {nombre or 'usuario'},\n\n"
        "Recibimos una solicitud para restablecer la contrasena de tu cuenta en Mi Proximo Hogar.\n\n"
        f"Abre este enlace (valido {horas_validez} horas):\n{reset_url}\n\n"
        "Si no solicitaste este cambio, ignora este mensaje. Tu contrasena no cambiara.\n\n"
        "— Mi Proximo Hogar\n"
    )
    html = (
        "<div style='font-family:Montserrat,Arial,sans-serif;max-width:560px'>"
        "<h2 style='color:#ff6b00'>Recuperar contrasena</h2>"
        f"<p>Hola <strong>{nombre or 'usuario'}</strong>,</p>"
        "<p>Usa el boton para elegir una nueva contrasena. El enlace caduca en "
        f"<strong>{horas_validez} horas</strong>.</p>"
        f"<p style='margin:24px 0'><a href='{reset_url}' "
        "style='display:inline-block;background:#ff6b00;color:#fff;padding:12px 20px;"
        "border-radius:8px;text-decoration:none;font-weight:700'>Restablecer contrasena</a></p>"
        f"<p style='font-size:13px;color:#64748b'>O copia este enlace:<br>{reset_url}</p>"
        "<p style='font-size:13px;color:#64748b'>Si no fuiste tu, puedes ignorar este correo.</p>"
        "</div>"
    )
    return enviar_correo(email, asunto, cuerpo, html)
