# Despliegue en Azure — Mi Proximo Hogar

Guia para publicar el portal con **Azure App Service** + **Azure SQL Database** (SQL Server).

---

## 1. Requisitos

- Cuenta [Azure](https://portal.azure.com)
- Suscripcion activa
- Dominio (opcional; puedes usar `*.azurewebsites.net`)

---

## 2. Crear Azure SQL Database

1. Portal Azure → **Crear recurso** → **SQL Database**
2. Servidor: crea uno nuevo (ej. `miph-sql-server.database.windows.net`)
3. Autenticacion: **SQL** (usuario + contrasena) — guarda las credenciales
4. Nivel: Basic o Standard S0 para empezar
5. Firewall: permite **Servicios de Azure** y tu IP para administrar

### Importar esquema

Desde tu PC (con ODBC instalado) o Azure Cloud Shell:

```powershell
# En tu PC con el proyecto
cd c:\YOGER\miproximohogar
copy .env.example .env
# Edita .env con datos Azure SQL y DB_AZURE=yes
python init_db.py
```

O ejecuta `sql/schema.sql` en **Editor de consultas** del portal Azure (tabla por tabla si hay errores con `GO`).

---

## 3. Crear App Service (Python)

1. Portal Azure → **Crear recurso** → **App Service**
2. Publicar: **Codigo**
3. Runtime: **Python 3.11** o **3.12**
4. Sistema operativo: **Linux**
5. Region: la misma que tu SQL (menor latencia)

---

## 4. Configurar variables de entorno

App Service → **Configuracion** → **Variables de aplicacion** → **Nueva configuracion de aplicacion**

Copia desde `deploy/env.azure.plantilla.txt`:

| Variable | Valor ejemplo |
|----------|----------------|
| `SECRET_KEY` | clave aleatoria larga |
| `FLASK_ENV` | `production` |
| `FLASK_DEBUG` | `0` |
| `SITE_URL` | `https://tu-app.azurewebsites.net` |
| `DB_ENGINE` | `mssql` |
| `DB_DRIVER` | `ODBC Driver 18 for SQL Server` |
| `DB_SERVER` | `tu-servidor.database.windows.net,1433` |
| `DB_NAME` | `MiProximoHogar` |
| `DB_TRUSTED_CONNECTION` | `no` |
| `DB_USER` | `sqladmin` |
| `DB_PASSWORD` | tu password |
| `DB_ENCRYPT` | `yes` |
| `DB_TRUST_SERVER_CERTIFICATE` | `no` |
| `DB_AZURE` | `yes` |
| `LEGAL_ENTITY_NAME` | Razon social |
| `LEGAL_RUC` | RUC |
| `LEGAL_ADDRESS` | Domicilio |
| `LEGAL_EMAIL` | contacto@tudominio.pe |

Guarda y reinicia la app.

---

## 5. Comando de arranque

App Service → **Configuracion** → **Configuracion general**:

**Comando de inicio:**

```bash
bash startup.sh
```

El script `startup.sh` instala ODBC Driver 18 y arranca Gunicorn.

Alternativa manual:

```bash
gunicorn --bind=0.0.0.0:8000 --timeout 600 --workers 2 passenger_wsgi:application
```

---

## 6. Desplegar codigo

### Opcion A — GitHub Actions (recomendada)

1. Sube el repo a GitHub
2. App Service → **Centro de implementacion** → GitHub
3. Autoriza y selecciona rama `main`

### Opcion B — ZIP deploy

```powershell
# Excluye venv y .env
Compress-Archive -Path app.py,config.py,database.py,models.py,forms.py,extensions.py,sql_dialect.py,passenger_wsgi.py,requirements.txt,startup.sh,routes,templates,static,services,sql -DestinationPath deploy.zip
az webapp deploy --resource-group TU_GRUPO --name TU_APP --src-path deploy.zip --type zip
```

### Opcion C — VS Code

Extension **Azure App Service** → Deploy to Web App.

---

## 7. Firewall SQL ↔ App Service

En Azure SQL → **Redes** → marca **Permitir que los servicios y recursos de Azure accedan a este servidor**.

Si usas IP fija en App Service, anadela al firewall.

---

## 8. Subida de fotos (importante)

El disco local de App Service es **efimero** (se pierde al reiniciar).

Opciones:

1. **Azure Files** montado en `/home/uploads` y `UPLOAD_FOLDER=/home/uploads`
2. **Azure Blob Storage** (requiere integracion adicional en codigo)
3. Para pruebas iniciales: `static/uploads` funciona pero no es persistente

---

## 9. Dominio y HTTPS

1. App Service → **Dominios personalizados** → agrega `miproximohogar.org`
2. App Service → **Certificados** → certificado administrado (gratis)
3. Actualiza `SITE_URL` y `GOOGLE_OAUTH_REDIRECT_URI`

---

## 10. Verificar

| URL | Resultado esperado |
|-----|-------------------|
| `https://tu-app.azurewebsites.net/health` | `{"status":"ok","database":"ok"}` |
| `/` | Home del portal |
| `/legal/privacidad` | Politica de privacidad |
| `/cuenta/login` | Login |

Login demo (si corriste `init_db.py`):

- Email: `demo@miproximohogar.pe`
- Password: `Demo2050!`

---

## 11. Checklist produccion

- [ ] HTTPS activo
- [ ] `FLASK_DEBUG=0`
- [ ] `SECRET_KEY` unica
- [ ] `DB_AZURE=yes` y credenciales SQL correctas
- [ ] Datos legales (`LEGAL_*`) completos
- [ ] Google OAuth/Maps con dominio de produccion
- [ ] Correo SMTP configurado para recuperar contrasena
- [ ] Almacenamiento persistente para uploads
- [ ] `/health` responde 200

---

## Entornos

| Entorno | DB_ENGINE | Base |
|---------|-----------|------|
| PC local | `mssql` | SQL Server Express |
| Azure | `mssql` + `DB_AZURE=yes` | Azure SQL Database |
| Hostinger | `mysql` | MySQL del panel |

---

## Logs y errores

App Service → **Supervisar** → **Flujo de registros** → activa registro de aplicacion.

Errores comunes:

- **503 en /health**: credenciales SQL o firewall
- **ODBC Driver not found**: verifica que `startup.sh` se ejecuto
- **500 al login**: esquema no importado — ejecuta `init_db.py`
