#!/bin/bash
# Starts a Wi-Fi setup hotspot (NetworkManager AP) if no network connectivity
# is detected within WAIT_SECONDS after boot. Lets a phone/computer join the
# Pi's own SSID and use the web UI's Wi-Fi settings to pick a real network.
#
# Installed as the wifi-fallback.service systemd unit.
#
# v2026-10-01 — fixed false-positive hotspot trigger:
#   - Checks for ethernet connectivity before hotspot activation
#   - Verifies actual internet reachability (ping gateway or 8.8.8.8)
#   - Retries Wi-Fi saved profiles more aggressively when autoconnect fails
#   - State stamp: once internet is reached on this boot, never start hotspot
set -u

HOTSPOT_NAME="PiRadio-Setup"
HOTSPOT_PASSWORD="piradio1234"
WIFI_IFACE="wlan0"
ETHERNET_IFACE="eth0"
WAIT_SECONDS=90              # increased from 60 for slow Pi Zero 2 W
PING_TARGETS=("8.8.8.8" "1.1.1.1")
CONNECTED_STAMP="/var/run/wifi-fallback-online.stamp"

log() {
    echo "[wifi-fallback] $(date '+%Y-%m-%d %H:%M:%S') $*"
}

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

list_saved_wifi_profiles() {
    nmcli -t -f NAME,TYPE con show 2>/dev/null \
        | awk -F: -v hotspot="$HOTSPOT_NAME" \
            '$2=="802-11-wireless" && $1!=hotspot {print $1}'
}

has_saved_wifi_profiles() {
    local profiles
    profiles="$(list_saved_wifi_profiles)"
    [ -n "$profiles" ]
}

is_wifi_connected() {
    nmcli -t -f TYPE,STATE,CONNECTION con show --active 2>/dev/null \
        | awk -F: -v name="$HOTSPOT_NAME" \
            '$1=="802-11-wireless" && $2=="activated" && $3!=name {found=1} END{exit !found}'
}

is_ethernet_up() {
    nmcli -t -f TYPE,STATE con show --active 2>/dev/null \
        | awk -F: '$1=="802-3-ethernet" && $2=="activated" {found=1} END{exit !found}'
}

has_any_interface_internet() {
    local target
    for target in "${PING_TARGETS[@]}"; do
        if ping -c 1 -W 3 "$target" >/dev/null 2>&1; then
            return 0
        fi
    done
    return 1
}

has_been_online_this_boot() {
    [ -f "$CONNECTED_STAMP" ]
}

mark_online_this_boot() {
    touch "$CONNECTED_STAMP" 2>/dev/null || true
}

clear_online_stamp() {
    rm -f "$CONNECTED_STAMP" 2>/dev/null || true
}

try_bring_up_saved_profiles() {
    local profiles
    profiles="$(list_saved_wifi_profiles)"
    if [ -z "$profiles" ]; then
        return 1
    fi

    log "Saved WiFi profile(s) found: $(echo "$profiles" | tr '\n' ' ') — trying to bring them up..."
    while IFS= read -r profile; do
        if [ -n "$profile" ]; then
            log "Attempting to bring up saved profile: $profile"
            nmcli con up "$profile" 2>/dev/null && {
                # Give it time to settle and get a DHCP lease
                log "Profile '$profile' brought up; waiting 5s for connectivity..."
                sleep 5
                if is_wifi_connected && has_any_interface_internet; then
                    log "Wi-Fi is now connected and internet reachable via saved profile: $profile"
                    mark_online_this_boot
                    return 0
                fi
            }
        fi
    done <<< "$profiles"
    return 1
}

# ------------------------------------------------------------------
# Phase 0: Remove stale stamp from previous boot
# ------------------------------------------------------------------
clear_online_stamp

# ------------------------------------------------------------------
# Phase 0.5: Already online? (ethernet, or wifi connected early)
# ------------------------------------------------------------------
if has_any_interface_internet; then
    log "Internet is already reachable (ethernet or fast wifi). Hotspot not needed."
    mark_online_this_boot
    exit 0
fi

if is_ethernet_up; then
    log "Ethernet is up; waiting a bit for internet... (hotspot will be skipped if connectivity appears)"
    # Give DHCP a moment
    sleep 5
    if has_any_interface_internet; then
        log "Internet reachable via ethernet. Hotspot not needed."
        mark_online_this_boot
        exit 0
    fi
    log "Ethernet is link-up but no internet — will still try Wi-Fi before hotspot."
fi

# ------------------------------------------------------------------
# Phase 1: Wait up to WAIT_SECONDS for normal Wi-Fi to come up
# ------------------------------------------------------------------
log "Waiting up to ${WAIT_SECONDS}s for Wi-Fi to connect automatically..."

for i in $(seq 1 "$WAIT_SECONDS"); do
    # Shortcut: if internet becomes reachable through ANY interface, we're done
    if has_any_interface_internet; then
        log "Internet reachable (via wifi or ethernet) after ~${i}s. Hotspot not needed."
        mark_online_this_boot
        exit 0
    fi
    sleep 1
done

log "No internet connectivity detected after ${WAIT_SECONDS}s."

# ------------------------------------------------------------------
# Phase 2: Check for saved WiFi profiles and try to bring them up
# ------------------------------------------------------------------
if has_saved_wifi_profiles; then
    log "Saved WiFi profile(s) detected — trying to connect before opening hotspot..."

    # Try up to 5 times, waiting between attempts
    for attempt in 1 2 3 4 5; do
        log "Saved-profile connect attempt $attempt/5..."
        if try_bring_up_saved_profiles; then
            log "Connected using saved WiFi profile."
            exit 0
        fi
        # Network might not be ready yet
        sleep 5
    done

    log "Could not connect using saved profiles after 5 attempts."
else
    log "No saved WiFi profiles found."
fi

# ------------------------------------------------------------------
# Phase 2.5: One last connectivity check before activating hotspot
# ------------------------------------------------------------------
if has_any_interface_internet || is_ethernet_up; then
    log "Internet or ethernet became available while trying saved profiles. Skipping hotspot."
    mark_online_this_boot
    exit 0
fi

# ------------------------------------------------------------------
# Phase 3: Fall back to setup hotspot
# ------------------------------------------------------------------
log "Starting setup hotspot ($HOTSPOT_NAME) as last resort."

if ! nmcli connection show "$HOTSPOT_NAME" >/dev/null 2>&1; then
    log "Creating hotspot connection profile: $HOTSPOT_NAME"
    nmcli connection add type wifi ifname "$WIFI_IFACE" con-name "$HOTSPOT_NAME" autoconnect no ssid "$HOTSPOT_NAME"
fi

log "Configuring hotspot: $HOTSPOT_NAME"
nmcli connection modify "$HOTSPOT_NAME" \
    802-11-wireless.mode ap \
    802-11-wireless.band bg \
    ipv4.method shared \
    wifi-sec.key-mgmt wpa-psk \
    wifi-sec.psk "$HOTSPOT_PASSWORD"

log "Activating hotspot: $HOTSPOT_NAME"
if nmcli connection up "$HOTSPOT_NAME"; then
    log "Hotspot $HOTSPOT_NAME is now active."
else
    log "ERROR: Failed to activate hotspot $HOTSPOT_NAME."
fi
