"""Capa de acceso a datos — SQL Server (local) o MySQL (Hostinger)."""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterable, Optional

from flask import current_app, g

from sql_dialect import adapt_sql, is_mysql, is_mssql

logger = logging.getLogger(__name__)


def _connect():
    cfg = current_app.config_object
    if is_mysql():
        import pymysql

        kwargs = dict(
            host=cfg.MYSQL_HOST,
            port=int(cfg.MYSQL_PORT),
            user=cfg.MYSQL_USER,
            password=cfg.MYSQL_PASSWORD,
            database=cfg.MYSQL_DATABASE,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.Cursor,
            autocommit=False,
        )
        if getattr(cfg, "MYSQL_SSL", False):
            kwargs["ssl"] = {"ssl": {}}
        return pymysql.connect(**kwargs)
    import pyodbc

    return pyodbc.connect(current_app.config["DB_CONNECTION_STRING"], autocommit=False)


def get_connection():
    """Obtiene (o crea) una conexion asociada al request actual."""
    if "db_conn" not in g:
        g.db_conn = _connect()
    return g.db_conn


def close_connection(exception: Optional[BaseException] = None) -> None:
    conn = g.pop("db_conn", None)
    if conn is not None:
        try:
            if exception is None:
                conn.commit()
            else:
                conn.rollback()
        finally:
            conn.close()


@contextmanager
def cursor():
    conn = get_connection()
    cur = conn.cursor()
    try:
        yield cur
    finally:
        cur.close()


def _row_to_dict(cur, row) -> dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        return dict(row)
    desc = cur.description
    if not desc:
        return {}
    return {col[0]: row[i] for i, col in enumerate(desc)}


def query_all(sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
    sql = adapt_sql(sql)
    with cursor() as cur:
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        return [_row_to_dict(cur, r) for r in rows]


def query_one(sql: str, params: Iterable[Any] = ()) -> Optional[dict[str, Any]]:
    sql = adapt_sql(sql)
    with cursor() as cur:
        cur.execute(sql, tuple(params))
        row = cur.fetchone()
        return _row_to_dict(cur, row) if row else None


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    sql = adapt_sql(sql)
    with cursor() as cur:
        cur.execute(sql, tuple(params))
        return cur.rowcount


def execute_scalar(sql: str, params: Iterable[Any] = ()) -> Any:
    sql = adapt_sql(sql)
    with cursor() as cur:
        cur.execute(sql, tuple(params))
        row = cur.fetchone()
        return row[0] if row else None


def init_app(app) -> None:
    if is_mssql():
        app.config["DB_CONNECTION_STRING"] = app.config_object.connection_string()
    app.teardown_appcontext(close_connection)


def ensure_database_exists(app) -> None:
    """Crea la base en SQL Server local. En MySQL/Azure la crea el panel o portal."""
    if is_mysql():
        return
    if app.config_object.DB_AZURE:
        return
    cfg = app.config_object
    db_name = cfg.DB_NAME
    try:
        import pyodbc

        conn = pyodbc.connect(cfg.master_connection_string(), autocommit=True)
        cur = conn.cursor()
        cur.execute("SELECT database_id FROM sys.databases WHERE name = ?", db_name)
        if cur.fetchone() is None:
            logger.info("Creando base de datos %s", db_name)
            cur.execute(f"CREATE DATABASE [{db_name}]")
        cur.close()
        conn.close()
    except Exception as e:
        logger.warning("No se pudo verificar/crear la base de datos: %s", e)
