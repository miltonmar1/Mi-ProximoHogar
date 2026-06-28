# Despliegue en Hostinger — Mi Proximo Hogar

Guia paso a paso para publicar el portal con **MySQL** de forma segura.

---

## 1. Requisitos en Hostinger

- Plan con **Python** (Business o Cloud recomendado).
- Dominio apuntando al hosting (SSL/HTTPS activo).
- Base de datos **MySQL** creada en hPanel.

---

## 2. Crear la base MySQL (hPanel)

1. Entra a **hPanel** → **Bases de datos** → **MySQL**.
2. Crea una base nueva, por ejemplo: `u123456789_miph`.
3. Crea un usuario con contraseña **fuerte** (solo letras, numeros y simbolos).
4. Asigna el usuario a la base con **todos los privilegios**.

### Seguridad de la base (importante)

| Medida | Que hacer |
|--------|-----------|
| Acceso remoto | **Desactivado** — en Hostinger el host es `localhost`; nadie desde internet puede conectarse directo a MySQL si no habilitas "Acceso remoto". |
| Usuario dedicado | No uses el usuario `root`. Usa el usuario que crea Hostinger (`u123456789_...`). |
| Contraseña | Minimo 16 caracteres, unica, no reutilizada. |
| Credenciales | Solo en archivo `.env`, nunca en codigo ni en Git. |

---

## 3. Importar el esquema SQL

**Opcion A — phpMyAdmin (recomendada)**

1. hPanel → **phpMyAdmin** → selecciona tu base.
2. Pestaña **Importar**.
3. Sube el archivo: `sql/schema_mysql.sql` del proyecto.
4. Ejecutar.

**Opcion B — Script Python (SSH)**

```bash
cd ~/domains/tudominio.pe/public_html
python3 init_db_hostinger.py
```

(Antes configura `.env` con `DB_ENGINE=mysql` y credenciales MySQL.)

---

## 4. Subir archivos del proyecto

Sube por **FTP** o **Administrador de archivos** todo el proyecto a `public_html` (o la carpeta que indique el panel Python), **excepto**:

- `venv/`
- `__pycache__/`
- `.env` (lo creas directo en el servidor)
- `.git/`

**Siempre incluye:**

- `passenger_wsgi.py`
- `requirements.txt`
- `static/`, `templates/`, `routes/`, etc.

---

## 5. Configurar `.env` en el servidor

En la raiz del proyecto en Hostinger, crea `.env` (copia de `.env.example`):

```env
SECRET_KEY=una-clave-aleatoria-muy-larga
FLASK_ENV=production
FLASK_DEBUG=0
SITE_URL=https://tudominio.pe

DB_ENGINE=mysql
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=u123456789_miph
MYSQL_USER=u123456789_miph
MYSQL_PASSWORD=tu-clave-segura

GOOGLE_OAUTH_REDIRECT_URI=https://tudominio.pe/cuenta/google/callback
```

Genera `SECRET_KEY` en tu PC:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## 6. Instalar dependencias Python

En hPanel → **Avanzado** → **Aplicaciones Python** (o por SSH):

```bash
pip install -r requirements.txt
```

Archivo de arranque: **`passenger_wsgi.py`**

---

## 7. Permisos de carpetas

```bash
chmod 755 static/uploads
```

La carpeta `static/uploads` debe poder escribir fotos de anuncios.

---

## 8. Google Maps y OAuth

En [Google Cloud Console](https://console.cloud.google.com/):

- **Maps API**: restringe por dominio `tudominio.pe`.
- **OAuth**: URI autorizada = `https://tudominio.pe/cuenta/google/callback`.

---

## 9. Verificar que funciona

1. Abre `https://tudominio.pe`
2. Registra un usuario o usa demo (si ejecutaste `init_db_hostinger.py`).
3. Publica un anuncio de prueba.
4. Revisa **Mi perfil** → estadisticas.

---

## 10. Checklist final

- [ ] HTTPS activo (candado verde)
- [ ] `FLASK_DEBUG=0`
- [ ] `SECRET_KEY` unica y larga
- [ ] `.env` no accesible desde el navegador
- [ ] MySQL acceso remoto **OFF**
- [ ] `SITE_URL` con tu dominio real
- [ ] Google OAuth con URL de produccion

---

## Desarrollo local vs produccion

| Entorno | DB_ENGINE | Base |
|---------|-----------|------|
| Tu PC (Windows) | `mssql` | SQL Server Express |
| Hostinger | `mysql` | MySQL del panel |

El mismo codigo funciona en ambos gracias a `sql_dialect.py`.

---

## Soporte

Si ves error 500, revisa los logs en hPanel → **Archivos de registro**.  
Errores comunes: credenciales MySQL incorrectas, falta importar `schema_mysql.sql`, o `SECRET_KEY` vacia.
