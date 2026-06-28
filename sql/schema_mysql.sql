-- Mi Proximo Hogar — esquema MySQL para Hostinger
-- Importar desde phpMyAdmin o: mysql -u usuario -p nombre_bd < sql/schema_mysql.sql

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

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
    FechaRegistro   DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
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
    FechaCreacion    DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
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
    FechaAgregado DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
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
    FechaEnvio    DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
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
    FechaHora     DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
    INDEX IX_LoteEventos_Propiedad (PropiedadId, FechaHora),
    INDEX IX_LoteEventos_Lote (PropiedadId, LoteRef),
    CONSTRAINT FK_LoteEv_Prop FOREIGN KEY (PropiedadId) REFERENCES Propiedades(PropiedadId) ON DELETE CASCADE,
    CONSTRAINT FK_LoteEv_User FOREIGN KEY (UsuarioId) REFERENCES Usuarios(UsuarioId) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS PasswordResetTokens (
    TokenId          INT AUTO_INCREMENT PRIMARY KEY,
    UsuarioId        INT NOT NULL,
    TokenHash        VARCHAR(128) NOT NULL,
    FechaCreacion    DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
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
    FechaCreacion   DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
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

-- Datos maestros
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
