"""
Deterministic webOS IPK Packager & Builder for Liquid Glass Home (`com.gathin.tvhome`)
and On-TV Home Helper (`com.local.nativehome`).
Works on Windows, macOS, and Linux with zero native binary compiler dependencies.
"""
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

HERE = Path(__file__).resolve().parent
LAUNCHER_DIR = HERE / "launcher"
RENEWAL_DIR = HERE / "renewal-service"
PACKAGES_DIR = HERE / "packages"
DIST_DIR = HERE / "dist"

IPK_MTIME = 1704067200  # Fixed non-zero timestamp required by webOS pkgverifier


def safe_name(name: str) -> str:
    path = PurePosixPath(name)
    if not name or path.is_absolute() or str(path) != name or ".." in path.parts or "\\" in name or "\x00" in name:
        raise ValueError(f"Unsafe package path: {name}")
    return name


def ar_archive(parts: dict[str, bytes]) -> bytes:
    result = bytearray(b"!<arch>\n")
    for name, data in parts.items():
        header = f"{name + '/':<16}{0:<12}{0:<6}{0:<6}{'100644':<8}{len(data):<10}`\n"
        result.extend(header.encode("ascii"))
        result.extend(data)
        if len(data) % 2:
            result.extend(b"\n")
    return bytes(result)


def tgz_archive(files: dict[str, bytes], executable=(), shared_directories=True) -> bytes:
    raw = io.BytesIO()
    dirs = set()
    for name in files:
        safe_name(name)
        dirs.update(
            str(p)
            for p in PurePosixPath(name).parents
            if str(p) != "." and (shared_directories or p.parts[:2] != ("usr", "palm") or len(p.parts) >= 4)
        )
    if not shared_directories:
        dirs.discard("usr")

    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name in sorted(dirs):
            entry = tarfile.TarInfo(name)
            entry.mtime = IPK_MTIME
            entry.type = tarfile.DIRTYPE
            entry.mode = 0o755
            if name in (
                "usr/palm/services/com.gathin.tvhome.renewal/state",
                "usr/palm/services/com.gathin.tvhome.renewal/state/home-control",
            ):
                # Shared prisoner:jailer setgid directory so Home Helper and Renewal Service can communicate
                entry.uid = 5999
                entry.gid = 5000
                entry.mode = 0o2770
                entry.uname = "prisoner"
                entry.gname = "jailer"
            archive.addfile(entry)

        for name, data in sorted(files.items()):
            entry = tarfile.TarInfo(name)
            entry.mtime = IPK_MTIME
            entry.size = len(data)
            entry.mode = 0o755 if name in executable else 0o644
            archive.addfile(entry, io.BytesIO(data))

    compressed = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=compressed, mode="wb", compresslevel=9, mtime=0) as packed:
        packed.write(raw.getvalue())
    return compressed.getvalue()


def build_launcher_ipk(output_path: Path | None = None) -> Path:
    """Packages `launcher/` + `renewal-service/` into `dist/com.gathin.tvhome_1.11.0_all.ipk`."""
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    appinfo = json.loads((LAUNCHER_DIR / "appinfo.json").read_text(encoding="utf-8"))
    app_id = appinfo["id"]
    version = appinfo["version"]

    service_info = json.loads((RENEWAL_DIR / "services.json").read_text(encoding="utf-8"))
    service_id = service_info["id"]

    files: dict[str, bytes] = {}
    for p in sorted(LAUNCHER_DIR.rglob("*")):
        if p.is_file():
            rel = p.relative_to(LAUNCHER_DIR).as_posix()
            files[f"usr/palm/applications/{app_id}/{rel}"] = p.read_bytes()

    for p in sorted(RENEWAL_DIR.rglob("*")):
        if p.is_file():
            rel = p.relative_to(RENEWAL_DIR).as_posix()
            if not rel.startswith("state/"):
                files[f"usr/palm/services/{service_id}/{rel}"] = p.read_bytes()

    files[f"usr/palm/services/{service_id}/state/home-control/.keep"] = b""
    files[f"usr/palm/packages/{app_id}/packageinfo.json"] = json.dumps(
        {"id": app_id, "version": version, "app": app_id, "services": [service_id]}
    ).encode("utf-8")

    control = (
        f"Package: {app_id}\n"
        f"Version: {version}\n"
        f"Architecture: all\n"
        f"Maintainer: CleanYourTV\n"
        f"Description: Liquid Glass Home for LG webOS\n"
    )
    ipk_bytes = ar_archive(
        {
            "debian-binary": b"2.0\n",
            "control.tar.gz": tgz_archive({"control": control.encode("utf-8")}),
            "data.tar.gz": tgz_archive(files, shared_directories=True),
        }
    )

    target = output_path or (DIST_DIR / f"{app_id}_{version}_all.ipk")
    target.write_bytes(ipk_bytes)

    # Also copy the verified ARM32 Home Helper IPK into dist/
    helper_src = PACKAGES_DIR / "com.local.nativehome_0.6.19_arm.ipk"
    helper_dst = DIST_DIR / "com.local.nativehome_0.6.19_arm.ipk"
    if helper_src.exists():
        helper_dst.write_bytes(helper_src.read_bytes())

    return target


if __name__ == "__main__":
    built = build_launcher_ipk()
    digest = hashlib.sha256(built.read_bytes()).hexdigest()
    print(f"Built {built.name} ({built.stat().st_size:,} bytes, SHA256={digest[:16]}...)")
