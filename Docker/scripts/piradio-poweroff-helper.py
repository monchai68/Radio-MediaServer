#!/usr/bin/env python3
"""Host-side helper: listens on a Unix socket and powers off the Pi 3B host on request.

Runs OUTSIDE the Docker container (installed directly on the Pi 3B host as a systemd
service) so the unprivileged container can trigger a real shutdown without needing
`sudo`/extra Linux capabilities inside the container itself.
"""
import os
import socket
import subprocess

SOCKET_PATH = "/run/piradio/poweroff.sock"
COMMAND = b"poweroff"


def main():
    if os.path.exists(SOCKET_PATH):
        os.remove(SOCKET_PATH)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCKET_PATH)
    os.chmod(SOCKET_PATH, 0o600)

    server.listen(1)
    try:
        while True:
            conn, _ = server.accept()
            with conn:
                data = conn.recv(64).strip()
                if data == COMMAND:
                    conn.sendall(b"ok\n")
                    subprocess.run(["/sbin/poweroff"], check=False)
                else:
                    conn.sendall(b"unknown command\n")
    finally:
        server.close()
        if os.path.exists(SOCKET_PATH):
            os.remove(SOCKET_PATH)


if __name__ == "__main__":
    main()
