#!/usr/bin/env python3
"""Host-side helper: listens on a Unix socket and powers off the Pi 3B host on request.

Runs OUTSIDE the Docker container (installed directly on the Pi 3B host as a systemd
service) so the unprivileged container can trigger a real shutdown without needing
`sudo`/extra Linux capabilities inside the container itself.
"""
import os
import re
import select
import socket
import subprocess

SOCKET_PATH = "/run/piradio/poweroff.sock"
MPD_CONFIG_SOCKET_PATH = "/run/piradio/mpd-config.sock"
POWEROFF_COMMAND = b"poweroff"
SET_BLUETOOTH_MAC_PREFIX = b"set-bluetooth-mac "
MPD_CONFIG_PATH = "/etc/mpd.conf"
MAC_PATTERN = re.compile(r"^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$")


def update_bluetooth_output(mac):
    if not MAC_PATTERN.fullmatch(mac):
        return False

    try:
        with open(MPD_CONFIG_PATH, encoding="utf-8") as config_file:
            config = config_file.read()
    except OSError:
        return False

    block_pattern = re.compile(r"(?ms)^audio_output\s*\{.*?^\}")
    bluetooth_block = next(
        (match for match in block_pattern.finditer(config)
         if re.search(r'^\s*name\s+"Bluetooth Speaker"\s*$', match.group(), re.MULTILINE)),
        None,
    )
    if bluetooth_block is None:
        return False

    block = bluetooth_block.group()
    device_line = re.compile(r'^\s*device\s+"[^"]*"\s*$', re.MULTILINE)
    replacement = f'    device          "bluealsa:DEV={mac},PROFILE=a2dp"'
    if not device_line.search(block):
        return False

    updated_block = device_line.sub(replacement, block, count=1)
    updated_config = config[:bluetooth_block.start()] + updated_block + config[bluetooth_block.end():]
    try:
        with open(MPD_CONFIG_PATH, "w", encoding="utf-8") as config_file:
            config_file.write(updated_config)
    except OSError:
        return False

    return subprocess.run(["/bin/systemctl", "restart", "mpd"], check=False).returncode == 0


def create_server(socket_path):
    if os.path.exists(socket_path):
        os.remove(socket_path)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(socket_path)
    os.chmod(socket_path, 0o600)
    server.listen(1)
    return server


def main():
    poweroff_server = create_server(SOCKET_PATH)
    mpd_config_server = create_server(MPD_CONFIG_SOCKET_PATH)
    try:
        while True:
            readable, _, _ = select.select([poweroff_server, mpd_config_server], [], [])
            for server in readable:
                conn, _ = server.accept()
                with conn:
                    data = conn.recv(64).strip()
                    if server is poweroff_server and data == POWEROFF_COMMAND:
                        conn.sendall(b"ok\n")
                        subprocess.run(["/sbin/poweroff"], check=False)
                    elif server is mpd_config_server and data.startswith(SET_BLUETOOTH_MAC_PREFIX):
                        mac = data[len(SET_BLUETOOTH_MAC_PREFIX):].decode("ascii", errors="ignore")
                        conn.sendall(b"ok\n" if update_bluetooth_output(mac) else b"error\n")
                    else:
                        conn.sendall(b"unknown command\n")
    finally:
        poweroff_server.close()
        mpd_config_server.close()
        for socket_path in (SOCKET_PATH, MPD_CONFIG_SOCKET_PATH):
            if os.path.exists(socket_path):
                os.remove(socket_path)


if __name__ == "__main__":
    main()
