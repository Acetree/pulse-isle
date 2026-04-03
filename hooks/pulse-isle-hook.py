#!/usr/bin/env python3
"""
Pulse Isle Hook Script
Forwards Claude Code / Codex hook events to the Pulse Isle app via Unix socket.

Injected automatically by Pulse Isle into:
  Claude Code: ~/.claude/settings.json
  Codex:       ~/.codex/hooks.json

Usage: pulse-isle-hook.py [claude|codex]
"""

import sys
import json
import os
import socket as socket_module
import subprocess

SOCKET_PATH = "/tmp/pulse-isle.sock"
# Long timeout for PreToolUse — user may take a while to approve
TIMEOUT_SECS = 300

# Env vars that identify which terminal app is hosting this shell
_TERMINAL_ENV_KEYS = [
    "__CFBundleIdentifier",
    "TERM_PROGRAM",
    "CURSOR_TRACE_ID",
    "WINDSURF_EXTENSION",
    "WINDSURF_EXTENSION_VERSION",
    "VSCODE_PID",
    "WARP_IS_LOCAL_SHELL_SESSION",
    "WARP_SESSION_ID",
]


def _collect_terminal_meta():
    """Collect tty path, relevant env vars, and PID metadata for lifecycle checks."""
    env = {k: os.environ[k] for k in _TERMINAL_ENV_KEYS if k in os.environ}

    # Stderr fd is connected to the terminal even when stdin is piped
    try:
        tty = os.ttyname(2)
    except Exception:
        tty = ""

    current_pid = os.getpid()
    parent_pid = os.getppid()
    pid_chain = []
    shell_pid = None
    shell_comm = None
    try:
        pid = current_pid
        seen = set()
        while pid > 1 and len(pid_chain) < 20:
            if pid in seen:
                break
            seen.add(pid)
            result = subprocess.run(
                ["ps", "-p", str(pid), "-o", "ppid=,comm="],
                capture_output=True, text=True, timeout=2
            )
            if result.returncode != 0:
                break
            parts = result.stdout.strip().split(None, 1)
            if len(parts) < 2:
                break
            ppid, comm = int(parts[0]), parts[1].strip()
            pid_chain.append({"pid": pid, "comm": comm})
            lower_comm = comm.lower()
            if shell_pid is None and lower_comm in ("zsh", "bash", "sh", "fish"):
                shell_pid = pid
                shell_comm = comm
            if ppid <= 1:
                break
            pid = ppid
    except Exception:
        pass

    return tty, env, pid_chain, current_pid, parent_pid, shell_pid, shell_comm


def main():
    try:
        raw = sys.stdin.buffer.read()
        payload = json.loads(raw)
    except Exception:
        sys.exit(0)

    # Tag the source tool so Electron knows which tool fired this
    source = sys.argv[1] if len(sys.argv) > 1 else "claude"
    payload["_source"] = source

    # Attach terminal metadata (only on first events to reduce payload size)
    hook_event = payload.get("hook_event_name", "")
    if hook_event in ("SessionStart", "UserPromptSubmit"):
        tty, env, pid_chain, current_pid, parent_pid, shell_pid, shell_comm = _collect_terminal_meta()
        payload["_tty"] = tty
        payload["_env"] = env
        payload["_pid_chain"] = pid_chain
        payload["_pid_meta"] = {
            "current_pid": current_pid,
            "parent_pid": parent_pid,
            "shell_pid": shell_pid,
            "shell_comm": shell_comm,
        }

    try:
        s = socket_module.socket(socket_module.AF_UNIX, socket_module.SOCK_STREAM)
        s.settimeout(TIMEOUT_SECS)
        s.connect(SOCKET_PATH)

        s.sendall(json.dumps(payload).encode("utf-8"))
        # Signal we're done writing; server will respond then close
        s.shutdown(socket_module.SHUT_WR)

        # Read response from Electron
        chunks = []
        while True:
            try:
                chunk = s.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
            except socket_module.timeout:
                break

        s.close()

        if not chunks:
            sys.exit(0)

        response = json.loads(b"".join(chunks))
        behavior = (
            response
            .get("hookSpecificOutput", {})
            .get("decision", {})
            .get("behavior", "allow")
        )

        if behavior in ("reject", "deny"):
            reason = (
                response
                .get("hookSpecificOutput", {})
                .get("decision", {})
                .get("reason", "Blocked by Pulse Isle")
            )
            # Claude Code / Codex: exit 2 + JSON stdout blocks the tool call
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": payload.get("hook_event_name", ""),
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason
                }
            }))
            sys.exit(2)

    except Exception:
        # Pulse Isle not running or socket error — never block the tool
        pass

    sys.exit(0)


if __name__ == "__main__":
    main()
