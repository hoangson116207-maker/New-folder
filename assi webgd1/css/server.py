import json
import hmac
import os
import re
import secrets
import sqlite3
import time
from http.cookies import SimpleCookie
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


WEB_ROOT = Path(__file__).resolve().parent
DATABASE_PATH = WEB_ROOT.parent / "data" / "techgear.sqlite3"
PRODUCTS = (
    ("keychron-k2", "Keychron K2 Wireless", "keyboard", 2_190_000, "Layout gọn 75%, kết nối đa thiết bị, hợp cả Mac lẫn Windows.", "https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&w=900&q=80"),
    ("akko-5075b-plus", "Akko 5075B Plus", "keyboard", 1_890_000, "Gõ êm, đổi switch linh hoạt, keycap PBT bền màu.", "https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80"),
    ("logitech-g-pro-x", "Logitech G Pro X Superlight", "mouse", 3_290_000, "Thiết kế siêu nhẹ, cảm biến chính xác cho mọi pha xử lý.", "https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=900&q=80"),
    ("logitech-mx-master-3s", "Logitech MX Master 3S", "mouse", 2_490_000, "Cuộn MagSpeed, thao tác yên tĩnh, tối ưu cho ngày làm việc dài.", "https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?auto=format&fit=crop&w=900&q=80"),
    ("sony-wh-1000xm5", "Sony WH-1000XM5", "audio", 7_490_000, "Chống ồn thông minh, âm thanh chi tiết, pin bền bỉ cả ngày.", "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80"),
    ("hyperx-cloud-iii", "HyperX Cloud III", "audio", 2_190_000, "Đệm tai thoải mái, mic tháo rời, âm thanh vòm sống động.", "https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80"),
)
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ADMIN_SESSIONS = {}
ORDER_STATUSES = {"pending", "confirmed", "shipping", "completed", "cancelled"}
PRODUCT_CATEGORIES = {"keyboard", "mouse", "audio", "accessory"}


def connect_database():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect_database() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL,
                price INTEGER NOT NULL CHECK (price >= 0),
                active INTEGER NOT NULL DEFAULT 1,
                description TEXT NOT NULL DEFAULT '',
                image_url TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL,
                address TEXT NOT NULL,
                total INTEGER NOT NULL CHECK (total >= 0),
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                product_id TEXT NOT NULL REFERENCES products(id),
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                unit_price INTEGER NOT NULL CHECK (unit_price >= 0)
            );
            CREATE TABLE IF NOT EXISTS contact_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                topic TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                message TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            """
        )
        order_columns = {row["name"] for row in connection.execute("PRAGMA table_info(orders)")}
        if "status" not in order_columns:
            connection.execute("ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'")
        product_columns = {row["name"] for row in connection.execute("PRAGMA table_info(products)")}
        if "description" not in product_columns:
            connection.execute("ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        if "image_url" not in product_columns:
            connection.execute("ALTER TABLE products ADD COLUMN image_url TEXT NOT NULL DEFAULT ''")
        connection.executemany(
            "INSERT OR IGNORE INTO products (id, name, category, price, description, image_url) VALUES (?, ?, ?, ?, ?, ?)",
            PRODUCTS,
        )
        connection.executemany(
            "UPDATE products SET description = ?, image_url = ? WHERE id = ? AND (description = '' OR image_url = '')",
            [(description, image_url, product_id) for product_id, _, _, _, description, image_url in PRODUCTS],
        )


class TechGearHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def send_json(self, payload, status=HTTPStatus.OK, headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def is_admin(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        session_cookie = cookie.get("techgear_admin")
        token = session_cookie.value if session_cookie else ""
        expiry = ADMIN_SESSIONS.get(token, 0)
        if expiry < time.time():
            ADMIN_SESSIONS.pop(token, None)
            return False
        return True

    def require_admin(self):
        if self.is_admin():
            return True
        self.send_json({"error": "Vui lòng đăng nhập với tài khoản quản trị."}, HTTPStatus.UNAUTHORIZED)
        return False

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Kích thước dữ liệu không hợp lệ.") from error
        if length <= 0 or length > 32_768:
            raise ValueError("Dữ liệu gửi lên không hợp lệ.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Dữ liệu JSON không hợp lệ.") from error
        if not isinstance(payload, dict):
            raise ValueError("Dữ liệu gửi lên không hợp lệ.")
        return payload

    @staticmethod
    def required_text(payload, key, label, limit):
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Vui lòng nhập {label}.")
        value = value.strip()
        if len(value) > limit:
            raise ValueError(f"{label.capitalize()} không được dài quá {limit} ký tự.")
        return value

    @staticmethod
    def valid_email(value):
        return re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value) is not None

    def do_GET(self):
        path = urlsplit(self.path).path
        admin_routes = {
            "/api/admin/orders": self.list_orders,
            "/api/admin/products": self.list_admin_products,
            "/api/admin/messages": self.list_contact_messages,
            "/api/admin/feedback": self.list_feedback,
        }
        if path in admin_routes:
            if self.require_admin():
                admin_routes[path]()
            return
        if path != "/api/products":
            if path.startswith("/api/"):
                self.send_json({"error": "Không tìm thấy API."}, HTTPStatus.NOT_FOUND)
                return
            super().do_GET()
            return

        with connect_database() as connection:
            products = connection.execute(
                "SELECT id, name, category, price, description, image_url FROM products WHERE active = 1 ORDER BY rowid"
            ).fetchall()
        self.send_json({"products": [dict(product) for product in products]})

    def do_POST(self):
        path = urlsplit(self.path).path
        handlers = {
            "/api/orders": self.create_order,
            "/api/contact": self.create_contact_message,
            "/api/feedback": self.create_feedback,
            "/api/admin/login": self.admin_login,
            "/api/admin/logout": self.admin_logout,
            "/api/admin/orders/status": self.update_order_status,
            "/api/admin/products/save": self.save_product,
            "/api/admin/products/active": self.update_product_active,
        }
        handler = handlers.get(path)
        if handler is None:
            self.send_json({"error": "Không tìm thấy API."}, HTTPStatus.NOT_FOUND)
            return
        try:
            handler(self.read_json())
        except ValueError as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except sqlite3.Error:
            self.send_json({"error": "Không thể lưu dữ liệu. Vui lòng thử lại."}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def create_order(self, payload):
        customer = payload.get("customer")
        if not isinstance(customer, dict):
            raise ValueError("Thông tin khách hàng không hợp lệ.")
        name = self.required_text(customer, "name", "họ tên", 100)
        email = self.required_text(customer, "email", "email", 254)
        phone = self.required_text(customer, "phone", "số điện thoại", 30)
        address = self.required_text(customer, "address", "địa chỉ", 300)
        if not self.valid_email(email):
            raise ValueError("Địa chỉ email không hợp lệ.")

        requested_items = payload.get("items")
        if not isinstance(requested_items, list) or not requested_items:
            raise ValueError("Giỏ hàng đang trống.")
        quantities = {}
        for item in requested_items:
            if not isinstance(item, dict):
                raise ValueError("Sản phẩm trong giỏ không hợp lệ.")
            product_id = item.get("product_id")
            quantity = item.get("quantity")
            if not isinstance(product_id, str) or not isinstance(quantity, int) or isinstance(quantity, bool) or quantity < 1 or quantity > 20:
                raise ValueError("Số lượng sản phẩm không hợp lệ.")
            quantities[product_id] = quantities.get(product_id, 0) + quantity
        if len(quantities) > 20 or any(quantity > 20 for quantity in quantities.values()):
            raise ValueError("Giỏ hàng vượt quá giới hạn cho phép.")

        with connect_database() as connection:
            selected_products = {}
            for product_id in quantities:
                product = connection.execute(
                    "SELECT id, price FROM products WHERE id = ? AND active = 1", (product_id,)
                ).fetchone()
                if product is None:
                    raise ValueError("Một sản phẩm trong giỏ hàng hiện không còn bán.")
                selected_products[product_id] = product

            total = sum(selected_products[key]["price"] * quantity for key, quantity in quantities.items())
            cursor = connection.execute(
                "INSERT INTO orders (customer_name, email, phone, address, total) VALUES (?, ?, ?, ?, ?)",
                (name, email, phone, address, total),
            )
            order_id = cursor.lastrowid
            connection.executemany(
                "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
                [
                    (order_id, product_id, quantity, selected_products[product_id]["price"])
                    for product_id, quantity in quantities.items()
                ],
            )
        self.send_json({"order_id": order_id, "total": total, "status": "pending"}, HTTPStatus.CREATED)

    def admin_login(self, payload):
        password = payload.get("password")
        if not isinstance(password, str) or not hmac.compare_digest(password, ADMIN_PASSWORD):
            self.send_json({"error": "Mật khẩu quản trị không chính xác."}, HTTPStatus.UNAUTHORIZED)
            return
        now = time.time()
        for token, expiry in list(ADMIN_SESSIONS.items()):
            if expiry < now:
                ADMIN_SESSIONS.pop(token, None)
        token = secrets.token_urlsafe(32)
        ADMIN_SESSIONS[token] = now + 8 * 60 * 60
        self.send_json(
            {"authenticated": True},
            headers={"Set-Cookie": f"techgear_admin={token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=28800"},
        )

    def admin_logout(self, payload):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        session_cookie = cookie.get("techgear_admin")
        if session_cookie:
            ADMIN_SESSIONS.pop(session_cookie.value, None)
        self.send_json(
            {"authenticated": False},
            headers={"Set-Cookie": "techgear_admin=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0"},
        )

    def list_orders(self):
        with connect_database() as connection:
            rows = connection.execute(
                """SELECT o.id, o.customer_name, o.email, o.phone, o.address, o.total, o.status, o.created_at,
                          oi.product_id, p.name AS product_name, oi.quantity, oi.unit_price
                   FROM orders o
                   LEFT JOIN order_items oi ON oi.order_id = o.id
                   LEFT JOIN products p ON p.id = oi.product_id
                   ORDER BY o.id DESC LIMIT 500"""
            ).fetchall()
        orders = {}
        for row in rows:
            order = orders.setdefault(row["id"], {
                "id": row["id"], "customer_name": row["customer_name"], "email": row["email"],
                "phone": row["phone"], "address": row["address"], "total": row["total"],
                "status": row["status"], "created_at": row["created_at"], "items": [],
            })
            if row["product_id"]:
                order["items"].append({
                    "product_id": row["product_id"], "name": row["product_name"],
                    "quantity": row["quantity"], "unit_price": row["unit_price"],
                })
        self.send_json({"orders": list(orders.values())})

    def list_admin_products(self):
        with connect_database() as connection:
            rows = connection.execute(
                "SELECT id, name, category, price, description, image_url, active FROM products ORDER BY rowid DESC"
            ).fetchall()
        self.send_json({"products": [dict(row) for row in rows]})

    def save_product(self, payload):
        if not self.require_admin():
            return
        name = self.required_text(payload, "name", "tên sản phẩm", 120)
        description = payload.get("description", "")
        image_url = payload.get("image_url", "")
        category = payload.get("category")
        price = payload.get("price")
        product_id = payload.get("id")
        if not isinstance(description, str) or len(description) > 1000:
            raise ValueError("Mô tả không được dài quá 1000 ký tự.")
        if not isinstance(image_url, str) or len(image_url) > 1000:
            raise ValueError("Đường dẫn hình ảnh không hợp lệ.")
        if image_url and urlsplit(image_url).scheme not in {"http", "https"}:
            raise ValueError("Hình ảnh cần dùng đường dẫn HTTP hoặc HTTPS.")
        if not isinstance(category, str) or category not in PRODUCT_CATEGORIES:
            raise ValueError("Danh mục sản phẩm không hợp lệ.")
        if not isinstance(price, int) or isinstance(price, bool) or price < 0 or price > 2_000_000_000:
            raise ValueError("Giá sản phẩm không hợp lệ.")

        with connect_database() as connection:
            if product_id:
                if not isinstance(product_id, str):
                    raise ValueError("Mã sản phẩm không hợp lệ.")
                cursor = connection.execute(
                    "UPDATE products SET name = ?, category = ?, price = ?, description = ?, image_url = ? WHERE id = ?",
                    (name, category, price, description.strip(), image_url.strip(), product_id),
                )
                if cursor.rowcount == 0:
                    self.send_json({"error": "Không tìm thấy sản phẩm."}, HTTPStatus.NOT_FOUND)
                    return
            else:
                product_id = "gear-" + secrets.token_hex(6)
                connection.execute(
                    "INSERT INTO products (id, name, category, price, description, image_url) VALUES (?, ?, ?, ?, ?, ?)",
                    (product_id, name, category, price, description.strip(), image_url.strip()),
                )
        self.send_json({"product_id": product_id}, HTTPStatus.CREATED)

    def update_product_active(self, payload):
        if not self.require_admin():
            return
        product_id = payload.get("product_id")
        active = payload.get("active")
        if not isinstance(product_id, str) or not product_id or not isinstance(active, bool):
            raise ValueError("Thông tin trạng thái sản phẩm không hợp lệ.")
        with connect_database() as connection:
            cursor = connection.execute("UPDATE products SET active = ? WHERE id = ?", (int(active), product_id))
        if cursor.rowcount == 0:
            self.send_json({"error": "Không tìm thấy sản phẩm."}, HTTPStatus.NOT_FOUND)
            return
        self.send_json({"product_id": product_id, "active": active})

    def list_contact_messages(self):
        with connect_database() as connection:
            rows = connection.execute(
                "SELECT id, name, email, topic, message, created_at FROM contact_messages ORDER BY id DESC LIMIT 300"
            ).fetchall()
        self.send_json({"messages": [dict(row) for row in rows]})

    def list_feedback(self):
        with connect_database() as connection:
            rows = connection.execute(
                "SELECT id, name, rating, message, created_at FROM feedback ORDER BY id DESC LIMIT 300"
            ).fetchall()
        self.send_json({"feedback": [dict(row) for row in rows]})

    def update_order_status(self, payload):
        if not self.require_admin():
            return
        order_id = payload.get("order_id")
        status = payload.get("status")
        if not isinstance(order_id, int) or isinstance(order_id, bool) or order_id < 1:
            raise ValueError("Mã đơn hàng không hợp lệ.")
        if status not in ORDER_STATUSES:
            raise ValueError("Trạng thái đơn hàng không hợp lệ.")
        with connect_database() as connection:
            cursor = connection.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
        if cursor.rowcount == 0:
            self.send_json({"error": "Không tìm thấy đơn hàng."}, HTTPStatus.NOT_FOUND)
            return
        self.send_json({"order_id": order_id, "status": status})

    def create_contact_message(self, payload):
        name = self.required_text(payload, "name", "họ tên", 100)
        email = self.required_text(payload, "email", "email", 254)
        topic = self.required_text(payload, "topic", "chủ đề", 100)
        message = self.required_text(payload, "message", "lời nhắn", 5000)
        if not self.valid_email(email):
            raise ValueError("Địa chỉ email không hợp lệ.")
        with connect_database() as connection:
            cursor = connection.execute(
                "INSERT INTO contact_messages (name, email, topic, message) VALUES (?, ?, ?, ?)",
                (name, email, topic, message),
            )
        self.send_json({"message_id": cursor.lastrowid}, HTTPStatus.CREATED)

    def create_feedback(self, payload):
        name = self.required_text(payload, "name", "họ tên", 100)
        message = self.required_text(payload, "message", "ý kiến", 5000)
        rating = payload.get("rating")
        if not isinstance(rating, int) or isinstance(rating, bool) or not 1 <= rating <= 5:
            raise ValueError("Mức độ hài lòng phải từ 1 đến 5 sao.")
        with connect_database() as connection:
            cursor = connection.execute(
                "INSERT INTO feedback (name, rating, message) VALUES (?, ?, ?)",
                (name, rating, message),
            )
        self.send_json({"feedback_id": cursor.lastrowid}, HTTPStatus.CREATED)


if __name__ == "__main__":
    initialize_database()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), TechGearHandler)
    print(f"TechGear đang chạy tại http://127.0.0.1:{port}")
    print(f"Database: {DATABASE_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nĐã dừng máy chủ TechGear.")
    finally:
        server.server_close()