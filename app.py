from flask import Flask, jsonify, render_template, request
import subprocess
import json
import os
import re
import time
import threading
import xml.etree.ElementTree as ET

try:
    import upnpclient
except ImportError:
    upnpclient = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static")
)

STATIONS_PATH = os.path.join(BASE_DIR, "stations.json")

VALID_PLAYBACK_MODES = {"radio", "media_server"}
DLNA_SERVER_CACHE_TTL_SECONDS = 20
DLNA_DEFAULT_PAGE_SIZE = 50
DLNA_MAX_PAGE_SIZE = 100

data_store = {
    "categories": [],
    "stations": [],
    "playback_mode": "radio"
}

dlna_device_map = {}
dlna_server_cache = {
    "timestamp": 0,
    "servers": [],
    "error": None
}


def normalize_category_name(name):
    return (name or "").strip()


def ensure_favorites_category(categories):
    favorites = next((c for c in categories if normalize_category_name(c.get("name")) == "รายการโปรด"), None)
    if favorites:
        return favorites["id"]

    favorites_id = get_next_id(categories)
    categories.insert(0, {"id": favorites_id, "name": "รายการโปรด"})
    return favorites_id


def ensure_non_favorites_category(categories, favorites_id):
    non_favorite = next((c for c in categories if c.get("id") != favorites_id), None)
    if non_favorite:
        return non_favorite["id"]

    category_id = get_next_id(categories)
    categories.append({"id": category_id, "name": "ทั่วไป"})
    return category_id


def resolve_station_category_id(category_id, categories, favorites_id):
    category_ids = {c.get("id") for c in categories}
    fallback_id = ensure_non_favorites_category(categories, favorites_id)

    if category_id not in category_ids or category_id == favorites_id:
        return fallback_id

    return category_id


def normalize_station_url(url):
    return (url or "").strip().lower()


def load_data_store():
    global data_store

    with open(STATIONS_PATH, encoding="utf-8-sig") as f:
        raw = json.load(f)

    # Backward compatibility: old format is a plain station array.
    if isinstance(raw, list):
        categories = [
            {"id": 1, "name": "รายการโปรด"},
            {"id": 2, "name": "ทั่วไป"}
        ]
        data_store = {
            "categories": categories,
            "stations": [
                {
                    "id": s.get("id"),
                    "name": s.get("name", "Unnamed"),
                    "url": s.get("url", ""),
                    "category_id": 2,
                    "favorite": False
                }
                for s in raw
            ],
            "playback_mode": "radio"
        }
        save_data_store()
        return

    categories = raw.get("categories", []) if isinstance(raw, dict) else []
    stations = raw.get("stations", []) if isinstance(raw, dict) else []
    playback_mode = raw.get("playback_mode", "radio") if isinstance(raw, dict) else "radio"
    needs_save = False

    if playback_mode not in VALID_PLAYBACK_MODES:
        playback_mode = "radio"
        needs_save = True

    if not categories:
        categories = [{"id": 1, "name": "รายการโปรด"}, {"id": 2, "name": "ทั่วไป"}]
        needs_save = True

    favorites_id = ensure_favorites_category(categories)
    non_favorites_id = ensure_non_favorites_category(categories, favorites_id)

    normalized_stations = []
    dedupe_index = {}
    for s in stations:
        category_id = s.get("category_id")
        favorite = bool(s.get("favorite", False))
        resolved_category_id = resolve_station_category_id(category_id, categories, favorites_id)

        # Legacy data kept favorite stations inside the favorites category.
        # Move those stations back to a normal category and clear favorite flag.
        if category_id == favorites_id:
            resolved_category_id = non_favorites_id
            favorite = False
            needs_save = True

        if category_id != resolved_category_id or s.get("favorite") is None:
            needs_save = True

        normalized_station = {
            "id": s.get("id"),
            "name": s.get("name", "Unnamed"),
            "url": s.get("url", ""),
            "category_id": resolved_category_id,
            "favorite": favorite
        }

        dedupe_key = (resolved_category_id, normalize_station_url(normalized_station["url"]))
        if dedupe_key[1]:
            existing = dedupe_index.get(dedupe_key)
            if existing:
                # Keep one station per URL in a category; preserve favorite if any duplicate is favorited.
                if normalized_station["favorite"] and not existing["favorite"]:
                    existing["favorite"] = True
                needs_save = True
                continue

            dedupe_index[dedupe_key] = normalized_station

        normalized_stations.append(normalized_station)

    data_store = {
        "categories": categories,
        "stations": normalized_stations,
        "playback_mode": playback_mode
    }

    if needs_save:
        save_data_store()


def save_data_store():
    with open(STATIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(data_store, f, ensure_ascii=False, indent=2)


def get_categories():
    return data_store["categories"]


def get_stations():
    return data_store["stations"]


def get_next_id(items):
    if not items:
        return 1
    return max((i.get("id") or 0) for i in items) + 1


def get_playback_mode():
    mode = data_store.get("playback_mode", "radio")
    if mode not in VALID_PLAYBACK_MODES:
        return "radio"
    return mode


def set_playback_mode(mode):
    data_store["playback_mode"] = mode


def get_favorites_category_id():
    categories = get_categories()
    return ensure_favorites_category(categories)


def get_non_favorites_category_id(excluding_category_id=None):
    categories = get_categories()
    favorites_id = get_favorites_category_id()
    non_favorite = next(
        (
            c
            for c in categories
            if c.get("id") != favorites_id and c.get("id") != excluding_category_id
        ),
        None
    )
    if non_favorite:
        return non_favorite["id"]

    category_id = get_next_id(categories)
    categories.append({"id": category_id, "name": "ทั่วไป"})
    return category_id


def get_content_directory_service(device):
    services = list(getattr(device, "services", []))
    for embedded_device in getattr(device, "devices", []):
        services.extend(getattr(embedded_device, "services", []))

    for service in services:
        service_type = (getattr(service, "service_type", "") or "").lower()
        if "contentdirectory" in service_type:
            return service
    return None


def didl_child_text(node, tag_name):
    for child in node:
        local_name = child.tag.split("}", 1)[-1]
        if local_name == tag_name:
            return (child.text or "").strip()
    return ""


def parse_didl_items(xml_payload):
    if not xml_payload:
        return []

    try:
        root = ET.fromstring(xml_payload)
    except ET.ParseError:
        return []

    items = []

    for child in root:
        node_type = child.tag.split("}", 1)[-1]
        item_id = (child.attrib.get("id") or "").strip()
        parent_id = (child.attrib.get("parentID") or "").strip()
        title = didl_child_text(child, "title") or "Untitled"

        if node_type == "container":
            items.append({
                "type": "folder",
                "id": item_id,
                "parent_id": parent_id,
                "title": title
            })
            continue

        if node_type != "item":
            continue

        upnp_class = didl_child_text(child, "class").lower()
        artist = didl_child_text(child, "artist")
        album = didl_child_text(child, "album")

        media_url = ""
        protocol_info = ""
        for grandchild in child:
            local_name = grandchild.tag.split("}", 1)[-1]
            if local_name == "res":
                media_url = (grandchild.text or "").strip()
                protocol_info = (grandchild.attrib.get("protocolInfo") or "").lower()
                break

        is_audio = "audio" in upnp_class or "audio" in protocol_info
        if not media_url or not is_audio:
            continue

        items.append({
            "type": "track",
            "id": item_id,
            "parent_id": parent_id,
            "title": title,
            "artist": artist,
            "album": album,
            "url": media_url
        })

    return items


def discover_dlna_servers(force=False):
    global dlna_device_map

    if upnpclient is None:
        return False, [], "DLNA unavailable: install upnpclient"

    now = time.time()
    cache_age = now - dlna_server_cache["timestamp"]
    if not force and dlna_server_cache["servers"] and cache_age <= DLNA_SERVER_CACHE_TTL_SECONDS:
        return True, dlna_server_cache["servers"], dlna_server_cache["error"]

    try:
        entries = upnpclient.ssdp.scan(timeout=3)
    except Exception as exc:
        dlna_server_cache["timestamp"] = now
        dlna_server_cache["servers"] = []
        dlna_server_cache["error"] = str(exc)
        dlna_device_map = {}
        return False, [], str(exc)

    locations = sorted({entry.location for entry in entries if getattr(entry, "location", "")})
    loaded_devices = []
    loaded_lock = threading.Lock()

    def load_device(location):
        try:
            device = upnpclient.Device(location)
        except Exception:
            return

        with loaded_lock:
            loaded_devices.append(device)

    threads = []
    for location in locations[:20]:
        thread = threading.Thread(target=load_device, args=(location,), daemon=True)
        thread.start()
        threads.append(thread)

    deadline = time.time() + 4
    for thread in threads:
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        thread.join(remaining)

    servers = []
    device_map = {}

    for device in loaded_devices:
        service = get_content_directory_service(device)
        if not service:
            continue

        server_id = str(
            getattr(device, "udn", "")
            or getattr(device, "location", "")
            or getattr(device, "friendly_name", "")
            or f"dlna-{len(servers) + 1}"
        )
        server_name = (getattr(device, "friendly_name", "") or "DLNA Media Server").strip()
        location = (getattr(device, "location", "") or "").strip()

        servers.append({
            "id": server_id,
            "name": server_name,
            "location": location
        })
        device_map[server_id] = device

    dlna_server_cache["timestamp"] = now
    dlna_server_cache["servers"] = servers
    dlna_server_cache["error"] = None
    dlna_device_map = device_map

    return True, servers, None


def get_dlna_device(server_id):
    if server_id in dlna_device_map:
        return dlna_device_map[server_id]

    discover_dlna_servers(force=True)
    return dlna_device_map.get(server_id)


def sort_dlna_items(items):
    def sort_key(item):
        return (item.get("title") or "").strip().lower()

    folders = sorted((i for i in items if i.get("type") == "folder"), key=sort_key)
    tracks = sorted((i for i in items if i.get("type") == "track"), key=sort_key)
    return folders + tracks


def browse_dlna_all_items(server_id, container_id):
    all_items = []
    starting_index = 0
    safety_cap = 5000

    while True:
        result, error = browse_dlna_container(
            server_id,
            container_id,
            starting_index=starting_index,
            requested_count=DLNA_MAX_PAGE_SIZE
        )
        if error:
            return None, error

        items = result["items"]
        all_items.extend(items)
        returned = result["number_returned"] or len(items)
        total = result["total_matches"] or 0
        starting_index += returned

        if returned == 0 or (total and starting_index >= total) or starting_index >= safety_cap:
            break

    return all_items, None


def build_dlna_queue(server_id, container_id, selected_item_id):
    all_items, error = browse_dlna_all_items(server_id, container_id)
    if error:
        return None, error

    tracks_only = [
        item for item in sort_dlna_items(all_items)
        if item.get("type") == "track" and item.get("url")
    ]
    if not tracks_only:
        return None, "no playable tracks in this folder"

    selected_index = next(
        (idx for idx, item in enumerate(tracks_only) if item.get("id") == selected_item_id),
        None
    )
    if selected_index is None:
        return tracks_only, None

    return tracks_only[selected_index:] + tracks_only[:selected_index], None


def browse_dlna_container(server_id, container_id, starting_index=0, requested_count=DLNA_DEFAULT_PAGE_SIZE):
    device = get_dlna_device(server_id)
    if not device:
        return None, "server not found"

    service = get_content_directory_service(device)
    if not service:
        return None, "content directory service unavailable"

    try:
        response = service.Browse(
            ObjectID=str(container_id),
            BrowseFlag="BrowseDirectChildren",
            Filter="*",
            StartingIndex=starting_index,
            RequestedCount=requested_count,
            SortCriteria=""
        )
    except Exception as exc:
        return None, str(exc)

    xml_payload = response.get("Result", "")
    return {
        "items": parse_didl_items(xml_payload),
        "starting_index": starting_index,
        "number_returned": int(response.get("NumberReturned", 0)),
        "total_matches": int(response.get("TotalMatches", 0))
    }, None


def resolve_dlna_track(server_id, item_id, url_hint=""):
    if url_hint:
        return url_hint, {
            "title": "",
            "artist": "",
            "album": ""
        }

    device = get_dlna_device(server_id)
    if not device:
        return "", None

    service = get_content_directory_service(device)
    if not service:
        return "", None

    try:
        response = service.Browse(
            ObjectID=str(item_id),
            BrowseFlag="BrowseMetadata",
            Filter="*",
            StartingIndex=0,
            RequestedCount=1,
            SortCriteria=""
        )
    except Exception:
        return "", None

    items = parse_didl_items(response.get("Result", ""))
    if not items:
        return "", None

    first = items[0]
    return first.get("url", ""), {
        "title": first.get("title", ""),
        "artist": first.get("artist", ""),
        "album": first.get("album", "")
    }


load_data_store()


def mpc_cmd(command):
    try:
        if isinstance(command, str):
            args = command.split()
        else:
            args = list(command)
        subprocess.run(["mpc"] + args, check=False)
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
def stations_list():
    category_id = request.args.get("category_id", type=int)
    stations = get_stations()
    favorites_id = get_favorites_category_id()

    if category_id is not None:
        if category_id == favorites_id:
            stations = [s for s in stations if s.get("favorite")]
        else:
            stations = [s for s in stations if s["category_id"] == category_id]

    return jsonify(stations)


@app.route("/api/categories")
def categories_list():
    return jsonify(get_categories())


@app.route("/api/data")
def get_data():
    return jsonify(data_store)


@app.route("/api/mode")
def get_mode():
    return {
        "mode": get_playback_mode()
    }


@app.route("/api/mode", methods=["PUT"])
def update_mode():
    payload = request.get_json(silent=True) or {}
    mode = (payload.get("mode") or "").strip().lower()

    if mode not in VALID_PLAYBACK_MODES:
        return {"error": "mode must be 'radio' or 'media_server'"}, 400

    set_playback_mode(mode)
    save_data_store()

    return {
        "mode": mode
    }


@app.route("/api/categories", methods=["POST"])
def create_category():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()

    if not name:
        return {"error": "category name is required"}, 400

    categories = get_categories()
    category = {
        "id": get_next_id(categories),
        "name": name
    }
    categories.append(category)
    save_data_store()

    return jsonify(category), 201


@app.route("/api/categories/<int:category_id>", methods=["PUT"])
def update_category(category_id):
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()

    if not name:
        return {"error": "category name is required"}, 400

    categories = get_categories()
    category = next((c for c in categories if c["id"] == category_id), None)
    favorites_id = get_favorites_category_id()

    if not category:
        return {"error": "not found"}, 404

    if category_id == favorites_id:
        return {"error": "cannot rename favorites category"}, 400

    category["name"] = name
    save_data_store()

    return jsonify(category)


@app.route("/api/categories/<int:category_id>", methods=["DELETE"])
def delete_category(category_id):
    categories = get_categories()
    category = next((c for c in categories if c["id"] == category_id), None)

    if not category:
        return {"error": "not found"}, 404

    if len(categories) <= 1:
        return {"error": "at least one category is required"}, 400

    favorites_id = get_favorites_category_id()
    fallback_category_id = get_non_favorites_category_id(excluding_category_id=category_id)

    # Keep the default favorites category available for reassignments.
    if category_id == favorites_id:
        return {"error": "cannot delete favorites category"}, 400

    for station in get_stations():
        if station["category_id"] == category_id:
            station["category_id"] = fallback_category_id

    data_store["categories"] = [c for c in categories if c["id"] != category_id]
    save_data_store()

    return {"status": "deleted", "id": category_id}


@app.route("/api/stations", methods=["POST"])
def create_station():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    url = (payload.get("url") or "").strip()
    category_id = payload.get("category_id")

    if not name or not url:
        return {"error": "station name and url are required"}, 400

    categories = get_categories()
    favorites_id = get_favorites_category_id()
    category_id = resolve_station_category_id(category_id, categories, favorites_id)

    stations = get_stations()
    normalized_url = normalize_station_url(url)
    duplicate_station = next(
        (
            s
            for s in stations
            if s["category_id"] == category_id and normalize_station_url(s.get("url")) == normalized_url
        ),
        None
    )
    if duplicate_station:
        return {"error": "station already exists in this category"}, 409

    station = {
        "id": get_next_id(stations),
        "name": name,
        "url": url,
        "category_id": category_id,
        "favorite": False
    }
    stations.append(station)
    save_data_store()

    return jsonify(station), 201


@app.route("/api/stations/<int:station_id>", methods=["PUT"])
def update_station(station_id):
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    url = (payload.get("url") or "").strip()
    category_id = payload.get("category_id")

    if not name or not url:
        return {"error": "station name and url are required"}, 400

    station = next((s for s in get_stations() if s["id"] == station_id), None)
    if not station:
        return {"error": "not found"}, 404

    categories = get_categories()
    favorites_id = get_favorites_category_id()
    category_id = resolve_station_category_id(category_id, categories, favorites_id)
    normalized_url = normalize_station_url(url)
    duplicate_station = next(
        (
            s
            for s in get_stations()
            if s["id"] != station_id and s["category_id"] == category_id and normalize_station_url(s.get("url")) == normalized_url
        ),
        None
    )
    if duplicate_station:
        return {"error": "station already exists in this category"}, 409

    station["name"] = name
    station["url"] = url
    station["category_id"] = category_id
    save_data_store()

    return jsonify(station)


@app.route("/api/stations/<int:station_id>", methods=["DELETE"])
def delete_station(station_id):
    stations = get_stations()
    station = next((s for s in stations if s["id"] == station_id), None)
    if not station:
        return {"error": "not found"}, 404

    data_store["stations"] = [s for s in stations if s["id"] != station_id]
    save_data_store()

    return {"status": "deleted", "id": station_id}


@app.route("/api/stations/<int:station_id>/favorite", methods=["PUT"])
def update_station_favorite(station_id):
    payload = request.get_json(silent=True) or {}
    favorite = payload.get("favorite")

    if not isinstance(favorite, bool):
        return {"error": "favorite must be true or false"}, 400

    station = next((s for s in get_stations() if s["id"] == station_id), None)
    if not station:
        return {"error": "not found"}, 404

    station["favorite"] = favorite
    save_data_store()

    return jsonify(station)


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
        (s for s in get_stations() if s["id"] == id),
        None
    )

    if station:
        ok_clear = mpc_cmd("clear")
        ok_add = mpc_cmd(["add", station["url"]])
        ok_play = mpc_cmd("play")

        if not (ok_clear and ok_add and ok_play):
            return {
                "status": "unavailable",
                "error": "mpc not available",
                "station": station["name"]
            }, 503

        if get_playback_mode() != "radio":
            set_playback_mode("radio")
            save_data_store()

        return {
            "status":"playing",
            "station":station["name"],
            "mode": get_playback_mode()
        }

    return {
        "error":"not found"
    }


@app.route("/api/dlna/servers")
def dlna_servers():
    refresh = (request.args.get("refresh") or "").strip().lower() in {"1", "true", "yes"}
    available, servers, error = discover_dlna_servers(force=refresh)

    return {
        "available": available,
        "servers": servers,
        "error": error,
        "mode": get_playback_mode()
    }


@app.route("/api/dlna/browse")
def dlna_browse():
    server_id = (request.args.get("server_id") or "").strip()
    container_id = (request.args.get("container_id") or "0").strip() or "0"
    starting_index = max(0, request.args.get("starting_index", 0, type=int))
    requested_count = request.args.get("requested_count", DLNA_DEFAULT_PAGE_SIZE, type=int)
    requested_count = max(1, min(DLNA_MAX_PAGE_SIZE, requested_count))

    if not server_id:
        return {"error": "server_id is required"}, 400

    available, _, error = discover_dlna_servers(force=False)
    if not available:
        return {"error": error or "dlna unavailable"}, 503

    all_items, browse_error = browse_dlna_all_items(server_id, container_id)
    if browse_error:
        return {"error": browse_error}, 502

    sorted_items = sort_dlna_items(all_items)
    page_items = sorted_items[starting_index:starting_index + requested_count]

    return {
        "server_id": server_id,
        "container_id": container_id,
        "items": page_items,
        "starting_index": starting_index,
        "number_returned": len(page_items),
        "total_matches": len(sorted_items),
        "mode": get_playback_mode()
    }


@app.route("/api/dlna/play", methods=["POST"])
def dlna_play():
    payload = request.get_json(silent=True) or {}
    server_id = (payload.get("server_id") or "").strip()
    item_id = (payload.get("item_id") or "").strip()
    container_id = (payload.get("container_id") or "").strip()
    title = (payload.get("title") or "").strip()
    artist = (payload.get("artist") or "").strip()
    url_hint = (payload.get("url") or "").strip()

    if not server_id:
        return {"error": "server_id is required"}, 400

    if not item_id and not url_hint:
        return {"error": "item_id or url is required"}, 400

    available, _, error = discover_dlna_servers(force=False)
    if not available:
        return {"error": error or "dlna unavailable"}, 503

    if container_id and item_id:
        queue, queue_error = build_dlna_queue(server_id, container_id, item_id)
        if queue_error:
            return {"error": queue_error}, 502

        urls = [track["url"] for track in queue if track.get("url")]
        if not urls:
            return {"error": "unable to resolve media url"}, 404

        ok_clear = mpc_cmd("clear")
        ok_add = mpc_cmd(["add"] + urls)
        ok_play = mpc_cmd(["play", "1"])

        if not (ok_clear and ok_add and ok_play):
            return {
                "status": "unavailable",
                "error": "mpc not available"
            }, 503

        set_playback_mode("media_server")
        save_data_store()

        first_track = queue[0]
        resolved_title = title or first_track.get("title") or "DLNA Track"
        resolved_artist = artist or first_track.get("artist") or ""

        return {
            "status": "playing",
            "mode": get_playback_mode(),
            "queue_length": len(urls),
            "track": {
                "title": resolved_title,
                "artist": resolved_artist,
                "url": urls[0]
            }
        }

    resolved_url, resolved_meta = resolve_dlna_track(server_id, item_id, url_hint)
    if not resolved_url:
        return {"error": "unable to resolve media url"}, 404

    ok_clear = mpc_cmd("clear")
    ok_add = mpc_cmd(["add", resolved_url])
    ok_play = mpc_cmd("play")

    if not (ok_clear and ok_add and ok_play):
        return {
            "status": "unavailable",
            "error": "mpc not available"
        }, 503

    set_playback_mode("media_server")
    save_data_store()

    resolved_title = title or (resolved_meta or {}).get("title") or "DLNA Track"
    resolved_artist = artist or (resolved_meta or {}).get("artist") or ""

    return {
        "status": "playing",
        "mode": get_playback_mode(),
        "track": {
            "title": resolved_title,
            "artist": resolved_artist,
            "url": resolved_url
        }
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
    mode = get_playback_mode()
    available = mpc_available()

    if not available:
        return {
            "state": "unavailable",
            "raw": "",
            "volume": None,
            "station": None,
            "now_playing": None,
            "available": False,
            "mode": mode,
            "current_url": ""
        }

    try:
        result = subprocess.check_output(["mpc", "status"]).decode()
    except (subprocess.CalledProcessError, FileNotFoundError):
        result = ""

    state, volume = parse_status_output(result)
    current_url = safe_current_url()
    current_station = next((s for s in get_stations() if s["url"] == current_url), None)
    current_track = now_playing_metadata()

    return {
        "state":state,
        "raw": result,
        "volume": volume,
        "station": current_station,
        "now_playing": current_track,
        "available": True,
        "mode": mode,
        "current_url": current_url
    }


@app.route("/api/current")
def current():

    current_url = safe_current_url()
    current_station = next((s for s in get_stations() if s["url"] == current_url), None)

    return {
        "station": current_station,
        "url": current_url,
        "mode": get_playback_mode()
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
