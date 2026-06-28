"""Script de inicializacion de la base de datos.

Ejecuta:
  1. Crea la base de datos si no existe.
  2. Aplica el esquema (sql/schema.sql).
  3. Crea/actualiza un usuario demo con password hash valido.

Uso:
    python init_db.py
"""
from __future__ import annotations

import os
import sys

import pyodbc
from werkzeug.security import generate_password_hash

from app import create_app
from config import Config
import database


SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "sql", "schema.sql")
DEMO_EMAIL = "demo@miproximohogar.pe"
DEMO_PASSWORD = "Demo2050!"


def _split_batches(sql: str) -> list[str]:
    """Divide el script por separadores GO (case-insensitive, en linea propia)."""
    batches: list[str] = []
    actual: list[str] = []
    for linea in sql.splitlines():
        if linea.strip().upper() == "GO":
            texto = "\n".join(actual).strip()
            if texto:
                batches.append(texto)
            actual = []
        else:
            actual.append(linea)
    texto = "\n".join(actual).strip()
    if texto:
        batches.append(texto)
    return batches


def ejecutar_schema(cs: str) -> None:
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        contenido = f.read()
    batches = _split_batches(contenido)
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        for i, batch in enumerate(batches, 1):
            try:
                cur.execute(batch)
                while cur.nextset():
                    pass
            except pyodbc.Error as e:
                print(f"[WARN] Batch {i} fallo: {e}")
        cur.close()
    finally:
        conn.close()


def actualizar_coordenadas_demo(cs: str) -> None:
    """Asigna lat/lng a propiedades demo para el mapa (zona Cusco)."""
    updates = [
        ("Cusco", -13.5167, -71.9787),
        ("San Blas", -13.5148, -71.9755),
        ("Wanchaq", -13.5255, -71.9682),
        ("Santiago", -13.5188, -71.9825),
        ("San Jeronimo", -13.5288, -71.9055),
        ("Saylla", -13.5585, -71.8540),
    ]
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        for distrito, lat, lng in updates:
            cur.execute(
                "UPDATE dbo.Propiedades SET Latitud = ?, Longitud = ? "
                "WHERE Distrito LIKE ?",
                (lat, lng, f"%{distrito}%"),
            )
        cur.close()
    finally:
        conn.close()


def migrar_poligono_lote(cs: str) -> None:
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.Propiedades') AND name = N'PoligonoLote'
            )
            ALTER TABLE dbo.Propiedades ADD PoligonoLote NVARCHAR(MAX) NULL
            """
        )
        cur.close()
    finally:
        conn.close()


def migrar_google_oauth(cs: str) -> None:
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.Usuarios') AND name = N'GoogleId'
            )
            ALTER TABLE dbo.Usuarios ADD GoogleId NVARCHAR(128) NULL
            """
        )
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.Usuarios') AND name = N'OAuthProvider'
            )
            ALTER TABLE dbo.Usuarios ADD OAuthProvider NVARCHAR(20) NULL
            """
        )
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = N'UX_Usuarios_GoogleId' AND object_id = OBJECT_ID(N'dbo.Usuarios')
            )
            CREATE UNIQUE INDEX UX_Usuarios_GoogleId ON dbo.Usuarios(GoogleId)
            WHERE GoogleId IS NOT NULL
            """
        )
        cur.close()
    finally:
        conn.close()


def migrar_estado_propiedad(cs: str) -> None:
    """Columna Estado y valores por defecto para publicaciones visibles."""
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.Propiedades') AND name = N'Estado'
            )
            ALTER TABLE dbo.Propiedades ADD Estado NVARCHAR(20) NOT NULL
                CONSTRAINT DF_Propiedades_Estado DEFAULT 'activo'
            """
        )
        cur.execute(
            "UPDATE dbo.Propiedades SET Estado = 'activo' WHERE Estado IS NULL OR Estado = ''"
        )
        cur.close()
    finally:
        conn.close()


def migrar_plan_masterplan(cs: str) -> None:
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.Propiedades') AND name = N'PlanMasterplan'
            )
            ALTER TABLE dbo.Propiedades ADD PlanMasterplan NVARCHAR(MAX) NULL
            """
        )
        cur.close()
    finally:
        conn.close()


def migrar_password_reset(cs: str) -> None:
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'PasswordResetTokens')
            CREATE TABLE dbo.PasswordResetTokens (
                TokenId INT IDENTITY(1,1) PRIMARY KEY,
                UsuarioId INT NOT NULL REFERENCES dbo.Usuarios(UsuarioId) ON DELETE CASCADE,
                TokenHash NVARCHAR(128) NOT NULL,
                FechaCreacion DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                FechaExpiracion DATETIME2 NOT NULL,
                Usado BIT NOT NULL DEFAULT 0
            )
            """
        )
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = N'IX_PasswordResetTokens_Hash'
                  AND object_id = OBJECT_ID(N'dbo.PasswordResetTokens')
            )
            CREATE INDEX IX_PasswordResetTokens_Hash
                ON dbo.PasswordResetTokens(TokenHash)
            """
        )
        cur.close()
    finally:
        conn.close()


def migrar_listas_compartidas(cs: str) -> None:
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'ListasCompartidas')
            CREATE TABLE dbo.ListasCompartidas (
                ListaId INT IDENTITY(1,1) PRIMARY KEY,
                UsuarioId INT NOT NULL REFERENCES dbo.Usuarios(UsuarioId),
                Token NVARCHAR(64) NOT NULL UNIQUE,
                Titulo NVARCHAR(200) NOT NULL,
                FechaCreacion DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                Activa BIT NOT NULL DEFAULT 1
            )
            """
        )
        cur.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'ListasCompartidasPropiedades')
            CREATE TABLE dbo.ListasCompartidasPropiedades (
                ListaId INT NOT NULL REFERENCES dbo.ListasCompartidas(ListaId) ON DELETE CASCADE,
                PropiedadId INT NOT NULL REFERENCES dbo.Propiedades(PropiedadId) ON DELETE CASCADE,
                PRIMARY KEY (ListaId, PropiedadId)
            )
            """
        )
        cur.close()
    finally:
        conn.close()


def migrar_listas_compartidas_vistas(cs: str) -> None:
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.ListasCompartidas') AND name = N'Vistas'
            )
            ALTER TABLE dbo.ListasCompartidas ADD Vistas INT NOT NULL DEFAULT 0
            """
        )
        cur.close()
    finally:
        conn.close()


def migrar_analytics(cs: str) -> None:
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'PropiedadVistasDiarias')
            CREATE TABLE dbo.PropiedadVistasDiarias (
                VistaDiariaId INT IDENTITY(1,1) PRIMARY KEY,
                PropiedadId INT NOT NULL REFERENCES dbo.Propiedades(PropiedadId) ON DELETE CASCADE,
                Fecha DATE NOT NULL,
                TotalVistas INT NOT NULL DEFAULT 0,
                CONSTRAINT UQ_PropiedadVistasDiarias UNIQUE (PropiedadId, Fecha)
            )
            """
        )
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = N'IX_PropiedadVistasDiarias_Fecha'
                  AND object_id = OBJECT_ID(N'dbo.PropiedadVistasDiarias')
            )
            CREATE INDEX IX_PropiedadVistasDiarias_Fecha ON dbo.PropiedadVistasDiarias(Fecha)
            """
        )
        cur.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'LoteEventos')
            CREATE TABLE dbo.LoteEventos (
                EventoId INT IDENTITY(1,1) PRIMARY KEY,
                PropiedadId INT NOT NULL REFERENCES dbo.Propiedades(PropiedadId) ON DELETE CASCADE,
                LoteRef NVARCHAR(80) NOT NULL,
                TipoEvento NVARCHAR(30) NOT NULL DEFAULT N'view',
                SessionId NVARCHAR(64) NULL,
                UsuarioId INT NULL REFERENCES dbo.Usuarios(UsuarioId) ON DELETE SET NULL,
                FechaHora DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            )
            """
        )
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = N'IX_LoteEventos_Propiedad'
                  AND object_id = OBJECT_ID(N'dbo.LoteEventos')
            )
            CREATE INDEX IX_LoteEventos_Propiedad ON dbo.LoteEventos(PropiedadId, FechaHora)
            """
        )
        cur.close()
    finally:
        conn.close()


def migrar_videos_propiedad(cs: str) -> None:
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'VideosPropiedad')
            CREATE TABLE dbo.VideosPropiedad (
                VideoId INT IDENTITY(1,1) PRIMARY KEY,
                PropiedadId INT NOT NULL REFERENCES dbo.Propiedades(PropiedadId) ON DELETE CASCADE,
                UrlOriginal NVARCHAR(500) NOT NULL,
                Plataforma NVARCHAR(20) NOT NULL,
                UrlEmbed NVARCHAR(700) NOT NULL,
                Orden INT NOT NULL DEFAULT 0
            )
            """
        )
        cur.close()
    finally:
        conn.close()


def migrar_utm_coordenadas(cs: str) -> None:
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.Propiedades') AND name = N'UtmZona'
            )
            ALTER TABLE dbo.Propiedades ADD
                UtmZona NVARCHAR(8) NULL,
                UtmEste DECIMAL(14,3) NULL,
                UtmNorte DECIMAL(14,3) NULL,
                AreaMapaM2 DECIMAL(14,2) NULL,
                UtmVertices NVARCHAR(MAX) NULL
            """
        )
        cur.close()
    finally:
        conn.close()


def sembrar_lotes_cusco(cs: str) -> None:
    """Inserta terrenos y lotes demo en Cusco para el mapa."""
    lotes = [
        (
            "Lote residencial San Blas",
            "Calle Carmen Alto 120",
            "San Blas",
            85000,
            "USD",
            180,
            -13.5145,
            -71.9758,
        ),
        (
            "Terreno comercial Wanchaq",
            "Av. El Sol 890",
            "Wanchaq",
            120000,
            "USD",
            320,
            -13.5260,
            -71.9675,
        ),
        (
            "Lote economico Santiago",
            "Jr. Maruri 45",
            "Santiago",
            42000,
            "USD",
            150,
            -13.5195,
            -71.9830,
        ),
        (
            "Terreno premium vista Sacsayhuaman",
            "Sector Sacsayhuaman",
            "Cusco",
            195000,
            "USD",
            500,
            -13.5085,
            -71.9810,
        ),
        (
            "Lote expansion San Jeronimo",
            "Av. San Jeronimo Km 4",
            "San Jeronimo",
            55000,
            "USD",
            280,
            -13.5310,
            -71.9020,
        ),
        (
            "Terreno Saylla valle sur",
            "Carretera Saylla",
            "Saylla",
            38000,
            "USD",
            400,
            -13.5590,
            -71.8520,
        ),
    ]
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM dbo.Propiedades p "
            "INNER JOIN dbo.Ciudades c ON c.CiudadId = p.CiudadId "
            "INNER JOIN dbo.TiposPropiedad t ON t.TipoId = p.TipoId "
            "WHERE c.Nombre = N'Cusco' AND t.Codigo = N'terreno'"
        )
        if (cur.fetchone() or [0])[0] >= 4:
            cur.close()
            return

        cur.execute("SELECT TOP 1 UsuarioId FROM dbo.Usuarios ORDER BY UsuarioId")
        uid_row = cur.fetchone()
        if not uid_row:
            cur.close()
            return
        uid = uid_row[0]

        cur.execute("SELECT TipoId FROM dbo.TiposPropiedad WHERE Codigo = N'terreno'")
        tipo_row = cur.fetchone()
        if not tipo_row:
            cur.close()
            return
        tipo_id = tipo_row[0]

        cur.execute("SELECT CiudadId FROM dbo.Ciudades WHERE Nombre = N'Cusco'")
        ciudad_row = cur.fetchone()
        if not ciudad_row:
            cur.close()
            return
        ciudad_id = ciudad_row[0]

        for titulo, direccion, distrito, precio, moneda, area, lat, lng in lotes:
            cur.execute(
                "SELECT 1 FROM dbo.Propiedades WHERE Titulo = ?",
                (titulo,),
            )
            if cur.fetchone():
                continue
            cur.execute(
                """
                INSERT INTO dbo.Propiedades (
                    UsuarioId, TipoId, CiudadId, Operacion, Titulo, Descripcion,
                    Direccion, Distrito, Precio, Moneda, AreaTotal, Latitud, Longitud, Destacada
                ) VALUES (?, ?, ?, N'venta', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """,
                (
                    uid,
                    tipo_id,
                    ciudad_id,
                    titulo,
                    f"Lote en {distrito}, Cusco. Ideal para proyecto inmobiliario.",
                    direccion,
                    distrito,
                    precio,
                    moneda,
                    area,
                    lat,
                    lng,
                ),
            )
        cur.close()
    finally:
        conn.close()


def actualizar_password_demo(cs: str) -> None:
    conn = pyodbc.connect(cs, autocommit=True)
    try:
        cur = conn.cursor()
        ph = generate_password_hash(DEMO_PASSWORD)
        cur.execute(
            "UPDATE dbo.Usuarios SET PasswordHash = ? WHERE Email = ?",
            (ph, DEMO_EMAIL),
        )
        cur.close()
    finally:
        conn.close()


def main() -> int:
    app = create_app()
    with app.app_context():
        database.ensure_database_exists(app)
    cs = Config.connection_string()
    print(f"-> Aplicando esquema en {Config.DB_SERVER} / {Config.DB_NAME}")
    ejecutar_schema(cs)
    print("-> Migracion columna PoligonoLote")
    migrar_poligono_lote(cs)
    print("-> Migracion columna Estado (publicaciones)")
    migrar_estado_propiedad(cs)
    print("-> Actualizando coordenadas de propiedades demo (Cusco)")
    actualizar_coordenadas_demo(cs)
    print("-> Migracion columnas UTM")
    migrar_utm_coordenadas(cs)
    print("-> Migracion columna PlanMasterplan")
    migrar_plan_masterplan(cs)
    print("-> Migracion listas compartidas")
    migrar_listas_compartidas(cs)
    print("-> Migracion contador vistas listas compartidas")
    migrar_listas_compartidas_vistas(cs)
    print("-> Migracion analytics (vistas diarias y eventos de lote)")
    migrar_analytics(cs)
    print("-> Migracion Google OAuth (Usuarios)")
    migrar_google_oauth(cs)
    print("-> Migracion recuperacion de contrasena")
    migrar_password_reset(cs)
    print("-> Migracion videos de propiedad (YouTube, TikTok, Facebook)")
    migrar_videos_propiedad(cs)
    print("-> Sembrando lotes demo en Cusco")
    sembrar_lotes_cusco(cs)
    print("-> Actualizando password del usuario demo")
    actualizar_password_demo(cs)
    print()
    print("Listo. Puedes iniciar la app con: python app.py")
    print(f"Credenciales demo -> email: {DEMO_EMAIL}  password: {DEMO_PASSWORD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
