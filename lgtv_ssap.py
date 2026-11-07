#!/usr/bin/env python3
"""
LG webOS SSAP Client & App/Input Inventory Sync for LG QNED83SRA (No-Root).
Connects to wss://<TV_HOST>:3001 with an unsigned manifest (bypassing the 403 blacklisted certificate issue),
stores the client key in `.lgtv-key.json`, reads installed apps + icons + HDMI inputs, and writes `launcher/apps.js`.
"""
import asyncio
import json
import os
from pathlib import Path
import ssl
import sys
import urllib.request

HERE = Path(__file__).resolve().parent
KEY_FILE = HERE / ".lgtv-key.json"
LAUNCHER_DIR = HERE / "launcher"

PERMISSIONS = [
    "LAUNCH", "LAUNCH_WEBAPP", "APP_TO_APP", "CLOSE", "TEST_OPEN", "TEST_PROTECTED",
    "CONTROL_AUDIO", "CONTROL_DISPLAY", "CONTROL_INPUT_JOYSTICK", "CONTROL_INPUT_MEDIA_RECORDING",
    "CONTROL_INPUT_MEDIA_PLAYBACK", "CONTROL_INPUT_TV", "CONTROL_POWER", "CONTROL_TV_SCREEN",
    "READ_APP_STATUS", "READ_CURRENT_CHANNEL", "READ_INPUT_DEVICE_LIST", "READ_NETWORK_STATE",
    "READ_RUNNING_APPS", "READ_TV_CHANNEL_LIST", "WRITE_NOTIFICATION_TOAST", "READ_POWER_STATE",
    "READ_COUNTRY_INFO", "CONTROL_INPUT_TEXT", "CONTROL_MOUSE_AND_KEYBOARD", "READ_INSTALLED_APPS",
    "READ_SETTINGS", "READ_STORAGE_DEVICE_LIST",
]


def insecure_ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def load_saved_keys() -> dict:
    try:
        if KEY_FILE.exists():
            return json.loads(KEY_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def save_key(host: str, key: str) -> None:
    keys = load_saved_keys()
    keys[host] = key
    KEY_FILE.write_text(json.dumps(keys, indent=2), encoding="utf-8")


async def connect_ssap(host: str, timeout: float = 45.0):
    import websockets

    keys = load_saved_keys()
    uri = f"wss://{host}:3001"
    try:
        ws = await websockets.connect(uri, ssl=insecure_ssl_context(), open_timeout=10, max_size=None)
    except Exception:
        # Fallback to ws://:3000 if firmware uses plain WS
        ws = await websockets.connect(f"ws://{host}:3000", open_timeout=10, max_size=None)

    payload = {
        "forcePairing": False,
        "pairingType": "PROMPT",
        "manifest": {
            "manifestVersion": 1,
            "appVersion": "1.1",
            "permissions": PERMISSIONS,
        },
    }
    if host in keys:
        payload["client-key"] = keys[host]
    else:
        print(f"[SSAP] Check your LG QNED83SRA screen ({host}) and click 'Accept' on the pairing prompt...")

    await ws.send(json.dumps({"type": "register", "id": "register_0", "payload": payload}))
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        msg = json.loads(raw)
        if msg.get("type") == "registered":
            client_key = msg.get("payload", {}).get("client-key", "")
            if client_key:
                save_key(host, client_key)
            return ws, client_key
        if msg.get("type") == "error":
            await ws.close()
            raise RuntimeError(f"LG TV rejected SSAP pairing: {msg.get('error')}")


async def ssap_call(ws, uri: str, payload: dict | None = None, counter=[0]) -> dict:
    counter[0] += 1
    req_id = f"req_{counter[0]}"
    await ws.send(json.dumps({"type": "request", "id": req_id, "uri": uri, "payload": payload or {}}))
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=20.0)
        msg = json.loads(raw)
        if msg.get("id") == req_id:
            return msg.get("payload", {})


async def sync_tv_inventory(host: str, list_only: bool = False) -> dict:
    ws, client_key = await connect_ssap(host)
    try:
        lp_res = await ssap_call(ws, "ssap://com.webos.applicationManager/listLaunchPoints")
        points = lp_res.get("launchPoints", [])
        inp_res = await ssap_call(ws, "ssap://tv/getExternalInputList")
        inputs = inp_res.get("devices", [])
    finally:
        await ws.close()

    if list_only:
        for p in points:
            print(f"{p.get('id', ''):45} {p.get('title', '')}")
        return {"apps": points, "inputs": inputs, "key": client_key}

    icon_dir = LAUNCHER_DIR / "icons"
    icon_dir.mkdir(parents=True, exist_ok=True)
    ctx = insecure_ssl_context()

    synced_apps = []
    for p in points:
        if p.get("hidden"):
            continue
        app_id = p.get("id", "")
        title = p.get("title", app_id)
        icon_url = p.get("largeIcon") if str(p.get("largeIcon", "")).startswith("http") else p.get("icon")
        safe_icon_name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in app_id) + ".png"
        icon_rel = ""
        if icon_url and str(icon_url).startswith("http"):
            try:
                data = urllib.request.urlopen(icon_url, context=ctx, timeout=8).read()
                (icon_dir / safe_icon_name).write_bytes(data)
                icon_rel = f"icons/{safe_icon_name}"
            except Exception as e:
                print(f"  [warn] Could not fetch icon for {app_id}: {e}")

        synced_apps.append({
            "id": app_id,
            "title": title,
            "icon": icon_rel,
            "iconColor": p.get("iconColor") or p.get("bgColor") or "",
        })

    synced_inputs = [
        {
            "appId": d["appId"],
            "id": d.get("id", d["appId"]),
            "label": d.get("label") or d.get("id") or d["appId"],
            "connected": bool(d.get("connected", True)),
        }
        for d in inputs
        if d.get("appId")
    ]

    inventory = {"apps": synced_apps, "inputs": synced_inputs}
    apps_js = LAUNCHER_DIR / "apps.js"
    apps_js.write_text(
        "// Auto-generated by lgtv_ssap.py from your LG QNED83SRA\n"
        "window.TV_APPS = " + json.dumps(inventory, indent=2, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"[SSAP] Synced {len(synced_apps)} apps and {len(synced_inputs)} HDMI inputs from {host}.")
    return {"apps": synced_apps, "inputs": synced_inputs, "key": client_key}


async def open_tv_settings_screen(host: str, target: str = "general") -> dict:
    """Remotely opens a specific LG Settings panel or toast on the TV for the Debloat Wizard."""
    ws, _ = await connect_ssap(host)
    try:
        await ssap_call(
            ws,
            "ssap://system.notifications/createToast",
            {"message": f"CleanYourTV: Opening LG {target.title()} Settings..."},
        )
        res = await ssap_call(
            ws,
            "ssap://system.launcher/launch",
            {"id": "com.palm.app.settings", "params": {"target": target}},
        )
        return res
    finally:
        await ws.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    tv_host = args[0] if args else os.environ.get("TV_HOST")
    if not tv_host:
        sys.exit("Usage: python lgtv_ssap.py <TV_IP> [--list]")
    asyncio.run(sync_tv_inventory(tv_host, list_only="--list" in sys.argv))
