"""Inicializar esquema en Azure SQL Database (ejecutar desde tu PC)."""
from init_db import main

if __name__ == "__main__":
    print("Asegurate de tener en .env:")
    print("  DB_ENGINE=mssql")
    print("  DB_SERVER=tu-servidor.database.windows.net,1433")
    print("  DB_TRUSTED_CONNECTION=no")
    print("  DB_USER=sqladmin")
    print("  DB_PASSWORD=...")
    print("  DB_ENCRYPT=yes")
    print("  DB_AZURE=yes")
    main()
