# TechGear local database

TechGear uses Python's built-in HTTP server and SQLite. No packages need to be installed.

## Start the website

Open PowerShell in this folder and run:

```powershell
py .\server.py
```

Then open <http://127.0.0.1:8000>. Keep the PowerShell window open while using the site. Press `Ctrl+C` to stop the server.

The SQLite file is created automatically at `../data/techgear.sqlite3`. It stores products, orders, order items, contact messages, and feedback. The database file is outside the public website folder.

## Admin

Open <http://127.0.0.1:8000/admin.html> and sign in with `admin123`. Set the `ADMIN_PASSWORD` environment variable before starting the server to use a different password.

The admin page can update order statuses, add/edit/hide products, and review contact messages and feedback. Product changes are stored in SQLite and immediately reflected in the storefront.

This server is intended for local development and school projects. The default password and in-memory sessions are not suitable for public production hosting.