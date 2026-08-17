#!/bin/bash
# Starts a Wi-Fi setup hotspot (NetworkManager AP) if no Wi-Fi client
# connection comes up within WAIT_SECONDS after boot. Lets a phone/computer
# join the Pi's own SSID and use the web UI's Wi-Fi settings to pick a
# real network. Installed as the wifi-fallback.service systemd unit.
set -u

HOTSPOT_NAME="PiRadio-Setup"
HOTSPOT_PASSWORD="piradio1234"
WIFI_IFACE="wlan0"
WAIT_SECONDS=25

is_wifi_connected() {
    nmcli -t -f TYPE,STATE,CONNECTION con show --active 2>/dev/null \
        | awk -F: -v name="$HOTSPOT_NAME" \
            '$1=="802-11-wireless" && $2=="activated" && $3!=name {found=1} END{exit !found}'
}

for _ in $(seq 1 "$WAIT_SECONDS"); do
    if is_wifi_connected; then
        echo "Wi-Fi already connected, hotspot fallback not needed."
        exit 0
    fi
    sleep 1
done

echo "No Wi-Fi connection detected after ${WAIT_SECONDS}s, starting setup hotspot ($HOTSPOT_NAME)."

if ! nmcli connection show "$HOTSPOT_NAME" >/dev/null 2>&1; then
    nmcli connection add type wifi ifname "$WIFI_IFACE" con-name "$HOTSPOT_NAME" autoconnect no ssid "$HOTSPOT_NAME"
fi

nmcli connection modify "$HOTSPOT_NAME" \
    802-11-wireless.mode ap \
    802-11-wireless.band bg \
    ipv4.method shared \
    wifi-sec.key-mgmt wpa-psk \
    wifi-sec.psk "$HOTSPOT_PASSWORD"

nmcli connection up "$HOTSPOT_NAME"
