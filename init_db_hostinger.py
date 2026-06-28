"""Inicializa la base MySQL en Hostinger (importa schema + usuario demo)."""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from werkzeug.security import generate_password_hash

load_dotenv()

os.environ.setdefault("DB_ENGINE", "mysql")

from config import Config  # noqa: E402


def _read_schema() -> str:
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, "sql", "schema_mysql.sql")
    with open(path, encoding="utf-8") as f:
        return f.read()


def _split_statements(sql: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        buf.append(line)
        if stripped.endswith(";"):
            stmt = "\n".join(buf).strip().rstrip(";").strip()
            if stmt:
                parts.append(stmt)
            buf = []
    tail = "\n".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def main() -> int:
    if Config.DB_ENGINE != "mysql":
        print("Define DB_ENGINE=mysql en .env antes de ejecutar este script.")
        return 1
    if not Config.MYSQL_USER or not Config.MYSQL_PASSWORD or not Config.MYSQL_DATABASE:
        print("Completa MYSQL_USER, MYSQL_PASSWORD y MYSQL_DATABASE en .env")
        return 1

    import pymysql

    print(f"-> Conectando a MySQL {Config.MYSQL_HOST}:{Config.MYSQL_PORT} / {Config.MYSQL_DATABASE}")
    conn = pymysql.connect(
        host=Config.MYSQL_HOST,
        port=Config.MYSQL_PORT,
        user=Config.MYSQL_USER,
        password=Config.MYSQL_PASSWORD,
        database=Config.MYSQL_DATABASE,
        charset="utf8mb4",
        autocommit=True,
    )
    cur = conn.cursor()
    schema = _read_schema()
    for stmt in _split_statements(schema):
        try:
            cur.execute(stmt)
        except pymysql.err.ProgrammingError as e:
            if e.args and e.args[0] == 1064:
                print("AVISO SQL:", e)
            else:
                raise

    demo_email = "demo@miproximohogar.pe"
    demo_password = "Demo2050!"
    ph = generate_password_hash(demo_password)
    cur.execute("SELECT UsuarioId FROM Usuarios WHERE Email = %s", (demo_email,))
    if not cur.fetchone():
        cur.execute(
            "INSERT INTO Usuarios (NombreCompleto, Email, Telefono, PasswordHash, EsAgente, Biografia) "
            "VALUES (%s, %s, %s, %s, 1, %s)",
            (
                "Agencia Demo 2050",
                demo_email,
                "+51 999 000 111",
                ph,
                "Cuenta de demostracion Mi Proximo Hogar.",
            ),
        )
        print(f"-> Usuario demo creado: {demo_email} / {demo_password}")
    else:
        cur.execute("UPDATE Usuarios SET PasswordHash = %s WHERE Email = %s", (ph, demo_email))
        print(f"-> Password demo actualizado: {demo_email} / {demo_password}")

    cur.close()
    conn.close()
    print("\nListo. Base MySQL inicializada para Hostinger.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
