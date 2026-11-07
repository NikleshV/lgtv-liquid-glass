#!/usr/bin/env python3
"""
LG webOS No-Root Developer Mode Deployer for LG QNED83SRA (Windows, macOS, Linux).
- Fetches the encrypted SSH key from `http://<TV_HOST>:9991/webos_rsa` and unlocks it with the 6-char Passphrase
- Pairs with the TV's SSAP service (`wss://<TV_HOST>:3001`) to sync installed apps, icons, and HDMI inputs
- Builds the personalized `com.gathin.tvhome_1.11.0_all.ipk` (Liquid Glass Home + Auto-Renewal Service)
- Uploads and installs both `com.local.nativehome_0.6.19_arm.ipk` (On-TV Home Helper) and `com.gathin.tvhome`
- Provisions `ssap-key.json` and `apps.json` into the Home Helper state directory
- Starts `com.local.nativehome` and optionally enables Developer Mode 999h Auto-Renewal
"""
import argparse
import asyncio
import base64
import hashlib
import io
import json
from pathlib import Path
import shlex
import time
import urllib.request

from ipk_builder import build_launcher_ipk, DIST_DIR, LAUNCHER_DIR
from lgtv_ssap import sync_tv_inventory, load_saved_keys

HERE = Path(__file__).resolve().parent
KEYS_DIR = HERE / ".keys"

HOME_APP_ID = "com.gathin.tvhome"
HELPER_APP_ID = "com.local.nativehome"
HELPER_STATE_DIR = f"/media/developer/apps/usr/palm/applications/{HELPER_APP_ID}/state"


def fetch_and_unlock_dev_key(host: str, passphrase: str):
    """Downloads the encrypted RSA key from LG Developer Mode Key Server (:9991) and unlocks it."""
    import paramiko

    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    saved_pem = KEYS_DIR / f"devkey_{host.replace('.', '_')}.pem"

    if not passphrase and saved_pem.exists():
        return paramiko.RSAKey.from_private_key_file(str(saved_pem))

    url = f"http://{host}:9991/webos_rsa"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url, timeout=10) as resp:
            raw_pem = resp.read(65536).decode("utf-8", errors="replace")
    except Exception as e:
        if saved_pem.exists():
            return paramiko.RSAKey.from_private_key_file(str(saved_pem))
        raise RuntimeError(
            f"Could not reach LG Key Server at {url}. Make sure 'Developer Mode' is open on your TV "
            f"and the 'Key Server' switch is turned ON. ({e})"
        )

    try:
        pkey = paramiko.RSAKey.from_private_key(io.StringIO(raw_pem), password=passphrase.strip())
    except Exception as e:
        raise RuntimeError(
            f"Could not unlock Developer Mode key with passphrase '{passphrase}'. "
            f"Check the 6-character case-sensitive Passphrase shown on the TV's Developer Mode screen. ({e})"
        )

    out = io.StringIO()
    pkey.write_private_key(out)
    saved_pem.write_text(out.getvalue(), encoding="utf-8")
    return pkey


def connect_dev_ssh(host: str, passphrase: str = ""):
    """Connects to LG Developer Mode SSH (`prisoner@<TV_HOST>:9922`)."""
    import paramiko

    pkey = fetch_and_unlock_dev_key(host, passphrase)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    # LG webOS Developer Mode OpenSSH often requires legacy ssh-rsa signatures
    client.connect(
        hostname=host,
        port=9922,
        username="prisoner",
        pkey=pkey,
        timeout=12,
        banner_timeout=12,
        auth_timeout=15,
        allow_agent=False,
        look_for_keys=False,
        disabled_algorithms={"pubkeys": ["rsa-sha2-512", "rsa-sha2-256"]},
    )
    return client


def ssh_run(client, command: str, stdin_bytes: bytes | None = None, timeout: float = 60.0) -> str:
    transport = client.get_transport()
    if transport is None or not transport.is_active():
        raise RuntimeError("TV SSH connection is not active.")
    chan = transport.open_session(timeout=10)
    chan.settimeout(timeout)
    chan.exec_command(command)
    if stdin_bytes is not None:
        chan.sendall(stdin_bytes)
        chan.shutdown_write()

    out = bytearray()
    err = bytearray()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if chan.recv_ready():
            out.extend(chan.recv(65536))
        elif chan.recv_stderr_ready():
            err.extend(chan.recv_stderr(65536))
        elif chan.exit_status_ready():
            while chan.recv_ready():
                out.extend(chan.recv(65536))
            while chan.recv_stderr_ready():
                err.extend(chan.recv_stderr(65536))
            status = chan.recv_exit_status()
            chan.close()
            if status != 0:
                raise RuntimeError(
                    f"TV SSH command exited with {status}: {err.decode('utf-8', errors='replace').strip()}"
                )
            return out.decode("utf-8", errors="replace")
        else:
            time.sleep(0.03)
    chan.close()
    raise RuntimeError("TV SSH command timed out.")


def ssh_upload_verified(client, remote_path: str, data: bytes, mode: str = "644") -> None:
    digest = hashlib.sha256(data).hexdigest()
    b64 = base64.b64encode(data).decode("ascii")
    parent = remote_path.rsplit("/", 1)[0]
    cmd = (
        f"umask 077; mkdir -p {shlex.quote(parent)}; "
        f"tmp=$(mktemp {shlex.quote(parent + '/.upload.XXXXXX')}); "
        f"trap 'rm -f \"$tmp\"' EXIT; "
        f"cat > \"$tmp.b64\"; base64 -d \"$tmp.b64\" > \"$tmp\"; rm -f \"$tmp.b64\"; "
        f"chmod {mode} \"$tmp\"; "
        f"[ \"$(sha256sum \"$tmp\" | cut -d ' ' -f 1)\" = '{digest}' ] && "
        f"mv -f \"$tmp\" {shlex.quote(remote_path)} && printf 'CYTV_UPLOAD_OK'"
    )
    reply = ssh_run(client, cmd, stdin_bytes=b64.encode("ascii"), timeout=120.0)
    if "CYTV_UPLOAD_OK" not in reply:
        raise RuntimeError(f"Upload verification failed for {remote_path}: {reply}")


def luna_install_ipk(client, remote_ipk_path: str, timeout: float = 90.0) -> dict:
    """Installs an uploaded `.ipk` package on webOS via `com.webos.appInstallService/dev/install`."""
    payload = json.dumps(
        {"id": "com.ares.defaultName", "ipkUrl": remote_ipk_path, "subscribe": True},
        separators=(",", ":"),
    )
    cmd = f"/usr/bin/luna-send-pub -i luna://com.webos.appInstallService/dev/install {shlex.quote(payload)}"
    transport = client.get_transport()
    chan = transport.open_session(timeout=10)
    chan.settimeout(timeout)
    chan.exec_command(cmd)

    deadline = time.monotonic() + timeout
    buf = ""
    last_msg = {}
    try:
        while time.monotonic() < deadline:
            if chan.recv_ready():
                buf += chan.recv(65536).decode("utf-8", errors="replace")
                for line in buf.splitlines():
                    line = line.strip()
                    if not line.startswith("{"):
                        continue
                    try:
                        msg = json.loads(line)
                        last_msg = msg
                    except Exception:
                        continue
                    details_state = str(msg.get("details", {}).get("state", "")).lower()
                    status_val = str(msg.get("statusValue", "")).lower()
                    if msg.get("returnValue") is False or "error" in details_state or "fail" in details_state:
                        raise RuntimeError(f"webOS rejected package install: {msg}")
                    if "installed" in details_state or "success" in details_state or msg.get("statusValue") == 30:
                        return msg
            elif chan.exit_status_ready():
                break
            else:
                time.sleep(0.1)
    finally:
        chan.close()
    return last_msg


def stop_existing_helper(client) -> None:
    """Safely stops `com.local.nativehome` if it is already running before replacing packages."""
    stop_cmd = (
        f"if [ -f {HELPER_STATE_DIR}/controller.pid ]; then "
        f"printf '{{\"cmd\":\"stop\"}}' > {HELPER_STATE_DIR}/control.json; "
        f"n=0; while [ -e {HELPER_STATE_DIR}/controller.pid ] && [ \"$n\" -lt 12 ]; do "
        f"n=$((n+1)); sleep 1; done; fi"
    )
    try:
        ssh_run(client, stop_cmd, timeout=20.0)
    except Exception:
        pass


def deploy_to_tv(
    host: str,
    passphrase: str = "",
    auto_renew: bool = True,
    progress=print,
) -> dict:
    """Full end-to-end No-Root setup & installation on an LG webOS TV."""
    progress(f"1/6 Connecting to LG Developer Mode SSH at {host}:9922...")
    client = connect_dev_ssh(host, passphrase)
    try:
        echo_check = ssh_run(client, "echo CYTV_SSH_OK && uname -m").strip()
        if "CYTV_SSH_OK" not in echo_check:
            raise RuntimeError("Could not confirm SSH command execution on TV.")

        progress(f"2/6 Pairing with TV SSAP service (accept prompt on TV if shown) & syncing apps/icons...")
        inv = asyncio.run(sync_tv_inventory(host, list_only=False))
        ssap_key = inv.get("key") or load_saved_keys().get(host)
        if not ssap_key:
            raise RuntimeError("Missing SSAP pairing key. Accept the pairing prompt on the TV screen.")

        progress("3/6 Building personalized Liquid Glass Home IPK (`com.gathin.tvhome`)...")
        launcher_ipk = build_launcher_ipk()
        helper_ipk = DIST_DIR / "com.local.nativehome_0.6.19_arm.ipk"

        progress("4/6 Uploading & installing On-TV Home Helper and Liquid Glass Home...")
        stop_existing_helper(client)

        remote_helper_ipk = "/tmp/cytv_helper.ipk"
        remote_launcher_ipk = "/tmp/cytv_launcher.ipk"

        ssh_upload_verified(client, remote_helper_ipk, helper_ipk.read_bytes(), mode="644")
        luna_install_ipk(client, remote_helper_ipk)

        ssh_upload_verified(client, remote_launcher_ipk, launcher_ipk.read_bytes(), mode="644")
        luna_install_ipk(client, remote_launcher_ipk)

        ssh_run(client, f"rm -f {remote_helper_ipk} {remote_launcher_ipk}")

        progress("5/6 Provisioning Home Helper SSAP key, watched app inventory & EIM input hook...")
        key_bytes = json.dumps({"key": ssap_key}).encode("utf-8")
        app_ids = [
            a["id"]
            for a in inv["apps"]
            if a["id"] not in (HOME_APP_ID, HELPER_APP_ID, "com.webos.app.home")
        ]
        apps_bytes = json.dumps(app_ids).encode("utf-8")

        ssh_upload_verified(client, f"{HELPER_STATE_DIR}/ssap-key.json", key_bytes, mode="640")
        ssh_upload_verified(client, f"{HELPER_STATE_DIR}/apps.json", apps_bytes, mode="644")

        # Register EIM device entry so TV boot routes cleanly
        try:
            ssh_run(
                client,
                "/usr/bin/luna-send-pub -n 1 luna://com.webos.service.eim/addDevice "
                '\'{"appId":"com.gathin.tvhome","pigImage":"","mvpdIcon":""}\'',
            )
        except Exception:
            pass

        progress("6/6 Starting On-TV Home Helper & launching Liquid Glass Home...")
        ssh_run(
            client,
            "/usr/bin/luna-send-pub -n 1 luna://com.webos.applicationManager/launch "
            '\'{"id":"com.local.nativehome","params":{"nativeHomeStart":true}}\'',
        )
        time.sleep(1.2)
        ssh_run(
            client,
            "/usr/bin/luna-send-pub -n 1 luna://com.webos.applicationManager/launch "
            '\'{"id":"com.gathin.tvhome"}\'',
        )

        if auto_renew:
            try:
                ssh_run(
                    client,
                    "/usr/bin/luna-send-pub -n 1 luna://com.gathin.tvhome.renewal/enable '{}'",
                )
            except Exception:
                pass

        progress("Done! Liquid Glass Home and On-TV Home Helper are now live on your LG QNED83SRA.")
        return {
            "ok": True,
            "host": host,
            "appsSynced": len(inv["apps"]),
            "inputsSynced": len(inv["inputs"]),
            "autoRenew": auto_renew,
        }
    finally:
        client.close()


def uninstall_from_tv(host: str, passphrase: str = "", progress=print) -> dict:
    """Stops Home Helper and cleanly removes both packages, returning the TV to stock LG Home."""
    progress(f"Connecting to {host}:9922 to restore stock LG Home...")
    client = connect_dev_ssh(host, passphrase)
    try:
        stop_existing_helper(client)
        for pkg in (HELPER_APP_ID, HOME_APP_ID):
            progress(f"Removing {pkg}...")
            payload = json.dumps({"id": pkg, "subscribe": True}, separators=(",", ":"))
            try:
                ssh_run(
                    client,
                    f"/usr/bin/luna-send-pub -n 3 luna://com.webos.appInstallService/dev/remove {shlex.quote(payload)}",
                    timeout=30.0,
                )
            except Exception:
                pass
        ssh_run(
            client,
            "/usr/bin/luna-send-pub -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"com.webos.app.home\"}'",
        )
        progress("Restored stock LG Home.")
        return {"ok": True}
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Deploy Liquid Glass Home to LG webOS TV (No-Root Developer Mode)")
    parser.add_argument("host", nargs="?", help="TV IPv4 address from Developer Mode app")
    parser.add_argument("--passphrase", "-p", default="", help="6-character Passphrase from Developer Mode Key Server")
    parser.add_argument("--uninstall", action="store_true", help="Remove custom launcher and restore stock LG Home")
    args = parser.parse_args()

    tv_ip = args.host or input("Enter LG TV IPv4 address (from Developer Mode app): ").strip()
    if args.uninstall:
        uninstall_from_tv(tv_ip, args.passphrase)
    else:
        pw = args.passphrase or input("Enter 6-character Developer Mode Passphrase (leave blank if already paired): ").strip()
        deploy_to_tv(tv_ip, pw)
