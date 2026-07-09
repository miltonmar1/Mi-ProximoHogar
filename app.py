"""Mi Proximo Hogar - aplicacion Flask."""
from __future__ import annotations

import os
from datetime import datetime

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, request
from flask_login import LoginManager

import database
import models
from config import Config
from extensions import oauth


def _register_google_oauth(app: Flask) -> None:
    if not app.config.get("GOOGLE_CLIENT_ID") or not app.config.get("GOOGLE_CLIENT_SECRET"):
        return
    try:
        oauth.init_app(app)
        oauth.register(
            name="google",
            client_id=app.config["GOOGLE_CLIENT_ID"],
            client_secret=app.config["GOOGLE_CLIENT_SECRET"],
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )
    except Exception as exc:
        app.logger.warning("Google OAuth no disponible: %s", exc)


def create_app(config_class: type[Config] = Config) -> Flask:
    app = Flask(__name__, instance_relative_config=False)
    app.config.from_object(config_class)
    app.config_object = config_class  # type: ignore[attr-defined]

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    database.ensure_database_exists(app)
    database.init_app(app)
    _register_google_oauth(app)

    login_manager = LoginManager(app)
    login_manager.login_view = "auth.login"
    login_manager.login_message = "Inicia sesion para acceder."
    login_manager.login_message_category = "info"

    @login_manager.user_loader
    def load_user(user_id: str):
        try:
            return models.Usuario.por_id(int(user_id))
        except (TypeError, ValueError):
            return None
        except Exception as exc:
            app.logger.warning("No se pudo cargar usuario %s: %s", user_id, exc)
            return None

    from routes.main import bp as main_bp
    from routes.auth import bp as auth_bp
    from routes.propiedades import bp as propiedades_bp
    from routes.api import bp as api_bp
    from routes.miloficios_api import bp as miloficios_api_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(propiedades_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(miloficios_api_bp)

    if config_class.is_production():
        @app.after_request
        def _security_headers(response):
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "SAMEORIGIN"
            response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
            response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
            if request.is_secure or request.headers.get("X-Forwarded-Proto") == "https":
                response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            return response

        for err in config_class.validate_production():
            app.logger.warning("Config produccion: %s", err)

    @app.route("/health")
    def health_check():
        """Sonda de salud para Azure App Service y balanceadores."""
        from flask import jsonify

        status = {"status": "ok", "service": "miproximohogar"}
        try:
            from database import query_scalar

            query_scalar("SELECT 1")
            status["database"] = "ok"
        except Exception as exc:
            status["database"] = "error"
            status["detail"] = str(exc)[:200]
            return jsonify(status), 503
        return jsonify(status)

    @app.errorhandler(500)
    def internal_error(err):
        from flask import render_template_string

        app.logger.exception("Error 500: %s", err)
        return render_template_string(
            """<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
            <title>Error - Mi Proximo Hogar</title>
            <style>body{font-family:sans-serif;max-width:520px;margin:4rem auto;padding:1rem}
            h1{color:#c2410c}a{color:#ea580c}</style></head><body>
            <h1>Sitio en configuracion</h1>
            <p>La aplicacion esta activa pero falta conectar la base de datos.</p>
            <p>Revisa <a href="/health">/health</a> para diagnosticar.</p>
            </body></html>""",
            500,
        )

    @app.template_filter("precio")
    def fmt_precio(value, moneda: str = "PEN"):
        if value is None:
            return "-"
        try:
            value = float(value)
        except (TypeError, ValueError):
            return str(value)
        prefijo = "US$ " if (moneda or "").upper() == "USD" else "S/ "
        return f"{prefijo}{value:,.0f}".replace(",", ".")

    @app.template_filter("precio_tarjeta")
    def precio_tarjeta_row(row):
        return models.precio_presentacion_tarjeta(row or {})

    @app.template_filter("fecha")
    def fmt_fecha(value):
        if not value:
            return ""
        if isinstance(value, str):
            return value
        try:
            return value.strftime("%d/%m/%Y")
        except Exception:
            return str(value)

    @app.template_filter("whatsapp_url")
    def whatsapp_url_filter(telefono, texto=""):
        from services.phone import url_whatsapp

        return url_whatsapp(telefono, texto or "")

    @app.context_processor
    def inject_globals():
        from flask import request
        from models import ciudad_id_por_nombre

        def absolute_url(path: str = "") -> str:
            base = app.config.get("SITE_URL") or request.url_root.rstrip("/")
            if not path:
                return base + request.path
            if path.startswith("http://") or path.startswith("https://"):
                return path
            if not path.startswith("/"):
                path = "/" + path
            return base + path

        map_ciudad = app.config.get("MAP_CIUDAD") or "Cusco"
        try:
            map_ciudad_id = ciudad_id_por_nombre(map_ciudad)
        except Exception:
            map_ciudad_id = None
        return {
            "year": datetime.now().year,
            "marca": "Mi Proximo Hogar",
            "site_url": app.config.get("SITE_URL") or "",
            "absolute_url": absolute_url,
            "google_maps_key": app.config.get("GOOGLE_MAPS_API_KEY") or "",
            "map_ciudad": map_ciudad,
            "map_ciudad_id": map_ciudad_id,
            "map_center_lat": app.config.get("MAP_CENTER_LAT", -13.5319),
            "map_center_lng": app.config.get("MAP_CENTER_LNG", -71.9675),
            "map_zoom": app.config.get("MAP_ZOOM", 13),
            "google_oauth_enabled": bool(
                app.config.get("GOOGLE_CLIENT_ID") and app.config.get("GOOGLE_CLIENT_SECRET")
            ),
            "legal_entity": app.config_object.LEGAL_ENTITY_NAME,
            "legal_ruc": app.config_object.LEGAL_RUC,
            "legal_address": app.config_object.LEGAL_ADDRESS,
            "legal_email": app.config_object.LEGAL_EMAIL,
            "legal_phone": app.config_object.LEGAL_PHONE,
        }

    return app


if __name__ == "__main__":
    app = create_app()
    port = int(os.environ.get("PORT", "5000"))
    debug = Config.FLASK_DEBUG and not Config.is_production()
    host = "127.0.0.1" if not Config.is_production() else "0.0.0.0"
    app.run(host=host, port=port, debug=debug)
