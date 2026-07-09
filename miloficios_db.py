"""Conexión ODBC a la base MilOficios (misma instancia SQL, otra BD)."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterable, Optional

from flask import current_app

from sql_dialect import is_mssql


def _connection_string() -> str:
    cfg = current_app.config_object
    if not is_mssql():
        raise RuntimeError("MilOficios requiere SQL Server / Azure SQL.")
    db_name = current_app.config.get("MILOFICIOS_DB_NAME", "MilOficios")
    parts = cfg._odbc_base_parts(include_database=False)
    parts.append(f"DATABASE={db_name}")
    return ";".join(parts) + ";"


def _row_to_dict(cur, row) -> dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        return dict(row)
    desc = cur.description
    if not desc:
        return {}
    return {col[0]: row[i] for i, col in enumerate(desc)}


@contextmanager
def miloficios_cursor():
    import pyodbc

    conn = pyodbc.connect(_connection_string(), autocommit=False)
    cur = conn.cursor()
    try:
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def mf_query_all(sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
    with miloficios_cursor() as cur:
        cur.execute(sql, tuple(params))
        return [_row_to_dict(cur, r) for r in cur.fetchall()]


def mf_query_one(sql: str, params: Iterable[Any] = ()) -> Optional[dict[str, Any]]:
    with miloficios_cursor() as cur:
        cur.execute(sql, tuple(params))
        row = cur.fetchone()
        return _row_to_dict(cur, row) if row else None


def mf_execute(sql: str, params: Iterable[Any] = ()) -> int:
    with miloficios_cursor() as cur:
        cur.execute(sql, tuple(params))
        return cur.rowcount


def mf_execute_scalar(sql: str, params: Iterable[Any] = ()) -> Any:
    with miloficios_cursor() as cur:
        cur.execute(sql, tuple(params))
        row = cur.fetchone()
        return row[0] if row else None


def mf_health() -> bool:
    mf_query_scalar("SELECT 1")
    return True


def mf_query_scalar(sql: str, params: Iterable[Any] = ()) -> Any:
    return mf_execute_scalar(sql, params)
