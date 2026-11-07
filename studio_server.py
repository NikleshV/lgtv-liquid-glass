#!/usr/bin/env python3
"""
Local Windows/macOS/Linux Web Dashboard & Installer Studio Server for LG QNED83SRA.
Serves:
- `/` -> Interactive Setup Studio, Theme & Dock Customizer, LG Debloat Wizard, and One-Click Deployer
- `/tv/` -> Live 1920x1080 interactive preview of the Liquid Glass Home screen (`launcher/index.html`)
- `/api/config` (GET/POST) -> Reads & updates `launcher/config.js` and `launcher/apps.js`
- `/api/wallpaper` (POST) -> Saves a custom wallpaper into `launcher/wallpapers/custom.jpg`
- `/api/sync` (POST) -> Pairs over SSAP (`wss://TV:3001`) and syncs installed apps, icons & HDMI inputs
- `/api/deploy` (POST) -> Full 6-step No-Root Developer Mode deployment + On-TV Home Helper + Auto-Renewal
- `/api/debloat-action` (POST) -> Remotely opens the exact LG Settings screen on the TV (General / Privacy / Network)
- `/api/uninstall` (POST) -> Cleanly removes custom launcher and restores stock LG Home
"""
import asyncio
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import sys
import traceback
from urllib.parse import urlparse
import webbrowser

from ipk_builder import build_launcher_ipk, DIST_DIR, LAUNCHER_DIR
from lgtv_ssap import sync_tv_inventory, open_tv_settings_screen
from tv_deployer import deploy_to_tv, uninstall_from_tv

HERE = Path(__file__).resolve().parent
DASHBOARD_DIR = HERE / "dashboard"


def read_current_config() -> dict:
    cfg_path = LAUNCHER_DIR / "config.js"
    raw = cfg_path.read_text(encoding="utf-8")
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1:
        try:
            # config.js uses valid JSON object body if we format it cleanly, or we parse keys
            return json.loads(raw[start : end + 1])
        except Exception:
            pass
    return {
        "columns": 6,
        "greetingName": "",
        "theme": "aurora",
        "weatherEnabled": True,
        "weatherCity": "Auto",
        "weatherLat": None,
        "weatherLon": None,
        "screensaverMinutes": 4,
        "autoRenewDevMode": True,
        "showHeroShelf": True,
        "dockApps": [
            "netflix",
            "youtube.leanback.v4",
            "amazon",
            "com.disney.disneyplus-prod",
            "com.apple.appletv",
            "cdp-30",
        ],
        "hiddenApps": [
            "com.gathin.tvhome",
            "com.local.nativehome",
            "com.webos.app.home",
            "com.webos.app.discovery",
            "com.webos.app.browser",
            "com.palm.app.settings",
            "com.webos.app.notificationcenter",
            "com.webos.app.expanduserguide",
            "com.webos.app.cheeringtv",
            "com.webos.app.lgchannels",
            "com.webos.app.acr",
            "com.webos.app.shop",
            "com.webos.app.voice",
            "com.webos.app.homeconnect",
            "com.webos.app.sportalert",
            "com.webos.app.artgallery",
        ],
    }


def write_current_config(cfg: dict) -> None:
    cfg_path = LAUNCHER_DIR / "config.js"
    cfg_path.write_text(
        "// Liquid Glass Launcher Configuration for LG QNED83SRA (webOS)\n"
        "window.CONFIG = " + json.dumps(cfg, indent=2, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )


def read_current_apps() -> dict:
    apps_path = LAUNCHER_DIR / "apps.js"
    if apps_path.exists():
        raw = apps_path.read_text(encoding="utf-8")
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1:
            try:
                return json.loads(raw[start : end + 1])
            except Exception:
                pass
    return {"apps": [], "inputs": []}


class StudioHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, file_path: Path, filename: str = None):
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404, "File not found")
            return
        ctype, _ = mimetypes.guess_type(str(file_path))
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/download-zip", "/api/download/windows-project.zip"):
            zip_path = Path("/home/antigravity/lgtv-liquid-glass-windows.zip")
            self._serve_file(zip_path, filename="lgtv-liquid-glass-windows.zip")
            return

        if path == "/api/config":
            self._send_json({
                "ok": True,
                "config": read_current_config(),
                "inventory": read_current_apps(),
            })
            return

        if path == "/api/download/launcher.ipk":
            ipk = build_launcher_ipk()
            self._serve_file(ipk, filename="com.gathin.tvhome_1.11.0_all.ipk")
            return

        if path == "/api/download/helper.ipk":
            helper = DIST_DIR / "com.local.nativehome_0.6.19_arm.ipk"
            if not helper.exists():
                build_launcher_ipk()
            self._serve_file(helper, filename="com.local.nativehome_0.6.19_arm.ipk")
            return

        if path == "/tv" or path == "/tv/":
            self._serve_file(LAUNCHER_DIR / "index.html")
            return

        if path.startswith("/tv/"):
            rel = path[len("/tv/") :]
            target = (LAUNCHER_DIR / rel).resolve()
            if str(target).startswith(str(LAUNCHER_DIR.resolve())):
                self._serve_file(target)
                return

        if path == "/" or path == "/index.html":
            self._serve_file(DASHBOARD_DIR / "index.html")
            return

        rel = path.lstrip("/")
        target = (DASHBOARD_DIR / rel).resolve()
        if str(target).startswith(str(DASHBOARD_DIR.resolve())) and target.is_file():
            self._serve_file(target)
            return

        self.send_error(404, "Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(raw_body.decode("utf-8"))
        except Exception:
            body = {}

        try:
            if path == "/api/config":
                current = read_current_config()
                for k in (
                    "columns",
                    "greetingName",
                    "theme",
                    "weatherEnabled",
                    "weatherCity",
                    "screensaverMinutes",
                    "autoRenewDevMode",
                    "showHeroShelf",
                    "dockApps",
                    "hiddenApps",
                ):
                    if k in body:
                        current[k] = body[k]
                write_current_config(current)
                ipk = build_launcher_ipk()
                self._send_json({
                    "ok": True,
                    "config": current,
                    "ipkSize": ipk.stat().st_size,
                })
                return

            if path == "/api/wallpaper":
                data_url = body.get("dataUrl", "")
                if "," in data_url:
                    _, b64_part = data_url.split(",", 1)
                    raw_img = base64.b64decode(b64_part)
                    wp_target = LAUNCHER_DIR / "wallpapers" / "aurora.jpg"
                    wp_target.write_bytes(raw_img)
                    build_launcher_ipk()
                    self._send_json({"ok": True, "bytes": len(raw_img)})
                    return
                self._send_json({"ok": False, "error": "Invalid image dataUrl"}, status=400)
                return

            if path == "/api/sync":
                host = str(body.get("host", "")).strip()
                if not host:
                    self._send_json({"ok": False, "error": "Enter your LG TV's IPv4 address first."}, status=400)
                    return
                inv = asyncio.run(sync_tv_inventory(host, list_only=False))
                build_launcher_ipk()
                self._send_json({"ok": True, "inventory": inv})
                return

            if path == "/api/deploy":
                host = str(body.get("host", "")).strip()
                passphrase = str(body.get("passphrase", "")).strip()
                auto_renew = bool(body.get("autoRenew", True))
                if not host:
                    self._send_json({"ok": False, "error": "Enter your LG TV's IPv4 address first."}, status=400)
                    return
                logs = []
                res = deploy_to_tv(host, passphrase, auto_renew=auto_renew, progress=lambda m: logs.append(m))
                self._send_json({"ok": True, "result": res, "logs": logs})
                return

            if path == "/api/debloat-action":
                host = str(body.get("host", "")).strip()
                target = str(body.get("target", "general")).strip()
                if not host:
                    self._send_json({"ok": False, "error": "Enter your LG TV's IPv4 address first."}, status=400)
                    return
                res = asyncio.run(open_tv_settings_screen(host, target))
                self._send_json({"ok": True, "result": res})
                return

            if path == "/api/uninstall":
                host = str(body.get("host", "")).strip()
                passphrase = str(body.get("passphrase", "")).strip()
                if not host:
                    self._send_json({"ok": False, "error": "Enter your LG TV's IPv4 address first."}, status=400)
                    return
                logs = []
                res = uninstall_from_tv(host, passphrase, progress=lambda m: logs.append(m))
                self._send_json({"ok": True, "result": res, "logs": logs})
                return

            self._send_json({"ok": False, "error": f"Unknown endpoint {path}"}, status=404)
        except Exception as e:
            traceback.print_exc()
            self._send_json({"ok": False, "error": str(e)}, status=500)


def main():
    write_current_config(read_current_config())
    build_launcher_ipk()
    port = int(os.environ.get("PORT", "8780"))
    server = ThreadingHTTPServer(("0.0.0.0", port), StudioHandler)
    url = f"http://localhost:{port}"
    print(f"\n==================================================================")
    print(f"  CleanYourTV · LG QNED83SRA Liquid Glass Studio")
    print(f"  Dashboard & Installer UI:  {url}")
    print(f"  Full-Screen TV Preview:    {url}/tv/")
    print(f"==================================================================\n")
    if "--no-browser" not in sys.argv:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Studio server.")


if __name__ == "__main__":
    main()
