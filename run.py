#!/usr/bin/env python3
"""
run.py — one-command launcher for Barber-brone.

What it does, in order:
  1. Preflight: Node + npm present, PostgreSQL reachable on :5432, .env files exist,
     ports 3000 and 5173 free.
  2. Install: `npm install` if `node_modules/` is missing (or `--reinstall`).
  3. Database: `prisma migrate deploy` (idempotent); `prisma db seed` if --seed.
  4. ngrok: queries http://localhost:4040/api/tunnels; if a tunnel forwards to :5173,
     syncs that URL into apps/backend/.env (WEBAPP_URL + CORS_EXTRA_ORIGINS).
  5. Launch: spawns the backend and webapp dev servers, prefixes their output with
     coloured [backend] / [webapp] tags, waits for ready markers.
  6. Park: leaves both running until Ctrl+C, then tears them down cleanly (including
     descendants — npm.cmd → node → tsx).

Standard library only. Tested on Windows + Python 3.10+.

Usage:
  python run.py                 # start everything
  python run.py --seed          # also (re-)seed services + settings
  python run.py --no-ngrok      # skip ngrok URL detection
  python run.py --reinstall     # force npm install
  python run.py --skip-migrate  # skip prisma migrate deploy
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional


# --------------------------------------------------------------------------- paths

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "apps" / "backend"
WEBAPP = ROOT / "apps" / "webapp"

IS_WINDOWS = os.name == "nt"
NPM = "npm.cmd" if IS_WINDOWS else "npm"

BACKEND_PORT = 3000
WEBAPP_PORT = 5173
PG_HOST = "localhost"
PG_PORT = 5432
NGROK_API = "http://localhost:4040/api/tunnels"
READY_TIMEOUT_SEC = 120


# --------------------------------------------------------------------------- colours

class C:
    RESET = "\033[0m"
    DIM = "\033[2m"
    BOLD = "\033[1m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    MAGENTA = "\033[95m"


def _enable_utf8_stdout() -> None:
    """Force UTF-8 on stdout/stderr so Unicode glyphs (→ ✓ ▶ …) don't crash cp1252 consoles."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


def _enable_windows_ansi() -> None:
    """Enable ANSI escape interpretation in legacy Windows consoles."""
    if not IS_WINDOWS:
        return
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        kernel32.SetConsoleMode(handle, 7)  # ENABLE_PROCESSED_OUTPUT | ENABLE_WRAP_AT_EOL_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING
    except Exception:
        pass


def step(msg: str) -> None:
    print(f"{C.CYAN}▶{C.RESET} {msg}", flush=True)


def ok(msg: str) -> None:
    print(f"{C.GREEN}✓{C.RESET} {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"{C.YELLOW}!{C.RESET} {msg}", flush=True)


def fail(msg: str) -> None:
    print(f"{C.RED}✗{C.RESET} {msg}", flush=True)


# --------------------------------------------------------------------------- preflight

def check_node() -> None:
    if not shutil.which(NPM):
        fail("npm not found on PATH. Install Node.js 20+ from https://nodejs.org/")
        sys.exit(1)
    try:
        node_v = subprocess.run(["node", "--version"], capture_output=True, text=True, check=True).stdout.strip()
        npm_v = subprocess.run([NPM, "--version"], capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        fail(f"node/npm unusable: {e}")
        sys.exit(1)
    ok(f"Node {node_v} · npm {npm_v}")


def tcp_open(host: str, port: int, timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def check_postgres() -> None:
    if not tcp_open(PG_HOST, PG_PORT):
        fail(f"PostgreSQL not reachable at {PG_HOST}:{PG_PORT}.")
        fail("   Start your local PostgreSQL service or run `docker compose up -d postgres`.")
        sys.exit(1)
    ok(f"PostgreSQL listening at {PG_HOST}:{PG_PORT}")


def check_env_files() -> None:
    if not (BACKEND / ".env").exists():
        fail(f"Missing {BACKEND / '.env'}. Copy from apps/backend/.env.example and fill it in.")
        sys.exit(1)
    if not (WEBAPP / ".env").exists():
        warn(f"Missing {WEBAPP / '.env'} (Vite will fall back to defaults).")
    ok(".env files present")


def check_ports_free() -> None:
    busy = [p for p in (BACKEND_PORT, WEBAPP_PORT) if tcp_open("127.0.0.1", p, timeout=0.5)]
    if busy:
        fail(f"Port(s) already in use: {', '.join(map(str, busy))}.")
        if IS_WINDOWS:
            fail(f"   Find the PID: `Get-NetTCPConnection -LocalPort {busy[0]}`")
            fail(f"   Kill it:      `Stop-Process -Id <pid>` or `taskkill /F /PID <pid>`")
        else:
            fail(f"   Find + kill: `lsof -i :{busy[0]} -t | xargs kill`")
        sys.exit(1)
    ok(f"Ports {BACKEND_PORT} and {WEBAPP_PORT} free")


# --------------------------------------------------------------------------- install

def ensure_deps(reinstall: bool) -> None:
    if (ROOT / "node_modules").exists() and not reinstall:
        ok("node_modules present (skip install)")
        return
    step("Installing dependencies (npm install) — first run can take several minutes...")
    r = subprocess.run([NPM, "install"], cwd=str(ROOT))
    if r.returncode != 0:
        fail("npm install failed.")
        sys.exit(1)
    ok("Dependencies installed")


def prisma_migrate() -> None:
    step("Applying Prisma migrations (deploy)...")
    r = subprocess.run(
        [NPM, "--workspace", "apps/backend", "exec", "--", "prisma", "migrate", "deploy"],
        cwd=str(ROOT),
    )
    if r.returncode != 0:
        fail("`prisma migrate deploy` failed.")
        fail("   If this is a fresh install, the DB may not exist yet. Create it:")
        fail("   psql -U postgres -c \"CREATE DATABASE barber_brone;\"")
        sys.exit(1)
    ok("Database schema up to date")


def prisma_seed() -> None:
    step("Running prisma seed...")
    r = subprocess.run([NPM, "--workspace", "apps/backend", "run", "db:seed"], cwd=str(ROOT))
    if r.returncode != 0:
        fail("Seed failed.")
        sys.exit(1)
    ok("Seed complete")


# --------------------------------------------------------------------------- ngrok

def get_ngrok_public_url(target_port: int) -> Optional[str]:
    try:
        with urllib.request.urlopen(NGROK_API, timeout=1.5) as resp:
            data = json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError, OSError):
        return None
    # Prefer https tunnel targeting the requested local port
    for t in data.get("tunnels", []):
        cfg = t.get("config") or {}
        addr = cfg.get("addr", "")
        if addr.endswith(f":{target_port}") and t.get("proto") == "https":
            return t.get("public_url")
    # Fallback: any https tunnel
    for t in data.get("tunnels", []):
        if t.get("proto") == "https":
            return t.get("public_url")
    return None


def patch_env_file(path: Path, mutations: dict[str, str | None], cors_add: Optional[str] = None) -> None:
    """Rewrite KEY=VALUE pairs in-place. Keys not present are appended.
    Also optionally adds `cors_add` to the comma-separated CORS_EXTRA_ORIGINS list."""
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    written: set[str] = set()
    out: list[str] = []
    for line in lines:
        replaced = False
        for k, v in mutations.items():
            if v is None:
                continue
            if line.startswith(f"{k}="):
                out.append(f"{k}={v}")
                written.add(k)
                replaced = True
                break
        if not replaced:
            out.append(line)
    for k, v in mutations.items():
        if v is None or k in written:
            continue
        out.append(f"{k}={v}")

    if cors_add:
        cors_idx = next((i for i, ln in enumerate(out) if ln.startswith("CORS_EXTRA_ORIGINS=")), None)
        if cors_idx is None:
            out.append(f"CORS_EXTRA_ORIGINS={cors_add}")
        else:
            current = out[cors_idx].split("=", 1)[1]
            origins = [o.strip() for o in current.split(",") if o.strip()]
            if cors_add not in origins:
                origins.append(cors_add)
                out[cors_idx] = "CORS_EXTRA_ORIGINS=" + ",".join(origins)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def sync_ngrok() -> Optional[str]:
    public = get_ngrok_public_url(WEBAPP_PORT)
    if not public:
        warn("ngrok not running or no tunnel to :5173 — skipping URL sync.")
        warn("   Start a tunnel with:  ngrok http 5173")
        return None
    env_path = BACKEND / ".env"
    current = ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("WEBAPP_URL="):
            current = line.split("=", 1)[1].strip()
            break
    if current == public:
        ok(f"ngrok URL already set: {public}")
    else:
        patch_env_file(env_path, {"WEBAPP_URL": public}, cors_add=public)
        ok(f"WEBAPP_URL updated → {public}")
    return public


# --------------------------------------------------------------------------- dev procs

class DevProc:
    """Spawn a long-running dev command, tail its output with a colored prefix, and
    surface a readiness signal — either a log-line regex *or* a TCP port becoming
    listenable. Tools like Vite suppress their banner when stdout isn't a TTY, so
    the port probe is the reliable fallback."""

    def __init__(
        self,
        name: str,
        cmd: list[str],
        color: str,
        ready_pattern: Optional[re.Pattern[str]] = None,
        ready_port: Optional[int] = None,
    ) -> None:
        self.name = name
        self.cmd = cmd
        self.color = color
        self.ready_pattern = ready_pattern
        self.ready_port = ready_port
        self.ready_event = threading.Event()
        self.proc: Optional[subprocess.Popen] = None
        self.thread: Optional[threading.Thread] = None
        self.probe_thread: Optional[threading.Thread] = None

    def start(self) -> None:
        kwargs: dict = {
            "cwd": str(ROOT),
            "stdin": subprocess.DEVNULL,  # npm/vite can hang on Windows if stdin is a pipe with no TTY
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "bufsize": 1,
            "text": True,
            "encoding": "utf-8",
            "errors": "replace",
        }
        if IS_WINDOWS:
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        self.proc = subprocess.Popen(self.cmd, **kwargs)
        self.thread = threading.Thread(target=self._pump, name=f"pump-{self.name}", daemon=True)
        self.thread.start()
        if self.ready_port is not None:
            self.probe_thread = threading.Thread(target=self._probe_port, name=f"probe-{self.name}", daemon=True)
            self.probe_thread.start()

    def _probe_port(self) -> None:
        """Poll the configured port every 500 ms; first successful connect flips the ready flag."""
        while not self.ready_event.is_set():
            if not self.alive:
                return
            if self.ready_port is not None and tcp_open("127.0.0.1", self.ready_port, timeout=0.5):
                self.ready_event.set()
                return
            time.sleep(0.5)

    def _pump(self) -> None:
        if not self.proc or not self.proc.stdout:
            return
        prefix = f"{self.color}[{self.name:>7}]{C.RESET}"
        ansi_re = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
        try:
            for raw in self.proc.stdout:
                line = raw.rstrip("\r\n")
                if not line:
                    continue
                print(f"{prefix} {line}", flush=True)
                if self.ready_pattern is not None and not self.ready_event.is_set():
                    clean = ansi_re.sub("", line)
                    if self.ready_pattern.search(clean):
                        self.ready_event.set()
        except Exception:
            # Stream closed during shutdown — fine.
            pass

    @property
    def alive(self) -> bool:
        return bool(self.proc and self.proc.poll() is None)

    def stop(self) -> None:
        if not self.proc or self.proc.poll() is not None:
            return
        if IS_WINDOWS:
            # taskkill /T walks the process tree (npm.cmd → node → tsx), /F forces termination.
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(self.proc.pid)],
                    capture_output=True,
                    timeout=5,
                )
            except Exception:
                pass
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    self.proc.kill()
                except Exception:
                    pass
        else:
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
                self.proc.wait(timeout=8)
            except (subprocess.TimeoutExpired, ProcessLookupError, OSError):
                try:
                    self.proc.kill()
                except Exception:
                    pass


# --------------------------------------------------------------------------- main

def print_banner(public_url: Optional[str]) -> None:
    lines = [
        "",
        f"  {C.BOLD}{C.GREEN}🎉 Barber-brone is live{C.RESET}",
        "",
        f"  Backend (API)    {C.CYAN}http://localhost:{BACKEND_PORT}{C.RESET}",
        f"  Webapp (Vite)    {C.CYAN}http://localhost:{WEBAPP_PORT}{C.RESET}",
    ]
    if public_url:
        lines.append(f"  Public Mini App  {C.CYAN}{public_url}{C.RESET}")
    else:
        lines.append(f"  Public Mini App  {C.DIM}(no ngrok — localhost only){C.RESET}")
    lines += [
        "",
        f"  {C.DIM}Press Ctrl+C to stop both servers.{C.RESET}",
        "",
    ]
    print("\n".join(lines), flush=True)


def main() -> int:
    _enable_utf8_stdout()
    _enable_windows_ansi()

    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--seed", action="store_true", help="Run prisma seed before starting.")
    parser.add_argument("--no-ngrok", action="store_true", help="Skip ngrok tunnel detection.")
    parser.add_argument("--reinstall", action="store_true", help="Force `npm install` even if node_modules exists.")
    parser.add_argument("--skip-migrate", action="store_true", help="Skip prisma migrate deploy.")
    args = parser.parse_args()
    print(f"\n{C.BOLD}{C.MAGENTA}=== Barber-brone launcher ==={C.RESET}", flush=True)
    print(f"  {C.DIM}root: {ROOT}{C.RESET}\n", flush=True)

    # Preflight ---------------------------------------------------------------
    check_node()
    check_postgres()
    check_env_files()
    check_ports_free()

    # Setup -------------------------------------------------------------------
    ensure_deps(reinstall=args.reinstall)
    if not args.skip_migrate:
        prisma_migrate()
    if args.seed:
        prisma_seed()

    # ngrok -------------------------------------------------------------------
    public_url: Optional[str] = None
    if not args.no_ngrok:
        public_url = sync_ngrok()

    # Launch ------------------------------------------------------------------
    step("Starting backend and webapp dev servers...")
    backend = DevProc(
        "backend",
        [NPM, "run", "dev:backend"],
        C.BLUE,
        ready_pattern=re.compile(r"HTTP API listening|Server listening at"),
        ready_port=BACKEND_PORT,
    )
    webapp = DevProc(
        "webapp",
        [NPM, "run", "dev:webapp"],
        C.MAGENTA,
        ready_port=WEBAPP_PORT,
    )
    backend.start()
    webapp.start()

    deadline = time.monotonic() + READY_TIMEOUT_SEC
    while time.monotonic() < deadline:
        if backend.ready_event.is_set() and webapp.ready_event.is_set():
            break
        if not backend.alive:
            fail("backend exited before reporting ready.")
            webapp.stop()
            return 1
        if not webapp.alive:
            fail("webapp exited before reporting ready.")
            backend.stop()
            return 1
        time.sleep(0.3)
    else:
        warn(f"Timed out waiting for ready signal after {READY_TIMEOUT_SEC}s — servers may still be starting.")

    print_banner(public_url)

    # Park until something exits or Ctrl+C ------------------------------------
    exit_code = 0
    try:
        while backend.alive and webapp.alive:
            time.sleep(0.5)
        if not backend.alive:
            warn(f"backend exited (code {backend.proc.returncode if backend.proc else '?'}).")
            exit_code = 1
        if not webapp.alive:
            warn(f"webapp exited (code {webapp.proc.returncode if webapp.proc else '?'}).")
            exit_code = 1
    except KeyboardInterrupt:
        print(f"\n{C.YELLOW}↩ Shutting down…{C.RESET}", flush=True)
    finally:
        backend.stop()
        webapp.stop()
        ok("Stopped. Bye!")
    return exit_code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
