-- Esquema y datos demo de Mi Proximo Hogar
-- Compatible con SQL Server 2017+ / SQL Server Express
-- Ejecutar este script con la base de datos MiProximoHogar ya creada

SET NOCOUNT ON;

-------------------------------------------------------------------------------
-- Tablas
-------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Usuarios')
BEGIN
    CREATE TABLE dbo.Usuarios (
        UsuarioId       INT IDENTITY(1,1) PRIMARY KEY,
        NombreCompleto  NVARCHAR(120) NOT NULL,
        Email           NVARCHAR(200) NOT NULL UNIQUE,
        Telefono        NVARCHAR(30) NULL,
        PasswordHash    NVARCHAR(300) NOT NULL,
        EsAgente        BIT NOT NULL DEFAULT 0,
        FotoUrl         NVARCHAR(300) NULL,
        Biografia       NVARCHAR(1000) NULL,
        FechaRegistro   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        Activo          BIT NOT NULL DEFAULT 1
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Ciudades')
BEGIN
    CREATE TABLE dbo.Ciudades (
        CiudadId    INT IDENTITY(1,1) PRIMARY KEY,
        Nombre      NVARCHAR(80) NOT NULL UNIQUE,
        Region      NVARCHAR(80) NOT NULL,
        ImagenUrl   NVARCHAR(300) NULL
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TiposPropiedad')
BEGIN
    CREATE TABLE dbo.TiposPropiedad (
        TipoId   INT IDENTITY(1,1) PRIMARY KEY,
        Codigo   NVARCHAR(40) NOT NULL UNIQUE,
        Nombre   NVARCHAR(80) NOT NULL,
        Icono    NVARCHAR(40) NULL
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Propiedades')
BEGIN
    CREATE TABLE dbo.Propiedades (
        PropiedadId      INT IDENTITY(1,1) PRIMARY KEY,
        UsuarioId        INT NOT NULL REFERENCES dbo.Usuarios(UsuarioId),
        TipoId           INT NOT NULL REFERENCES dbo.TiposPropiedad(TipoId),
        CiudadId         INT NOT NULL REFERENCES dbo.Ciudades(CiudadId),
        Operacion        NVARCHAR(20) NOT NULL,           -- venta / alquiler
        Titulo           NVARCHAR(200) NOT NULL,
        Descripcion      NVARCHAR(MAX) NULL,
        Direccion        NVARCHAR(250) NULL,
        Distrito         NVARCHAR(120) NULL,
        Precio           DECIMAL(14,2) NOT NULL,
        Moneda           NVARCHAR(8) NOT NULL DEFAULT 'PEN',
        AreaTotal        DECIMAL(10,2) NULL,
        AreaConstruida   DECIMAL(10,2) NULL,
        Habitaciones     INT NULL,
        Banos            INT NULL,
        Cocheras         INT NULL,
        Latitud          DECIMAL(10,7) NULL,
        Longitud         DECIMAL(10,7) NULL,
        PoligonoLote     NVARCHAR(MAX) NULL,
        Destacada        BIT NOT NULL DEFAULT 0,
        Estado           NVARCHAR(20) NOT NULL DEFAULT 'activo',
        FechaCreacion    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        Vistas           INT NOT NULL DEFAULT 0
    );
    CREATE INDEX IX_Propiedades_Filtros ON dbo.Propiedades (Operacion, TipoId, CiudadId, Estado);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ImagenesPropiedad')
BEGIN
    CREATE TABLE dbo.ImagenesPropiedad (
        ImagenId      INT IDENTITY(1,1) PRIMARY KEY,
        PropiedadId   INT NOT NULL REFERENCES dbo.Propiedades(PropiedadId) ON DELETE CASCADE,
        Url           NVARCHAR(400) NOT NULL,
        EsPrincipal   BIT NOT NULL DEFAULT 0,
        Orden         INT NOT NULL DEFAULT 0
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'VideosPropiedad')
BEGIN
    CREATE TABLE dbo.VideosPropiedad (
        VideoId       INT IDENTITY(1,1) PRIMARY KEY,
        PropiedadId   INT NOT NULL REFERENCES dbo.Propiedades(PropiedadId) ON DELETE CASCADE,
        UrlOriginal   NVARCHAR(500) NOT NULL,
        Plataforma    NVARCHAR(20) NOT NULL,
        UrlEmbed      NVARCHAR(700) NOT NULL,
        Orden         INT NOT NULL DEFAULT 0
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Favoritos')
BEGIN
    CREATE TABLE dbo.Favoritos (
        UsuarioId     INT NOT NULL REFERENCES dbo.Usuarios(UsuarioId),
        PropiedadId   INT NOT NULL REFERENCES dbo.Propiedades(PropiedadId) ON DELETE CASCADE,
        FechaAgregado DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Favoritos PRIMARY KEY (UsuarioId, PropiedadId)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Contactos')
BEGIN
    CREATE TABLE dbo.Contactos (
        ContactoId    INT IDENTITY(1,1) PRIMARY KEY,
        PropiedadId   INT NOT NULL REFERENCES dbo.Propiedades(PropiedadId) ON DELETE CASCADE,
        Nombre        NVARCHAR(120) NOT NULL,
        Email         NVARCHAR(200) NOT NULL,
        Telefono      NVARCHAR(30) NULL,
        Mensaje       NVARCHAR(2000) NOT NULL,
        FechaEnvio    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PropiedadVistasDiarias')
BEGIN
    CREATE TABLE dbo.PropiedadVistasDiarias (
        VistaDiariaId  INT IDENTITY(1,1) PRIMARY KEY,
        PropiedadId    INT NOT NULL REFERENCES dbo.Propiedades(PropiedadId) ON DELETE CASCADE,
        Fecha          DATE NOT NULL,
        TotalVistas    INT NOT NULL DEFAULT 0,
        CONSTRAINT UQ_PropiedadVistasDiarias UNIQUE (PropiedadId, Fecha)
    );
    CREATE INDEX IX_PropiedadVistasDiarias_Fecha ON dbo.PropiedadVistasDiarias(Fecha);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'LoteEventos')
BEGIN
    CREATE TABLE dbo.LoteEventos (
        EventoId      INT IDENTITY(1,1) PRIMARY KEY,
        PropiedadId   INT NOT NULL REFERENCES dbo.Propiedades(PropiedadId) ON DELETE CASCADE,
        LoteRef       NVARCHAR(80) NOT NULL,
        TipoEvento    NVARCHAR(30) NOT NULL DEFAULT N'view',
        SessionId     NVARCHAR(64) NULL,
        UsuarioId     INT NULL REFERENCES dbo.Usuarios(UsuarioId) ON DELETE SET NULL,
        FechaHora     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_LoteEventos_Propiedad ON dbo.LoteEventos(PropiedadId, FechaHora);
    CREATE INDEX IX_LoteEventos_Lote ON dbo.LoteEventos(PropiedadId, LoteRef);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PasswordResetTokens')
BEGIN
    CREATE TABLE dbo.PasswordResetTokens (
        TokenId          INT IDENTITY(1,1) PRIMARY KEY,
        UsuarioId        INT NOT NULL REFERENCES dbo.Usuarios(UsuarioId) ON DELETE CASCADE,
        TokenHash        NVARCHAR(128) NOT NULL,
        FechaCreacion    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        FechaExpiracion  DATETIME2 NOT NULL,
        Usado            BIT NOT NULL DEFAULT 0
    );
    CREATE INDEX IX_PasswordResetTokens_Hash ON dbo.PasswordResetTokens(TokenHash);
END;
GO

-------------------------------------------------------------------------------
-- Datos maestros
-------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM dbo.TiposPropiedad)
BEGIN
    INSERT INTO dbo.TiposPropiedad (Codigo, Nombre, Icono) VALUES
        ('departamento', N'Departamento', 'building'),
        ('casa',         N'Casa',         'home'),
        ('terreno',      N'Terreno / Lote', 'map'),
        ('local',        N'Local Comercial', 'store'),
        ('industrial',   N'Local Industrial', 'factory'),
        ('oficina',      N'Oficina', 'briefcase');
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Ciudades)
BEGIN
    INSERT INTO dbo.Ciudades (Nombre, Region, ImagenUrl) VALUES
        (N'Lima',      N'Lima',     N'https://images.unsplash.com/photo-1531968455001-5c5272a41129?w=800'),
        (N'Arequipa',  N'Arequipa', N'https://images.unsplash.com/photo-1526392060635-9d6019884377?w=800'),
        (N'Trujillo',  N'La Libertad', N'https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?w=800'),
        (N'Huancayo',  N'Junin',    N'https://images.unsplash.com/photo-1542401886-65d6c61db217?w=800'),
        (N'Cusco',     N'Cusco',    N'https://images.unsplash.com/photo-1526392060635-9d6019884377?w=800'),
        (N'Piura',     N'Piura',    N'https://images.unsplash.com/photo-1519121785383-3229633bb75b?w=800'),
        (N'Chiclayo',  N'Lambayeque', N'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800'),
        (N'Iquitos',   N'Loreto',   N'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800');
END;
GO

-------------------------------------------------------------------------------
-- Usuario y propiedades demo (solo si no existen)
-------------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM dbo.Usuarios WHERE Email = 'demo@miproximohogar.pe')
BEGIN
    -- Hash generado con werkzeug.security para password: Demo2050!
    INSERT INTO dbo.Usuarios (NombreCompleto, Email, Telefono, PasswordHash, EsAgente, Biografia)
    VALUES (
        N'Agencia Demo 2050',
        N'demo@miproximohogar.pe',
        N'+51 999 000 111',
        N'scrypt:32768:8:1$placeholder$placeholder',
        1,
        N'Agencia inmobiliaria de demostracion. El password se regenera al crear datos via app.'
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Propiedades)
BEGIN
    DECLARE @uid INT = (SELECT TOP 1 UsuarioId FROM dbo.Usuarios ORDER BY UsuarioId);
    DECLARE @t_depa INT = (SELECT TipoId FROM dbo.TiposPropiedad WHERE Codigo = 'departamento');
    DECLARE @t_casa INT = (SELECT TipoId FROM dbo.TiposPropiedad WHERE Codigo = 'casa');
    DECLARE @t_terr INT = (SELECT TipoId FROM dbo.TiposPropiedad WHERE Codigo = 'terreno');
    DECLARE @t_loc  INT = (SELECT TipoId FROM dbo.TiposPropiedad WHERE Codigo = 'local');
    DECLARE @t_ofi  INT = (SELECT TipoId FROM dbo.TiposPropiedad WHERE Codigo = 'oficina');

    DECLARE @c_lim INT = (SELECT CiudadId FROM dbo.Ciudades WHERE Nombre = N'Lima');
    DECLARE @c_arq INT = (SELECT CiudadId FROM dbo.Ciudades WHERE Nombre = N'Arequipa');
    DECLARE @c_tru INT = (SELECT CiudadId FROM dbo.Ciudades WHERE Nombre = N'Trujillo');
    DECLARE @c_hua INT = (SELECT CiudadId FROM dbo.Ciudades WHERE Nombre = N'Huancayo');
    DECLARE @c_cus INT = (SELECT CiudadId FROM dbo.Ciudades WHERE Nombre = N'Cusco');

    INSERT INTO dbo.Propiedades (UsuarioId, TipoId, CiudadId, Operacion, Titulo, Descripcion, Direccion, Distrito, Precio, Moneda, AreaTotal, AreaConstruida, Habitaciones, Banos, Cocheras, Destacada)
    VALUES
        (@uid, @t_depa, @c_lim, N'venta',    N'Departamento moderno con vista al mar', N'Departamento de 3 dormitorios totalmente amoblado, con balcon panoramico y acabados premium.', N'Av. del Ejercito 1500', N'Miraflores', 285000, 'USD', 120, 110, 3, 2, 1, 1),
        (@uid, @t_casa, @c_arq, N'venta',    N'Casa de campo con piscina', N'Casa amplia en zona residencial, jardin con piscina, parrilla y 4 habitaciones.', N'Calle Las Begonias 234', N'Cayma', 320000, 'USD', 400, 280, 4, 3, 2, 1),
        (@uid, @t_depa, @c_lim, N'alquiler', N'Depa minimalista en San Isidro',     N'Departamento 2 dormitorios, edificio nuevo con gym y rooftop.', N'Av. Camino Real 800', N'San Isidro', 4500, 'PEN', 90, 85, 2, 2, 1, 0),
        (@uid, @t_terr, @c_hua, N'venta',    N'Terreno en expansion urbana',         N'Lote rectangular listo para construir, servicios al frente.', N'Av. Mariategui', N'El Tambo', 95000, 'USD', 250, NULL, NULL, NULL, NULL, 0),
        (@uid, @t_casa, @c_tru, N'venta',    N'Casa familiar amplia en California',  N'Hermosa casa de 2 pisos, sala-comedor, cocina con isla y cochera doble.', N'Av. Larco 1200', N'Victor Larco', 175000, 'USD', 180, 160, 4, 3, 2, 1),
        (@uid, @t_loc,  @c_lim, N'alquiler', N'Local comercial a pie de avenida',    N'Local a la calle ideal para retail, alta visibilidad y transito.', N'Av. Arequipa 3500', N'Lince', 8500, 'PEN', 120, 110, NULL, 1, NULL, 0),
        (@uid, @t_ofi,  @c_cus, N'alquiler', N'Oficina coworking en centro historico', N'Oficina lista para usar, escritorios, internet fibra y sala de reuniones.', N'Calle Plateros 250', N'Cusco', 2200, 'PEN', 60, 60, NULL, 1, NULL, 0),
        (@uid, @t_depa, @c_cus, N'venta',    N'Loft contemporaneo cerca a la plaza', N'Loft de 1 ambiente con diseño moderno y excelente iluminacion natural.', N'Calle Saphi 450', N'Cusco', 110000, 'USD', 55, 55, 1, 1, NULL, 1);

    -- Imagenes demo
    DECLARE @pid INT;
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT PropiedadId FROM dbo.Propiedades;
    OPEN cur; FETCH NEXT FROM cur INTO @pid;
    DECLARE @i INT = 0;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @baseSeed INT = @pid * 7;
        INSERT INTO dbo.ImagenesPropiedad (PropiedadId, Url, EsPrincipal, Orden) VALUES
            (@pid, CONCAT('https://picsum.photos/seed/mph', @baseSeed,     '/1200/800'), 1, 0),
            (@pid, CONCAT('https://picsum.photos/seed/mph', @baseSeed + 1, '/1200/800'), 0, 1),
            (@pid, CONCAT('https://picsum.photos/seed/mph', @baseSeed + 2, '/1200/800'), 0, 2);
        FETCH NEXT FROM cur INTO @pid;
    END
    CLOSE cur; DEALLOCATE cur;
END;
GO
