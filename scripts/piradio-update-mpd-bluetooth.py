#!/usr/bin/env python3
"""Update the bare-metal MPD Bluetooth output for one validated speaker MAC."""
import re
import subprocess
import sys

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


if __name__ == "__main__":
    sys.exit(0 if len(sys.argv) == 2 and update_bluetooth_output(sys.argv[1]) else 1)