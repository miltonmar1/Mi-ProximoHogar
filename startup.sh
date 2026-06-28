#!/bin/bash
# Arranque para Azure App Service (Linux) — Mi Proximo Hogar
set -e

# Instalar ODBC Driver 18 para Azure SQL (solo si no esta instalado)
if ! odbcinst -q -d -n "ODBC Driver 18 for SQL Server" >/dev/null 2>&1; then
  curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
    > /etc/apt/sources.list.d/mssql-release.list
  apt-get update
  ACCEPT_EULA=Y apt-get install -y msodbcsql18 unixodbc-dev
fi

PORT="${PORT:-8000}"
exec gunicorn --bind "0.0.0.0:${PORT}" --timeout 600 --workers 2 passenger_wsgi:application
