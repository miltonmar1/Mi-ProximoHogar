-- =============================================================================
-- MI PROXIMO HOGAR — BASE MYSQL PARA HOSTINGER
-- Dominio: miproximohogar.org
-- =============================================================================
-- COMO IMPORTAR:
--   1. hPanel > Bases de datos > MySQL > Crear base + usuario
--   2. hPanel > phpMyAdmin > selecciona TU base
--   3. Pestaña "Importar" > elegir este archivo > Ejecutar
-- =============================================================================
-- NO actives "Acceso remoto MySQL" en Hostinger (mas seguro).
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Limpieza opcional (solo si reimportas desde cero; comenta si ya tienes datos)
-- DROP TABLE IF EXISTS ListasCompartidasPropiedades;
-- DROP TABLE IF EXISTS ListasCompartidas;
-- DROP TABLE IF EXISTS LoteEventos;
-- DROP TABLE IF EXISTS PropiedadVistasDiarias;
-- DROP TABLE IF EXISTS PasswordResetTokens;
-- DROP TABLE IF EXISTS Contactos;
-- DROP TABLE IF EXISTS Favoritos;
-- DROP TABLE IF EXISTS VideosPropiedad;
-- DROP TABLE IF EXISTS ImagenesPropiedad;
-- DROP TABLE IF EXISTS Propiedades;
-- DROP TABLE IF EXISTS TiposPropiedad;
-- DROP TABLE IF EXISTS Ciudades;
-- DROP TABLE IF EXISTS Usuarios;

CREATE TABLE IF NOT EXISTS Usuarios (
    UsuarioId       INT AUTO_INCREMENT PRIMARY KEY,
    NombreCompleto  VARCHAR(120) NOT NULL,
    Email           VARCHAR(200) NOT NULL UNIQUE,
    Telefono        VARCHAR(30) NULL,
    PasswordHash    VARCHAR(300) NOT NULL,
    EsAgente        TINYINT(1) NOT NULL DEFAULT 0,
    FotoUrl         VARCHAR(300) NULL,
    Biografia       VARCHAR(1000) NULL,
    GoogleId        VARCHAR(128) NULL,
    OAuthProvider   VARCHAR(20) NULL,
    FechaRegistro   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Activo          TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY UX_Usuarios_GoogleId (GoogleId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Ciudades (
    CiudadId    INT AUTO_INCREMENT PRIMARY KEY,
    Nombre      VARCHAR(80) NOT NULL UNIQUE,
    Region      VARCHAR(80) NOT NULL,
    ImagenUrl   VARCHAR(300) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TiposPropiedad (
    TipoId   INT AUTO_INCREMENT PRIMARY KEY,
    Codigo   VARCHAR(40) NOT NULL UNIQUE,
    Nombre   VARCHAR(80) NOT NULL,
    Icono    VARCHAR(40) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Propiedades (
    PropiedadId      INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioId        INT NOT NULL,
    TipoId           INT NOT NULL,
    CiudadId         INT NOT NULL,
    Operacion        VARCHAR(20) NOT NULL,
    Titulo           VARCHAR(200) NOT NULL,
    Descripcion      MEDIUMTEXT NULL,
    Direccion        VARCHAR(250) NULL,
    Distrito         VARCHAR(120) NULL,
    Precio           DECIMAL(14,2) NOT NULL,
    Moneda           VARCHAR(8) NOT NULL DEFAULT 'PEN',
    AreaTotal        DECIMAL(10,2) NULL,
    AreaConstruida   DECIMAL(10,2) NULL,
    Habitaciones     INT NULL,
    Banos            INT NULL,
    Cocheras         INT NULL,
    Latitud          DECIMAL(10,7) NULL,
    Longitud         DECIMAL(10,7) NULL,
    PoligonoLote     MEDIUMTEXT NULL,
    PlanMasterplan   MEDIUMTEXT NULL,
    UtmZona          VARCHAR(8) NULL,
    UtmEste          DECIMAL(14,3) NULL,
    UtmNorte         DECIMAL(14,3) NULL,
    AreaMapaM2       DECIMAL(14,2) NULL,
    UtmVertices      MEDIUMTEXT NULL,
    Destacada        TINYINT(1) NOT NULL DEFAULT 0,
    Estado           VARCHAR(20) NOT NULL DEFAULT 'activo',
    FechaCreacion    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Vistas           INT NOT NULL DEFAULT 0,
    INDEX IX_Propiedades_Filtros (Operacion, TipoId, CiudadId, Estado),
    CONSTRAINT FK_Prop_Usuario FOREIGN KEY (UsuarioId) REFERENCES Usuarios(UsuarioId),
    CONSTRAINT FK_Prop_Tipo FOREIGN KEY (TipoId) REFERENCES TiposPropiedad(TipoId),
    CONSTRAINT FK_Prop_Ciudad FOREIGN KEY (CiudadId) REFERENCES Ciudades(CiudadId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ImagenesPropiedad (
    ImagenId      INT AUTO_INCREMENT PRIMARY KEY,
    PropiedadId   INT NOT NULL,
    Url           VARCHAR(400) NOT NULL,
    EsPrincipal   TINYINT(1) NOT NULL DEFAULT 0,
    Orden         INT NOT NULL DEFAULT 0,
    CONSTRAINT FK_Img_Prop FOREIGN KEY (PropiedadId) REFERENCES Propiedades(PropiedadId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS VideosPropiedad (
    VideoId       INT AUTO_INCREMENT PRIMARY KEY,
    PropiedadId   INT NOT NULL,
    UrlOriginal   VARCHAR(500) NOT NULL,
    Plataforma    VARCHAR(20) NOT NULL,
    UrlEmbed      VARCHAR(700) NOT NULL,
    Orden         INT NOT NULL DEFAULT 0,
    CONSTRAINT FK_Vid_Prop FOREIGN KEY (PropiedadId) REFERENCES Propiedades(PropiedadId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Favoritos (
    UsuarioId     INT NOT NULL,
    PropiedadId   INT NOT NULL,
    FechaAgregado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (UsuarioId, PropiedadId),
    CONSTRAINT FK_Fav_User FOREIGN KEY (UsuarioId) REFERENCES Usuarios(UsuarioId),
    CONSTRAINT FK_Fav_Prop FOREIGN KEY (PropiedadId) REFERENCES Propiedades(PropiedadId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Contactos (
    ContactoId    INT AUTO_INCREMENT PRIMARY KEY,
    PropiedadId   INT NOT NULL,
    Nombre        VARCHAR(120) NOT NULL,
    Email         VARCHAR(200) NOT NULL,
    Telefono      VARCHAR(30) NULL,
    Mensaje       VARCHAR(2000) NOT NULL,
    FechaEnvio    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT FK_Contacto_Prop FOREIGN KEY (PropiedadId) REFERENCES Propiedades(PropiedadId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS PropiedadVistasDiarias (
    VistaDiariaId  INT AUTO_INCREMENT PRIMARY KEY,
    PropiedadId    INT NOT NULL,
    Fecha          DATE NOT NULL,
    TotalVistas    INT NOT NULL DEFAULT 0,
    UNIQUE KEY UQ_PropiedadVistasDiarias (PropiedadId, Fecha),
    INDEX IX_PropiedadVistasDiarias_Fecha (Fecha),
    CONSTRAINT FK_Vistas_Prop FOREIGN KEY (PropiedadId) REFERENCES Propiedades(PropiedadId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS LoteEventos (
    EventoId      INT AUTO_INCREMENT PRIMARY KEY,
    PropiedadId   INT NOT NULL,
    LoteRef       VARCHAR(80) NOT NULL,
    TipoEvento    VARCHAR(30) NOT NULL DEFAULT 'view',
    SessionId     VARCHAR(64) NULL,
    UsuarioId     INT NULL,
    FechaHora     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX IX_LoteEventos_Propiedad (PropiedadId, FechaHora),
    INDEX IX_LoteEventos_Lote (PropiedadId, LoteRef),
    CONSTRAINT FK_LoteEv_Prop FOREIGN KEY (PropiedadId) REFERENCES Propiedades(PropiedadId) ON DELETE CASCADE,
    CONSTRAINT FK_LoteEv_User FOREIGN KEY (UsuarioId) REFERENCES Usuarios(UsuarioId) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS PasswordResetTokens (
    TokenId          INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioId        INT NOT NULL,
    TokenHash        VARCHAR(128) NOT NULL,
    FechaCreacion    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FechaExpiracion  DATETIME NOT NULL,
    Usado            TINYINT(1) NOT NULL DEFAULT 0,
    INDEX IX_PasswordResetTokens_Hash (TokenHash),
    CONSTRAINT FK_Reset_User FOREIGN KEY (UsuarioId) REFERENCES Usuarios(UsuarioId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ListasCompartidas (
    ListaId         INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioId       INT NOT NULL,
    Token           VARCHAR(80) NOT NULL UNIQUE,
    Titulo          VARCHAR(200) NOT NULL,
    FechaCreacion   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Activa          TINYINT(1) NOT NULL DEFAULT 1,
    Vistas          INT NOT NULL DEFAULT 0,
    CONSTRAINT FK_Lista_User FOREIGN KEY (UsuarioId) REFERENCES Usuarios(UsuarioId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ListasCompartidasPropiedades (
    ListaId       INT NOT NULL,
    PropiedadId   INT NOT NULL,
    PRIMARY KEY (ListaId, PropiedadId),
    CONSTRAINT FK_LP_Lista FOREIGN KEY (ListaId) REFERENCES ListasCompartidas(ListaId) ON DELETE CASCADE,
    CONSTRAINT FK_LP_Prop FOREIGN KEY (PropiedadId) REFERENCES Propiedades(PropiedadId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- Datos maestros
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO TiposPropiedad (Codigo, Nombre, Icono) VALUES
    ('departamento', 'Departamento', 'building'),
    ('casa', 'Casa', 'home'),
    ('terreno', 'Terreno / Lote', 'map'),
    ('local', 'Local Comercial', 'store'),
    ('industrial', 'Local Industrial', 'factory'),
    ('oficina', 'Oficina', 'briefcase');

INSERT IGNORE INTO Ciudades (Nombre, Region, ImagenUrl) VALUES
    ('Lima', 'Lima', 'https://images.unsplash.com/photo-1531968455001-5c5272a41129?w=800'),
    ('Arequipa', 'Arequipa', 'https://images.unsplash.com/photo-1526392060635-9d6019884377?w=800'),
    ('Trujillo', 'La Libertad', 'https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?w=800'),
    ('Huancayo', 'Junin', 'https://images.unsplash.com/photo-1542401886-65d6c61db217?w=800'),
    ('Cusco', 'Cusco', 'https://images.unsplash.com/photo-1526392060635-9d6019884377?w=800'),
    ('Piura', 'Piura', 'https://images.unsplash.com/photo-1519121785383-3229633bb75b?w=800'),
    ('Chiclayo', 'Lambayeque', 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800'),
    ('Iquitos', 'Loreto', 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800');

-- -----------------------------------------------------------------------------
-- Usuario demo (para probar el sitio)
-- Email: demo@miproximohogar.pe
-- Password: Demo2050!
-- -----------------------------------------------------------------------------
INSERT INTO Usuarios (NombreCompleto, Email, Telefono, PasswordHash, EsAgente, Biografia)
SELECT 'Agencia Demo 2050', 'demo@miproximohogar.pe', '+51 999 000 111',
       'scrypt:32768:8:1$iZYqc3JNImitLr66$491ccdfd65556a0af09791af7a5a166970727499b782b2c8ff58cb403d3affffe278e4a7469e9d9f547ece68be7b283894a152c1fdd1877b799a98de358b895c',
       1, 'Cuenta de demostracion Mi Proximo Hogar.'
WHERE NOT EXISTS (SELECT 1 FROM Usuarios WHERE Email = 'demo@miproximohogar.pe');

-- -----------------------------------------------------------------------------
-- Propiedades demo (solo si la tabla esta vacia)
-- -----------------------------------------------------------------------------
INSERT INTO Propiedades (
    UsuarioId, TipoId, CiudadId, Operacion, Titulo, Descripcion, Direccion, Distrito,
    Precio, Moneda, AreaTotal, AreaConstruida, Habitaciones, Banos, Cocheras, Destacada,
    Latitud, Longitud
)
SELECT u.UsuarioId, t.TipoId, c.CiudadId, d.Operacion, d.Titulo, d.Descripcion, d.Direccion, d.Distrito,
       d.Precio, d.Moneda, d.AreaTotal, d.AreaConstruida, d.Habitaciones, d.Banos, d.Cocheras, d.Destacada,
       d.Latitud, d.Longitud
FROM (
    SELECT 'demo@miproximohogar.pe' AS Email
) x
JOIN Usuarios u ON u.Email = x.Email
JOIN (
    SELECT 'departamento' AS Codigo, 'venta' AS Operacion,
           'Departamento moderno con vista al mar' AS Titulo,
           'Departamento de 3 dormitorios totalmente amoblado, con balcon panoramico y acabados premium.' AS Descripcion,
           'Av. del Ejercito 1500' AS Direccion, 'Miraflores' AS Distrito,
           285000 AS Precio, 'USD' AS Moneda, 120 AS AreaTotal, 110 AS AreaConstruida,
           3 AS Habitaciones, 2 AS Banos, 1 AS Cocheras, 1 AS Destacada,
           -12.1191000 AS Latitud, -77.0282000 AS Longitud
    UNION ALL SELECT 'casa', 'venta', 'Casa de campo con piscina',
           'Casa amplia en zona residencial, jardin con piscina, parrilla y 4 habitaciones.',
           'Calle Las Begonias 234', 'Cayma', 320000, 'USD', 400, 280, 4, 3, 2, 1,
           -16.4090000, -71.5375000
    UNION ALL SELECT 'departamento', 'alquiler', 'Depa minimalista en San Isidro',
           'Departamento 2 dormitorios, edificio nuevo con gym y rooftop.',
           'Av. Camino Real 800', 'San Isidro', 4500, 'PEN', 90, 85, 2, 2, 1, 0,
           -12.0989000, -77.0365000
    UNION ALL SELECT 'terreno', 'venta', 'Terreno en expansion urbana',
           'Lote rectangular listo para construir, servicios al frente.',
           'Av. Mariategui', 'El Tambo', 95000, 'USD', 250, NULL, NULL, NULL, NULL, 0,
           -12.0667000, -75.2167000
    UNION ALL SELECT 'casa', 'venta', 'Casa familiar amplia en California',
           'Hermosa casa de 2 pisos, sala-comedor, cocina con isla y cochera doble.',
           'Av. Larco 1200', 'Victor Larco', 175000, 'USD', 180, 160, 4, 3, 2, 1,
           -8.1116000, -79.0288000
    UNION ALL SELECT 'terreno', 'venta', 'Lote residencial San Blas Cusco',
           'Terreno en zona historica, ideal para proyecto boutique.',
           'Calle Carmen Alto 120', 'San Blas', 85000, 'USD', 180, NULL, NULL, NULL, NULL, 1,
           -13.5145000, -71.9758000
    UNION ALL SELECT 'terreno', 'venta', 'Terreno comercial Wanchaq',
           'Lote comercial cerca a Av. El Sol.',
           'Av. El Sol 890', 'Wanchaq', 120000, 'USD', 220, NULL, NULL, NULL, NULL, 0,
           -13.5250000, -71.9672000
    UNION ALL SELECT 'oficina', 'alquiler', 'Oficina coworking en centro historico',
           'Oficina lista para usar, escritorios, internet fibra y sala de reuniones.',
           'Calle Plateros 250', 'Cusco', 2200, 'PEN', 60, 60, NULL, 1, NULL, 0,
           -13.5164000, -71.9785000
) d
JOIN TiposPropiedad t ON t.Codigo = d.Codigo
JOIN Ciudades c ON (
    (d.Distrito IN ('Miraflores', 'San Isidro') AND c.Nombre = 'Lima')
    OR (d.Distrito = 'Cayma' AND c.Nombre = 'Arequipa')
    OR (d.Distrito = 'El Tambo' AND c.Nombre = 'Huancayo')
    OR (d.Distrito = 'Victor Larco' AND c.Nombre = 'Trujillo')
    OR (d.Distrito IN ('San Blas', 'Wanchaq', 'Cusco') AND c.Nombre = 'Cusco')
)
WHERE NOT EXISTS (SELECT 1 FROM Propiedades LIMIT 1);

-- Imagenes demo para cada propiedad
INSERT INTO ImagenesPropiedad (PropiedadId, Url, EsPrincipal, Orden)
SELECT p.PropiedadId,
       CONCAT('https://picsum.photos/seed/mph', p.PropiedadId * 7, '/1200/800'),
       1, 0
FROM Propiedades p
WHERE NOT EXISTS (
    SELECT 1 FROM ImagenesPropiedad i WHERE i.PropiedadId = p.PropiedadId
);

-- =============================================================================
-- FIN — Base lista para miproximohogar.org
-- =============================================================================
