#!/bin/bash
# Arranque Azure App Service (Linux) — Mi Proximo Hogar
# No usar "set -e": la instalacion ODBC puede fallar sin permisos root.

install_odbc() {
  if odbcinst -q -d -n "ODBC Driver 18 for SQL Server" >/dev/null 2>&1; then
    return 0
  fi
  if odbcinst -q -d -n "ODBC Driver 17 for SQL Server" >/dev/null 2>&1; then
    return 0
  fi
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg 2>/dev/null || true
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
      > /etc/apt/sources.list.d/mssql-release.list 2>/dev/null || true
    apt-get update -qq 2>/dev/null || true
    ACCEPT_EULA=Y apt-get install -y msodbcsql18 unixodbc-dev 2>/dev/null || true
  fi
}

install_odbc

cd /home/site/wwwroot 2>/dev/null || cd "$(dirname "$0")" || true

if [ -f requirements.txt ]; then
  python -m pip install --upgrade pip --quiet 2>/dev/null || true
  python -m pip install -r requirements.txt --quiet 2>/dev/null || true
fi

PORT="${PORT:-8000}"
WEBSITES_PORT="${WEBSITES_PORT:-${PORT}}"

echo "Starting gunicorn on port ${WEBSITES_PORT}..."
  --chdir /home/site/wwwroot \
  --bind "0.0.0.0:${WEBSITES_PORT}" \
  --timeout 600 \
  --workers 2 \
  --access-logfile - \
  --error-logfile - \
  passenger_wsgi:application
