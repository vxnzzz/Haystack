import json
import os
import secrets
import threading
import time
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from pathlib import Path

DATA_PATH = "haystack_data.json"
DATA_LOCK = threading.Lock()
SESSIONS = {}
ASSET_LOGO_PATH = Path(__file__).resolve().parent / "logo.png"


def ensure_data_file():
    if os.path.exists(DATA_PATH):
        return
    with open(DATA_PATH, "w", encoding="utf-8") as file:
        json.dump({"users": {}, "messages": [], "guest_messages": []}, file)


def read_data():
    with DATA_LOCK:
        ensure_data_file()
        with open(DATA_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
    data.setdefault("users", {})
    data.setdefault("messages", [])
    data.setdefault("guest_messages", [])
    return data


def write_data(data):
    with DATA_LOCK:
        with open(DATA_PATH, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False)


def user_view(username, user_obj):
    return {
        "username": username,
        "avatar_url": user_obj.get("avatar_url", ""),
        "friends": user_obj.get("friends", []),
        "is_guest": bool(user_obj.get("is_guest", False)),
    }


def hash_password(password):
    salt = secrets.token_hex(16)
    iterations = 200000
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), iterations
    ).hex()
    return f"pbkdf2_sha256${iterations}${salt}${digest}"


def verify_password(password, stored):
    if not stored:
        return password == ""
    if stored.startswith("pbkdf2_sha256$"):
        try:
            _, iter_text, salt, expected = stored.split("$", 3)
            iterations = int(iter_text)
            digest = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), bytes.fromhex(salt), iterations
            ).hex()
            return secrets.compare_digest(digest, expected)
        except Exception:
            return False
    # Legacy plaintext fallback for older local data.
    return secrets.compare_digest(password, stored)


class HaystackHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/logo.png":
            return self.serve_logo()
        if not parsed.path.startswith("/api/"):
            return super().do_GET()

        if parsed.path == "/api/me":
            me = self.require_auth_user()
            if not me:
                return
            username, user_obj = me
            return self.send_json({"user": user_view(username, user_obj)})

        if parsed.path == "/api/friends":
            me = self.require_auth_user()
            if not me:
                return
            _, user_obj = me
            data = read_data()
            friends = []
            for username in user_obj.get("friends", []):
                friend_obj = data["users"].get(username)
                if friend_obj:
                    friends.append(user_view(username, friend_obj))
            return self.send_json({"friends": friends})

        if parsed.path == "/api/friend-requests":
            me = self.require_auth_user()
            if not me:
                return
            _, user_obj = me
            return self.send_json(
                {
                    "incoming": user_obj.get("incoming_requests", []),
                    "outgoing": user_obj.get("outgoing_requests", []),
                }
            )

        if parsed.path == "/api/messages":
            me = self.require_auth_user()
            if not me:
                return
            username, _ = me
            query = parse_qs(parsed.query)
            peer = (query.get("with") or [""])[0]
            data = read_data()
            items = []
            for msg in data.get("messages", []):
                is_pair = (msg["from"] == username and msg["to"] == peer) or (
                    msg["from"] == peer and msg["to"] == username
                )
                if is_pair:
                    items.append(msg)
            return self.send_json({"messages": items})

        if parsed.path == "/api/public-key":
            me = self.require_auth_user(allow_guest=False)
            if not me:
                return
            query = parse_qs(parsed.query)
            username = (query.get("username") or [""])[0]
            if username == "":
                return self.send_json({"error": "Anvandarnamn kravs"}, status=400)
            data = read_data()
            user = data["users"].get(username)
            if not user:
                return self.send_json({"error": "Anvandaren finns inte"}, status=404)
            return self.send_json({"public_key": user.get("public_key", "")})

        if parsed.path == "/api/guest-messages":
            me = self.require_auth_user(allow_guest=True)
            if not me:
                return
            _, user_obj = me
            if not user_obj.get("is_guest", False):
                return self.send_json({"error": "Endast gastkonton"}, status=403)
            data = read_data()
            return self.send_json({"messages": data.get("guest_messages", [])[-200:]})

        self.send_json({"error": "Okand endpoint"}, status=404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_json({"error": "Okand endpoint"}, status=404)
            return

        body = self.read_json_body()
        if body is None:
            return

        if parsed.path == "/api/signup":
            return self.handle_signup(body)
        if parsed.path == "/api/login":
            return self.handle_login(body)
        if parsed.path == "/api/guest-login":
            return self.handle_guest_login()
        if parsed.path == "/api/friend-request":
            return self.handle_friend_request(body)
        if parsed.path == "/api/friend-requests/respond":
            return self.handle_friend_request_response(body)
        if parsed.path == "/api/messages":
            return self.handle_send_message(body)
        if parsed.path == "/api/proxy/send":
            return self.handle_proxy_send(body)
        if parsed.path == "/api/avatar":
            return self.handle_avatar(body)
        if parsed.path == "/api/public-key":
            return self.handle_public_key_update(body)
        if parsed.path == "/api/guest-messages":
            return self.handle_guest_message(body)

        self.send_json({"error": "Okand endpoint"}, status=404)

    def read_json_body(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length).decode("utf-8")
            return json.loads(raw or "{}")
        except Exception:
            self.send_json({"error": "Ogiltig JSON"}, status=400)
            return None

    def get_token(self):
        auth_header = self.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return ""
        return auth_header.replace("Bearer ", "", 1).strip()

    def require_auth_user(self, allow_guest=True):
        token = self.get_token()
        username = SESSIONS.get(token)
        if not username:
            self.send_json({"error": "Inte inloggad"}, status=401)
            return None
        data = read_data()
        user_obj = data["users"].get(username)
        if not user_obj:
            self.send_json({"error": "Anvandare saknas"}, status=401)
            return None
        if not allow_guest and user_obj.get("is_guest", False):
            self.send_json({"error": "Gastkonto kan inte anvanda denna funktion"}, status=403)
            return None
        return username, user_obj

    def ensure_user_shape(self, user_obj):
        user_obj.setdefault("password_hash", "")
        user_obj.setdefault("avatar_url", "")
        user_obj.setdefault("friends", [])
        user_obj.setdefault("incoming_requests", [])
        user_obj.setdefault("outgoing_requests", [])
        user_obj.setdefault("public_key", "")
        user_obj.setdefault("is_guest", False)

    def handle_signup(self, body):
        username = str(body.get("username", ""))
        password = str(body.get("password", ""))
        if username == "":
            return self.send_json({"error": "Anvandarnamn kravs"}, status=400)

        data = read_data()
        if username in data["users"]:
            return self.send_json({"error": "Anvandarnamn finns redan"}, status=400)

        data["users"][username] = {
            "password_hash": hash_password(password),
            "avatar_url": "",
            "friends": [],
            "incoming_requests": [],
            "outgoing_requests": [],
            "public_key": "",
            "is_guest": False,
        }
        write_data(data)
        token = secrets.token_urlsafe(24)
        SESSIONS[token] = username
        self.send_json({"token": token, "user": user_view(username, data["users"][username])})

    def handle_guest_login(self):
        data = read_data()
        while True:
            guest_username = f"gast-{secrets.token_hex(3)}"
            if guest_username not in data["users"]:
                break
        data["users"][guest_username] = {
            "password_hash": "",
            "avatar_url": "",
            "friends": [],
            "incoming_requests": [],
            "outgoing_requests": [],
            "public_key": "",
            "is_guest": True,
        }
        write_data(data)
        token = secrets.token_urlsafe(24)
        SESSIONS[token] = guest_username
        self.send_json(
            {
                "token": token,
                "user": user_view(guest_username, data["users"][guest_username]),
                "guest": True,
            }
        )

    def handle_login(self, body):
        username = str(body.get("username", ""))
        password = str(body.get("password", ""))
        data = read_data()
        user_obj = data["users"].get(username)
        if not user_obj:
            return self.send_json({"error": "Fel anvandarnamn eller losenord"}, status=401)
        self.ensure_user_shape(user_obj)
        stored_hash = user_obj.get("password_hash", "")
        legacy_password = user_obj.get("password", "")
        if stored_hash:
            is_valid = verify_password(password, stored_hash)
        else:
            is_valid = verify_password(password, legacy_password)
            if is_valid:
                # Upgrade legacy plaintext password storage in place.
                user_obj["password_hash"] = hash_password(password)
                user_obj.pop("password", None)
                write_data(data)
        if not is_valid:
            return self.send_json({"error": "Fel anvandarnamn eller losenord"}, status=401)
        token = secrets.token_urlsafe(24)
        SESSIONS[token] = username
        self.send_json({"token": token, "user": user_view(username, user_obj)})

    def handle_friend_request(self, body):
        me = self.require_auth_user(allow_guest=False)
        if not me:
            return
        sender_name, _ = me
        to_username = str(body.get("to_username", ""))
        if to_username == "":
            return self.send_json({"error": "Anvandarnamn kravs"}, status=400)
        if to_username == sender_name:
            return self.send_json({"error": "Du kan inte lagga till dig sjalv"}, status=400)

        data = read_data()
        sender = data["users"].get(sender_name)
        target = data["users"].get(to_username)
        if not target:
            return self.send_json({"error": "Anvandaren finns inte"}, status=404)

        self.ensure_user_shape(sender)
        self.ensure_user_shape(target)

        if to_username in sender["friends"]:
            return self.send_json({"error": "Ni ar redan vanner"}, status=400)
        if to_username in sender["outgoing_requests"]:
            return self.send_json({"error": "Forfragan ar redan skickad"}, status=400)

        sender["outgoing_requests"].append(to_username)
        target["incoming_requests"].append(sender_name)
        write_data(data)
        self.send_json({"ok": True})

    def handle_friend_request_response(self, body):
        me = self.require_auth_user(allow_guest=False)
        if not me:
            return
        my_name, _ = me
        from_username = str(body.get("from_username", ""))
        accept = bool(body.get("accept", False))
        data = read_data()
        me_user = data["users"].get(my_name)
        sender = data["users"].get(from_username)
        if not sender:
            return self.send_json({"error": "Anvandaren finns inte"}, status=404)

        self.ensure_user_shape(me_user)
        self.ensure_user_shape(sender)

        if from_username not in me_user["incoming_requests"]:
            return self.send_json({"error": "Ingen forfragan hittades"}, status=400)

        me_user["incoming_requests"] = [
            u for u in me_user["incoming_requests"] if u != from_username
        ]
        sender["outgoing_requests"] = [u for u in sender["outgoing_requests"] if u != my_name]

        if accept:
            if from_username not in me_user["friends"]:
                me_user["friends"].append(from_username)
            if my_name not in sender["friends"]:
                sender["friends"].append(my_name)

        write_data(data)
        self.send_json({"ok": True, "accepted": accept})

    def handle_send_message(self, body):
        me = self.require_auth_user(allow_guest=False)
        if not me:
            return
        from_username, _ = me
        to_username = str(body.get("to_username", ""))
        content = str(body.get("content", ""))
        if to_username == "":
            return self.send_json({"error": "Mottagare kravs"}, status=400)
        if content == "" and not body.get("attachments"):
            return self.send_json({"error": "Meddelande ar tomt"}, status=400)

        data = read_data()
        sender = data["users"].get(from_username)
        receiver = data["users"].get(to_username)
        if not receiver:
            return self.send_json({"error": "Mottagaren finns inte"}, status=404)
        self.ensure_user_shape(sender)
        if to_username not in sender["friends"]:
            return self.send_json({"error": "Ni maste vara vanner for att chatta"}, status=403)

        data["messages"].append(
            {
                "from": from_username,
                "to": to_username,
                "content": content,
                "cipher": body.get("cipher", ""),
                "iv": body.get("iv", ""),
                "keys": body.get("keys", {}),
                "attachments": body.get("attachments", []),
                "encrypted": bool(body.get("encrypted", False)),
                "timestamp": int(time.time()),
            }
        )
        write_data(data)
        self.send_json({"ok": True})

    def handle_proxy_send(self, body):
        # Proxy endpoint: routes payload to internal delivery logic.
        return self.handle_send_message(body)

    def handle_avatar(self, body):
        me = self.require_auth_user(allow_guest=False)
        if not me:
            return
        username, _ = me
        avatar_url = str(body.get("avatar_url", ""))
        data = read_data()
        user_obj = data["users"].get(username)
        self.ensure_user_shape(user_obj)
        user_obj["avatar_url"] = avatar_url
        write_data(data)
        self.send_json({"ok": True, "avatar_url": avatar_url})

    def handle_public_key_update(self, body):
        me = self.require_auth_user(allow_guest=False)
        if not me:
            return
        username, _ = me
        public_key = str(body.get("public_key", ""))
        data = read_data()
        user_obj = data["users"].get(username)
        self.ensure_user_shape(user_obj)
        user_obj["public_key"] = public_key
        write_data(data)
        self.send_json({"ok": True})

    def handle_guest_message(self, body):
        me = self.require_auth_user(allow_guest=True)
        if not me:
            return
        username, user_obj = me
        if not user_obj.get("is_guest", False):
            return self.send_json({"error": "Endast gastkonton"}, status=403)
        content = str(body.get("content", ""))
        attachments = body.get("attachments", [])
        if content == "" and not attachments:
            return self.send_json({"error": "Meddelande ar tomt"}, status=400)
        data = read_data()
        data["guest_messages"].append(
            {
                "from": username,
                "content": content,
                "attachments": attachments,
                "timestamp": int(time.time()),
            }
        )
        write_data(data)
        self.send_json({"ok": True})

    def serve_logo(self):
        if not ASSET_LOGO_PATH.exists():
            return self.send_json({"error": "Logo saknas"}, status=404)
        data = ASSET_LOGO_PATH.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload, status=200):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "3000"))
    ensure_data_file()
    server = ThreadingHTTPServer(("127.0.0.1", port), HaystackHandler)
    print(f"haystack server kor pa http://127.0.0.1:{port}")
    server.serve_forever()
