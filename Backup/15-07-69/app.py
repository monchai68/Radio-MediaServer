from flask import Flask, jsonify, render_template
import subprocess
import json
import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static")
)

STATIONS_PATH = os.path.join(BASE_DIR, "stations.json")

with open(STATIONS_PATH, encoding="utf-8") as f:
    stations = json.load(f)


def mpc_cmd(command):
    try:
        subprocess.run(["mpc"] + command.split(), check=False)
        return True
    except FileNotFoundError:
        return False


def mpc_available():
    return mpc_cmd("status")


def parse_status_output(raw_status):
    if "[playing]" in raw_status:
        state = "playing"
    elif "[paused]" in raw_status:
        state = "paused"
    else:
        state = "stopped"

    vol_match = re.search(r"volume:\s*(\d+)%", raw_status)
    volume = int(vol_match.group(1)) if vol_match else None

    return state, volume


def safe_current_url():
    try:
        return subprocess.check_output(["mpc", "-f", "%file%", "current"]).decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def safe_current_field(field):
    try:
        return subprocess.check_output(["mpc", "-f", field, "current"]).decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def now_playing_metadata():
    artist = safe_current_field("%artist%")
    title = safe_current_field("%title%")
    raw = safe_current_field("%name%")

    # For some streams MPD exposes title as "Artist - Title".
    if not artist and title and " - " in title:
        parts = title.split(" - ", 1)
        artist = parts[0].strip()
        title = parts[1].strip()

    if not raw:
        raw = safe_current_field("%title%")

    text = " - ".join([x for x in [artist, title] if x])

    return {
        "artist": artist,
        "title": title,
        "text": text,
        "raw": raw
    }


@app.route("/")
def index():
    return render_template("index.html")



@app.route("/api/stations")
def get_stations():
    return jsonify(stations)


@app.route("/api/pause")
def pause():
    ok = mpc_cmd("pause")
    return {"status": "paused" if ok else "unavailable"}


@app.route("/api/resume")
def resume():
    ok = mpc_cmd("play")
    return {"status": "playing" if ok else "unavailable"}

@app.route("/api/poweroff")
def poweroff():
    try:
        subprocess.Popen(["sudo", "/sbin/poweroff"])
        status = "shutting down"
    except FileNotFoundError:
        status = "unavailable"

    return {
        "status": status
    }
    



@app.route("/api/play/<int:id>")
def play(id):

    station = next(
        (s for s in stations if s["id"] == id),
        None
    )

    if station:
        ok_clear = mpc_cmd("clear")
        ok_add = mpc_cmd("add " + station["url"])
        ok_play = mpc_cmd("play")

        if not (ok_clear and ok_add and ok_play):
            return {
                "status": "unavailable",
                "error": "mpc not available",
                "station": station["name"]
            }, 503

        return {
            "status":"playing",
            "station":station["name"]
        }

    return {
        "error":"not found"
    }


@app.route("/api/prev")
def prev_station():

    mpc_cmd("prev")

    return {
        "status": "ok"
    }


@app.route("/api/next")
def next_station():

    mpc_cmd("next")

    return {
        "status": "ok"
    }


@app.route("/api/stop")
def stop():

    mpc_cmd("stop")

    return {
        "status":"stopped"
    }


@app.route("/api/status")
def status():
    available = mpc_available()

    if not available:
        return {
            "state": "unavailable",
            "raw": "",
            "volume": None,
            "station": None,
            "now_playing": None,
            "available": False
        }

    try:
        result = subprocess.check_output(["mpc", "status"]).decode()
    except (subprocess.CalledProcessError, FileNotFoundError):
        result = ""

    state, volume = parse_status_output(result)
    current_url = safe_current_url()
    current_station = next((s for s in stations if s["url"] == current_url), None)
    current_track = now_playing_metadata()

    return {
        "state":state,
        "raw": result,
        "volume": volume,
        "station": current_station,
        "now_playing": current_track,
        "available": True
    }


@app.route("/api/current")
def current():

    current_url = safe_current_url()
    current_station = next((s for s in stations if s["url"] == current_url), None)

    return {
        "station": current_station,
        "url": current_url
    }


@app.route("/api/volume/<int:vol>")
def volume(vol):

    if vol < 0:
        vol = 0

    if vol > 100:
        vol = 100

    mpc_cmd("volume " + str(vol))

    return {
        "volume":vol
    }

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000
    )

