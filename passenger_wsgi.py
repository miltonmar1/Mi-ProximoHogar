"""Punto de entrada WSGI para produccion (Azure App Service, Hostinger, VPS)."""
import os

from app import create_app

application = create_app()

# Alias usado por algunos paneles (Passenger, gunicorn)
app = application
