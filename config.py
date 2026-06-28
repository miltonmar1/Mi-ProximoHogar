"""Configuracion central de la aplicacion Mi Proximo Hogar."""
import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-key-change-me-in-production")

    # mssql = SQL Server local / Azure SQL | mysql = Hostinger
    DB_ENGINE = os.environ.get("DB_ENGINE", "mssql").strip().lower()

    # SQL Server (local o Azure SQL Database)
    DB_DRIVER = os.environ.get("DB_DRIVER", "ODBC Driver 17 for SQL Server")
    DB_SERVER = os.environ.get("DB_SERVER", "localhost\\SQLEXPRESS")
    DB_NAME = os.environ.get("DB_NAME", "MiProximoHogar")
    DB_TRUSTED = os.environ.get("DB_TRUSTED_CONNECTION", "yes").lower() == "yes"
    DB_USER = os.environ.get("DB_USER", "")
    DB_PASSWORD = os.environ.get("DB_PASSWORD", "")
    # Azure SQL: Encrypt=yes obligatorio; en local puede ser no
    DB_ENCRYPT = os.environ.get("DB_ENCRYPT", "no").lower() in ("1", "true", "yes")
    DB_TRUST_SERVER_CERTIFICATE = os.environ.get(
        "DB_TRUST_SERVER_CERTIFICATE", "no"
    ).lower() in ("1", "true", "yes")
    # Si es Azure SQL, no intentar CREATE DATABASE al arrancar
    DB_AZURE = os.environ.get("DB_AZURE", "no").lower() in ("1", "true", "yes")

    # MySQL (Hostinger)
    MYSQL_HOST = os.environ.get("MYSQL_HOST", "localhost")
    MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
    MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE", os.environ.get("DB_NAME", "miproximohogar"))
    MYSQL_USER = os.environ.get("MYSQL_USER", "")
    MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")
    MYSQL_SSL = os.environ.get("MYSQL_SSL", "no").lower() in ("1", "true", "yes")

    FLASK_ENV = os.environ.get("FLASK_ENV", "development")
    FLASK_DEBUG = os.environ.get("FLASK_DEBUG", "1").lower() in ("1", "true", "yes")

    UPLOAD_FOLDER = os.path.join(BASE_DIR, os.environ.get("UPLOAD_FOLDER", "static/uploads"))
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_CONTENT_LENGTH", 32 * 1024 * 1024))
    WTF_CSRF_TIME_LIMIT = None
    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}

    ITEMS_PER_PAGE = 12

    GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()

    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
    GOOGLE_OAUTH_REDIRECT_URI = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", "").strip()

    MAP_CIUDAD = "Cusco"
    MAP_CENTER_LAT = -13.5319
    MAP_CENTER_LNG = -71.9675
    MAP_ZOOM = 13

    SITE_URL = os.environ.get("SITE_URL", "http://127.0.0.1:5000").rstrip("/")

    MAIL_SERVER = os.environ.get("MAIL_SERVER", "").strip()
    MAIL_PORT = int(os.environ.get("MAIL_PORT", "587"))
    MAIL_USE_TLS = os.environ.get("MAIL_USE_TLS", "true").lower() == "true"
    MAIL_USERNAME = os.environ.get("MAIL_USERNAME", "").strip()
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "").strip()
    MAIL_DEFAULT_SENDER = os.environ.get("MAIL_DEFAULT_SENDER", "").strip()

    PASSWORD_RESET_HOURS = int(os.environ.get("PASSWORD_RESET_HOURS", "2"))

    # Datos legales (politicas de privacidad / aviso legal)
    LEGAL_ENTITY_NAME = os.environ.get("LEGAL_ENTITY_NAME", "Mi Proximo Hogar").strip()
    LEGAL_RUC = os.environ.get("LEGAL_RUC", "").strip()
    LEGAL_ADDRESS = os.environ.get("LEGAL_ADDRESS", "Peru").strip()
    LEGAL_EMAIL = os.environ.get("LEGAL_EMAIL", "contacto@miproximohogar.pe").strip()
    LEGAL_PHONE = os.environ.get("LEGAL_PHONE", "").strip()

    @classmethod
    def is_production(cls) -> bool:
        return cls.FLASK_ENV.lower() == "production"

    @classmethod
    def mail_configured(cls) -> bool:
        return bool(cls.MAIL_SERVER and cls.MAIL_DEFAULT_SENDER)

    @classmethod
    def google_oauth_configured(cls) -> bool:
        return bool(cls.GOOGLE_CLIENT_ID and cls.GOOGLE_CLIENT_SECRET)

    @classmethod
    def _odbc_base_parts(cls, *, include_database: bool = True) -> list[str]:
        parts = [
            f"DRIVER={{{cls.DB_DRIVER}}}",
            f"SERVER={cls.DB_SERVER}",
        ]
        if include_database:
            parts.append(f"DATABASE={cls.DB_NAME}")
        if cls.DB_TRUSTED:
            parts.append("Trusted_Connection=yes")
        else:
            parts.append(f"UID={cls.DB_USER}")
            parts.append(f"PWD={cls.DB_PASSWORD}")
        if cls.DB_ENCRYPT:
            parts.append("Encrypt=yes")
            parts.append(
                f"TrustServerCertificate={'yes' if cls.DB_TRUST_SERVER_CERTIFICATE else 'no'}"
            )
        return parts

    @classmethod
    def connection_string(cls) -> str:
        return ";".join(cls._odbc_base_parts(include_database=True)) + ";"

    @classmethod
    def master_connection_string(cls) -> str:
        return ";".join(cls._odbc_base_parts(include_database=False)) + ";"

    @classmethod
    def validate_production(cls) -> list[str]:
        """Errores de configuracion antes de publicar."""
        errors: list[str] = []
        if cls.SECRET_KEY in ("", "dev-key-change-me-in-production"):
            errors.append("SECRET_KEY debe ser una clave larga y aleatoria en produccion.")
        if cls.DB_ENGINE in ("mssql", "sqlserver", ""):
            if not cls.DB_TRUSTED:
                if not cls.DB_USER:
                    errors.append("DB_USER es obligatorio cuando DB_TRUSTED_CONNECTION=no.")
                if not cls.DB_PASSWORD:
                    errors.append("DB_PASSWORD es obligatorio cuando DB_TRUSTED_CONNECTION=no.")
            if cls.DB_AZURE and cls.DB_TRUSTED:
                errors.append("Azure SQL requiere DB_TRUSTED_CONNECTION=no y usuario SQL.")
        elif cls.DB_ENGINE == "mysql":
            if not cls.MYSQL_USER:
                errors.append("MYSQL_USER es obligatorio.")
            if not cls.MYSQL_PASSWORD:
                errors.append("MYSQL_PASSWORD es obligatorio.")
            if not cls.MYSQL_DATABASE:
                errors.append("MYSQL_DATABASE es obligatorio.")
        if not cls.LEGAL_EMAIL or "@" not in cls.LEGAL_EMAIL:
            if cls.is_production():
                errors.append("LEGAL_EMAIL debe ser un correo de contacto valido.")
        if cls.FLASK_DEBUG and cls.is_production():
            errors.append("FLASK_DEBUG debe ser 0 en produccion.")
        if "127.0.0.1" in cls.SITE_URL and cls.is_production():
            errors.append("SITE_URL debe ser tu dominio publico (https://tudominio.pe).")
        return errors
