# Mi Proximo Hogar

Portal inmobiliario con estetica futurista 2050: tema naranja, fondo 3D animado y UI moderna. Construido con **Python (Flask)** + **SQL Server local** + **HTML/CSS/JS** (Three.js).

## Caracteristicas

- Busqueda avanzada de propiedades (operacion, tipo, ciudad, precio, habitaciones, texto libre).
- Listado paginado con ordenamiento (recientes, precio, destacadas).
- Detalle de propiedad con galeria, especificaciones y formulario de contacto.
- Registro / inicio de sesion (Flask-Login + Werkzeug).
- Publicacion de anuncios con carga de imagenes.
- Favoritos por usuario.
- Directorio de agentes / agencias.
- Filtros por ciudad y categoria con cards interactivas.
- API JSON ligera (`/api/buscar`, `/api/ciudades`, `/api/tipos`).
- Fondo 3D con particulas y poligonos flotantes (Three.js).
- Diseno responsive y accesible.

## Despliegue en Azure (produccion recomendada)

Ver guia completa: **[DEPLOY_AZURE.md](DEPLOY_AZURE.md)**

Resumen:

1. Crear **Azure SQL Database** e importar esquema con `init_db.py` o `sql/schema.sql`.
2. Crear **App Service** (Python 3.11+, Linux).
3. Configurar variables desde `deploy/env.azure.plantilla.txt` (`DB_AZURE=yes`, `DB_ENCRYPT=yes`).
4. Comando de arranque: `bash startup.sh`
5. Completar datos legales (`LEGAL_*`) para politicas de privacidad.

## Despliegue en Hostinger (alternativa MySQL)

Ver guia completa: **[DEPLOY_HOSTINGER.md](DEPLOY_HOSTINGER.md)**

Resumen:

1. Crear base **MySQL** en hPanel (acceso remoto desactivado).
2. Importar `sql/schema_mysql.sql` en phpMyAdmin.
3. Subir el proyecto y crear `.env` con `DB_ENGINE=mysql` y credenciales.
4. Arranque WSGI: `passenger_wsgi.py`.

En local sigues usando SQL Server (`DB_ENGINE=mssql`). En Hostinger usas MySQL.

## Requisitos previos

1. **Python 3.10+** (recomendado 3.11 o 3.12).
2. **SQL Server local** (SQL Server Express, Developer o LocalDB).
3. **ODBC Driver 17 (o 18) for SQL Server** instalado en Windows.
4. **Git** (opcional).

> Si no tienes el ODBC Driver, instalalo desde:
> <https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server>

## Instalacion

### 1. Crear entorno virtual e instalar dependencias

```powershell
cd c:\YOGER\miproximohogar
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

### 2. Configurar variables de entorno

Copia `.env.example` a `.env` y ajusta segun tu instancia de SQL Server:

```powershell
copy .env.example .env
```

Edita `.env`:

```env
SECRET_KEY=alguna-clave-larga-y-aleatoria

# Cambia el servidor segun tu instancia local
DB_DRIVER=ODBC Driver 17 for SQL Server
DB_SERVER=localhost\SQLEXPRESS
DB_NAME=MiProximoHogar
DB_TRUSTED_CONNECTION=yes
```

Si usas autenticacion SQL (no Windows), pon `DB_TRUSTED_CONNECTION=no` y completa `DB_USER` y `DB_PASSWORD`.

> Nombres de servidor comunes:
> - `localhost\SQLEXPRESS` (SQL Express)
> - `(localdb)\MSSQLLocalDB` (LocalDB)
> - `localhost` o `localhost,1433` (instancia por defecto)

### 3. Inicializar la base de datos

Este script crea la base si no existe, aplica el esquema, carga catalogos, propiedades demo e imagenes, y deja el password del usuario demo listo.

```powershell
python init_db.py
```

Al terminar veras las credenciales:

```
Credenciales demo -> email: demo@miproximohogar.pe  password: Demo2050!
```

### 4. Iniciar la aplicacion

```powershell
python app.py
```

Abre <http://127.0.0.1:5000> en tu navegador.

## Estructura del proyecto

```
miproximohogar/
|-- app.py                 # Aplicacion Flask (factory)
|-- config.py              # Configuracion (lee .env)
|-- database.py            # Conexion / helpers SQL Server (pyodbc)
|-- models.py              # Repositorios (Usuario, Propiedad, ...)
|-- forms.py               # Formularios WTForms
|-- init_db.py             # Script de inicializacion / seed
|-- requirements.txt
|-- .env.example
|-- sql/
|   `-- schema.sql         # Esquema + datos demo
|-- routes/
|   |-- main.py            # Home, propiedades, detalle, ciudades, agentes
|   |-- auth.py            # Login, registro, perfil
|   |-- propiedades.py     # Publicar / administrar propiedades
|   `-- api.py             # Endpoints JSON
|-- templates/             # Jinja2 (base, index, detalle, etc.)
|-- static/
|   |-- css/style.css      # Tema 2050 naranja
|   |-- js/three-bg.js     # Fondo 3D
|   |-- js/main.js         # UI
|   `-- uploads/           # Imagenes subidas por usuarios
```

## Credenciales demo

| Email                       | Password   | Rol               |
|-----------------------------|------------|-------------------|
| demo@miproximohogar.pe      | Demo2050!  | Agente (con datos)|

## Endpoints principales

| Ruta                          | Metodo  | Descripcion                              |
|-------------------------------|---------|------------------------------------------|
| `/`                           | GET     | Home con destacadas y categorias         |
| `/propiedades`                | GET     | Listado con filtros y paginacion         |
| `/propiedad/<id>`             | GET/POST| Detalle + formulario de contacto         |
| `/ciudades`                   | GET     | Grid de ciudades                         |
| `/agentes`                    | GET     | Directorio de agentes                    |
| `/favoritos`                  | GET     | Favoritos del usuario (autenticado)      |
| `/cuenta/login`               | GET/POST| Inicio de sesion                         |
| `/cuenta/registro`            | GET/POST| Crear cuenta                             |
| `/cuenta/logout`              | GET     | Cerrar sesion                            |
| `/cuenta/perfil`              | GET     | Panel del usuario                        |
| `/publicar/`                  | GET/POST| Publicar propiedad (autenticado)         |
| `/api/buscar`                 | GET     | JSON con resultados de busqueda          |
| `/api/ciudades` / `/api/tipos`| GET     | Catalogos JSON                           |

## Personalizacion

- **Tema:** edita las variables `--c-*` en `static/css/style.css`.
- **Fondo 3D:** cantidad de particulas/poligonos en `static/js/three-bg.js`.
- **Limites de subida:** `MAX_CONTENT_LENGTH` en `.env`.
- **Items por pagina:** `ITEMS_PER_PAGE` en `config.py` (y `por_pagina=12` en rutas).

## Problemas comunes

**"No se pudo conectar a SQL Server"**
- Verifica que el servicio SQL Server este corriendo (`services.msc`).
- Habilita TCP/IP en SQL Server Configuration Manager.
- Confirma el nombre exacto del servidor (`localhost\SQLEXPRESS` vs `(localdb)\MSSQLLocalDB`).

**"Cant open lib 'ODBC Driver 17 for SQL Server'"**
- Instala el driver desde Microsoft o cambia `DB_DRIVER` a la version instalada (por ejemplo `ODBC Driver 18 for SQL Server`).

**Las imagenes del seed no cargan**
- Las URLs usan `picsum.photos` y `unsplash.com`. Necesitas conexion a internet.

**Pyodbc no instala en Windows**
- Asegurate de tener "Microsoft Visual C++ Build Tools" o instala una rueda precompilada: `pip install pyodbc==5.1.0`.

## Licencia

Codigo creado para uso del proyecto Mi Proximo Hogar. Reemplaza imagenes de stock con tus propias fotos antes de produccion.
