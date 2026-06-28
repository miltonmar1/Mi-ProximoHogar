"""Adaptacion SQL Server <-> MySQL para Mi Proximo Hogar."""
from __future__ import annotations

import os
import re

ENGINE = os.environ.get("DB_ENGINE", "mssql").strip().lower()


def is_mysql() -> bool:
    return ENGINE == "mysql"


def is_mssql() -> bool:
    return ENGINE in ("mssql", "sqlserver", "")


def T(name: str) -> str:
    """Nombre de tabla con prefijo dbo en SQL Server."""
    return f"dbo.{name}" if is_mssql() else name


def page(offset: int, limit: int) -> str:
    if is_mysql():
        return f" LIMIT {int(offset)}, {int(limit)}"
    return f" OFFSET {int(offset)} ROWS FETCH NEXT {int(limit)} ROWS ONLY"


def page_limit(limit: int) -> str:
    if is_mysql():
        return f" LIMIT {int(limit)}"
    return f" OFFSET 0 ROWS FETCH NEXT {int(limit)} ROWS ONLY"


def str_len(column: str) -> str:
    return f"CHAR_LENGTH({column})" if is_mysql() else f"LEN({column})"


def utc_now_sql() -> str:
    return "UTC_TIMESTAMP()" if is_mysql() else "SYSUTCDATETIME()"


def utc_date_sql() -> str:
    return "UTC_DATE()" if is_mysql() else "CAST(SYSUTCDATETIME() AS DATE)"


def imagen_principal_subquery() -> str:
    if is_mysql():
        return f"""(SELECT ip.Url FROM {T('ImagenesPropiedad')} ip
              WHERE ip.PropiedadId = p.PropiedadId
              ORDER BY ip.EsPrincipal DESC, ip.Orden
              LIMIT 1)"""
    return f"""(SELECT TOP 1 Url FROM {T('ImagenesPropiedad')} ip
              WHERE ip.PropiedadId = p.PropiedadId
              ORDER BY ip.EsPrincipal DESC, ip.Orden)"""


def upsert_vista_diaria_sql() -> str:
    if is_mysql():
        return f"""
            INSERT INTO {T('PropiedadVistasDiarias')} (PropiedadId, Fecha, TotalVistas)
            VALUES (?, {utc_date_sql()}, 1)
            ON DUPLICATE KEY UPDATE TotalVistas = TotalVistas + 1
        """
    return f"""
            MERGE {T('PropiedadVistasDiarias')} AS t
            USING (
                SELECT ? AS PropiedadId, {utc_date_sql()} AS Fecha
            ) AS s
            ON t.PropiedadId = s.PropiedadId AND t.Fecha = s.Fecha
            WHEN MATCHED THEN
                UPDATE SET TotalVistas = t.TotalVistas + 1
            WHEN NOT MATCHED THEN
                INSERT (PropiedadId, Fecha, TotalVistas)
                VALUES (s.PropiedadId, s.Fecha, 1);
        """


def fetch_inserted_id(cursor, column: str = "id") -> int:
    """Obtiene ID tras INSERT (OUTPUT INSERTED en SQL Server / lastrowid en MySQL)."""
    if is_mysql():
        return int(cursor.lastrowid or 0)
    row = cursor.fetchone()
    return int(row[0]) if row else 0


def adapt_sql(sql: str) -> str:
    """Convierte consultas T-SQL a MySQL cuando DB_ENGINE=mysql."""
    if not is_mysql():
        return sql

    s = sql.replace("dbo.", "").replace("N'", "'")
    s = re.sub(r"\bLEN\(([^)]+)\)", r"CHAR_LENGTH(\1)", s, flags=re.IGNORECASE)
    s = s.replace("SYSUTCDATETIME()", "UTC_TIMESTAMP()")
    s = re.sub(
        r"CAST\s*\(\s*UTC_TIMESTAMP\(\)\s+AS\s+DATE\s*\)",
        "UTC_DATE()",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"CAST\s*\(\s*SYSUTCDATETIME\(\)\s+AS\s+DATE\s*\)",
        "UTC_DATE()",
        s,
        flags=re.IGNORECASE,
    )

    s = re.sub(
        r"OFFSET\s+\?\s+ROWS\s+FETCH\s+NEXT\s+\?\s+ROWS\s+ONLY",
        "LIMIT ?, ?",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"OFFSET\s+0\s+ROWS\s+FETCH\s+NEXT\s+\?\s+ROWS\s+ONLY",
        "LIMIT ?",
        s,
        flags=re.IGNORECASE,
    )

    # SELECT TOP n al inicio -> LIMIT n al final
    while True:
        m = re.search(r"SELECT\s+(DISTINCT\s+)?TOP\s+(\d+)\s+", s, re.IGNORECASE)
        if not m:
            break
        n = m.group(2)
        s = s[: m.start()] + f"SELECT {m.group(1) or ''}" + s[m.end() :]
        s = s.rstrip().rstrip(";") + f" LIMIT {n}"

  # Subconsultas (SELECT TOP 1 ...)
    s = re.sub(r"\(\s*SELECT\s+TOP\s+1\s+", "(SELECT ", s, flags=re.IGNORECASE)
    s = re.sub(
        r"(ORDER BY\s+ip\.EsPrincipal\s+DESC,\s+ip\.Orden)\s*\)",
        r"\1 LIMIT 1)",
        s,
        flags=re.IGNORECASE,
    )

    return s
