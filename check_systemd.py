import paramiko

def check_systemd(ip, username, password):
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        ssh.connect(ip, username=username, password=password, timeout=10)
        print("Connected to remote Pi.\n")
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    commands = [
        "cat /etc/systemd/system/wifi-fallback.service 2>/dev/null || echo 'service file missing'",
        "cat /usr/local/bin/wifi-fallback.sh 2>/dev/null || echo 'bin script missing'",
        "sudo systemctl status wifi-fallback.service --no-pager 2>&1 || true",
    ]

    for cmd in commands:
        print(f"--- RUNNING: {cmd} ---")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        out = stdout.read().decode('utf-8', errors='ignore')
        err = stderr.read().decode('utf-8', errors='ignore')
        if out:
            print(out.strip())
        if err:
            print(f"ERROR: {err.strip()}")
        print()

    ssh.close()

if __name__ == "__main__":
    check_systemd("192.168.1.126", "monchai68", "Mon176177")
