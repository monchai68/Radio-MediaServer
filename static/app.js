let categories = [];
let stations = [];
let selectedCategoryId = null;
let currentStation = null;
let editingStationId = null;
let isManageCategoriesOpen = false;
let isManageStationsOpen = false;
let playerState = "stopped";

let playbackMode = "radio";
let dlnaServers = [];
let dlnaServerId = "";
let dlnaItems = [];
let dlnaBreadcrumb = [];
let dlnaCurrentTrack = null;
let dlnaRestoreAttempted = false;
let dlnaRestoreInFlight = false;
let dlnaRestoreRetries = 0;
const DLNA_RESTORE_MAX_RETRIES = 6;

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getFavoritesCategoryId() {
    const favoriteByName = categories.find((c) => c.name === "รายการโปรด");
    if (favoriteByName) {
        return favoriteByName.id;
    }
    return categories.length > 0 ? categories[0].id : null;
}

function isFavoritesCategory(categoryId) {
    return categoryId !== null && categoryId === getFavoritesCategoryId();
}

function getVisibleStations() {
    if (selectedCategoryId === null) {
        return stations.filter((s) => s.category_id !== getFavoritesCategoryId());
    }

    if (isFavoritesCategory(selectedCategoryId)) {
        return stations.filter((s) => Boolean(s.favorite));
    }

    return stations.filter((s) => s.category_id === selectedCategoryId);
}

function updateModeView() {
    const radioBtn = document.getElementById("modeRadioBtn");
    const mediaBtn = document.getElementById("modeMediaBtn");
    const radioSection = document.getElementById("radioSection");
    const mediaSection = document.getElementById("mediaSection");

    if (radioBtn) {
        radioBtn.classList.toggle("active", playbackMode === "radio");
    }
    if (mediaBtn) {
        mediaBtn.classList.toggle("active", playbackMode === "media_server");
    }
    if (radioSection) {
        radioSection.classList.toggle("hidden", playbackMode !== "radio");
    }
    if (mediaSection) {
        mediaSection.classList.toggle("hidden", playbackMode !== "media_server");
    }

    if (playbackMode !== "radio") {
        closeManageCategoriesModal();
        closeManageStationsModal();
        closeEditStationModal();
    }

    updateManageStationsButtonVisibility();
}

function setMode(mode, persist = true) {
    const nextMode = mode === "media_server" ? "media_server" : "radio";
    playbackMode = nextMode;
    updateModeView();

    if (playbackMode === "radio") {
        loadRadioData();
    } else {
        loadDlnaServers(false);
    }

    if (!persist) {
        return;
    }

    fetch("/api/mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: playbackMode })
    }).catch(() => {
        setStatusText("Cannot persist mode setting");
    });
}

function updateManageStationsButtonVisibility() {
    const button = document.getElementById("manageStationsBtn");
    if (!button) {
        return;
    }

    const shouldHide = playbackMode !== "radio" || isFavoritesCategory(selectedCategoryId);
    button.style.display = shouldHide ? "none" : "";

    if (shouldHide && isManageStationsOpen) {
        closeManageStationsModal();
    }
}

function toggleFavoriteStation(stationId, event) {
    event.stopPropagation();
    const id = Number(stationId);

    if (!Number.isInteger(id) || id <= 0) {
        return;
    }

    const station = stations.find((s) => s.id === id);
    if (!station) {
        return;
    }

    fetch("/api/stations/" + id + "/favorite", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: !Boolean(station.favorite) })
    }).then(() => {
        loadRadioData();
    });
}

function renderCategories() {
    if (playbackMode !== "radio") {
        return;
    }

    const html = categories.map((c) => {
        const activeClass = c.id === selectedCategoryId ? " active" : "";
        return `<button class="category-pill${activeClass}" onclick="selectCategory(${c.id})">${escapeHtml(c.name)}</button>`;
    }).join("");

    document.getElementById("categories").innerHTML = html;
    const optionsHtml = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

    const editCategorySelect = document.getElementById("editStationCategory");
    if (editCategorySelect) {
        editCategorySelect.innerHTML = optionsHtml;
    }

    updateManageStationsButtonVisibility();
    renderManageCategoriesModal();
    renderManageStationsModal();
}

function renderStations() {
    if (playbackMode !== "radio") {
        return;
    }

    const visibleStations = getVisibleStations();
    const html = visibleStations.map((s) => {
        const activeClass = s.id === currentStation ? " active" : "";
        const favoriteClass = Boolean(s.favorite) ? " is-favorite" : "";
        const favoriteLabel = Boolean(s.favorite) ? "Unfavorite station" : "Favorite station";

        return `
<div class="station${activeClass}" onclick="play(${s.id})">
<div class="station-main">${escapeHtml(s.name)}</div>
<button class="favorite-btn${favoriteClass}" onclick="toggleFavoriteStation(${s.id}, event)" aria-label="${favoriteLabel}" title="${favoriteLabel}">♥</button>
</div>`;
    }).join("");

    document.getElementById("stations").innerHTML = html || "<div class=\"empty\">No station in this category</div>";
}

function getSelectedCategory() {
    return categories.find((c) => c.id === selectedCategoryId) || null;
}

function renderManageCategoriesModal() {
    const selected = getSelectedCategory();
    const selectedLabel = document.getElementById("selectedCategoryName");
    const renameInput = document.getElementById("renameCategoryName");

    if (!selectedLabel || !renameInput) {
        return;
    }

    selectedLabel.textContent = "Selected: " + (selected ? selected.name : "-");

    if (selected) {
        renameInput.value = selected.name;
    } else {
        renameInput.value = "";
    }
}

function renderManageStationsModal() {
    if (playbackMode !== "radio" || isFavoritesCategory(selectedCategoryId)) {
        return;
    }

    const selected = getSelectedCategory();
    const title = document.getElementById("manageStationsTitle");
    const stationAdminList = document.getElementById("stationAdminList");

    if (!title || !stationAdminList) {
        return;
    }

    title.textContent = "Category: " + (selected ? selected.name : "-");

    const visibleStations = getVisibleStations();
    const adminHtml = visibleStations.map((s) => {
        return `
<div class="admin-item">
<span>${escapeHtml(s.name)}</span>
<div class="admin-actions">
<button onclick="editStation(${s.id})">Edit</button>
<button onclick="removeStation(${s.id})">Delete</button>
</div>
</div>`;
    }).join("");

    stationAdminList.innerHTML = adminHtml || "<div class=\"empty\">No station in this category</div>";
}

function openManageCategoriesModal() {
    if (playbackMode !== "radio") {
        return;
    }

    isManageCategoriesOpen = true;
    renderManageCategoriesModal();
    document.getElementById("manageCategoriesModal").classList.remove("hidden");
}

function closeManageCategoriesModal() {
    isManageCategoriesOpen = false;
    document.getElementById("manageCategoriesModal").classList.add("hidden");
}

function openManageStationsModal() {
    if (playbackMode !== "radio" || isFavoritesCategory(selectedCategoryId)) {
        return;
    }

    isManageStationsOpen = true;
    renderManageStationsModal();
    document.getElementById("manageStationsModal").classList.remove("hidden");
}

function closeManageStationsModal() {
    isManageStationsOpen = false;
    document.getElementById("manageStationsModal").classList.add("hidden");
}

function selectCategory(categoryId) {
    if (playbackMode !== "radio") {
        return;
    }

    selectedCategoryId = categoryId;
    renderCategories();
    renderStations();

    if (isManageCategoriesOpen) {
        renderManageCategoriesModal();
    }

    if (isManageStationsOpen) {
        renderManageStationsModal();
    }
}

function loadRadioData() {
    fetch("/api/data")
        .then((r) => r.json())
        .then((payload) => {
            categories = payload.categories || [];
            stations = payload.stations || [];

            if (selectedCategoryId === null || !categories.some((c) => c.id === selectedCategoryId)) {
                selectedCategoryId = getFavoritesCategoryId();
            }

            const favoriteId = getFavoritesCategoryId();
            const selectedHasStations = getVisibleStations().length > 0;
            const favoriteHasStations = stations.some((s) => Boolean(s.favorite));
            if (!selectedHasStations && favoriteHasStations && selectedCategoryId !== favoriteId) {
                selectedCategoryId = favoriteId;
            }

            if (isFavoritesCategory(selectedCategoryId) && !favoriteHasStations) {
                const firstCategoryWithStations = categories.find(
                    (c) => !isFavoritesCategory(c.id) && stations.some((s) => s.category_id === c.id)
                );
                if (firstCategoryWithStations) {
                    selectedCategoryId = firstCategoryWithStations.id;
                }
            }

            const visibleStations = getVisibleStations();
            if (!visibleStations.some((s) => s.id === currentStation)) {
                currentStation = visibleStations.length > 0 ? visibleStations[0].id : null;
            }

            renderCategories();
            renderStations();
        });
}

function loadData() {
    if (playbackMode === "radio") {
        loadRadioData();
    } else {
        loadDlnaServers(false);
    }
}

function setStationText(text) {
    document.getElementById("station").innerHTML = text;
}

function setStatusText(text) {
    document.getElementById("statusText").innerHTML = text;
}

function setNowPlayingInfo(title, artist) {
    const song = title && title.trim() ? title : "-";
    const singer = artist && artist.trim() ? artist : "-";
    document.getElementById("songTitleValue").textContent = song;
    document.getElementById("songArtistValue").textContent = singer;
}

function updateButton() {
    const btn = document.getElementById("playBtn");
    if (playerState === "playing") {
        btn.innerHTML = "⏸ PAUSE";
    } else {
        btn.innerHTML = "▶ PLAY";
    }
}

function play(id) {
    if (!id) {
        return;
    }

    if (playbackMode !== "radio") {
        setMode("radio", true);
    }

    currentStation = id;

    fetch("/api/play/" + id)
        .then((r) => r.json())
        .then((data) => {
            if (data.status === "unavailable") {
                playerState = "stopped";
                updateButton();
                setStationText("Cannot play on this machine");
                setStatusText("MPD/MPC unavailable");
                return;
            }

            playerState = "playing";
            updateButton();
            renderStations();
            setStationText("Playing: " + data.station);
            setStatusText("Streaming");
        });
}

function playRadio() {
    if (!currentStation) {
        const visibleStations = getVisibleStations();
        if (visibleStations.length === 0) {
            return;
        }
        currentStation = visibleStations[0].id;
    }

    play(currentStation);
}

function stopRadio() {
    fetch("/api/stop")
        .then((r) => r.json())
        .then(() => {
            playerState = "stopped";
            updateButton();
            setStationText("Stopped");
            setStatusText("Idle");
            setNowPlayingInfo("", "");
        });
}

function setVolume(v) {
    const volume = Math.max(0, Math.min(100, Number(v)));
    document.getElementById("volumeSlider").value = volume;
    document.getElementById("volumeValue").innerHTML = volume + "%";
    fetch("/api/volume/" + volume);
}

function increaseVolume() {
    const slider = document.getElementById("volumeSlider");
    setVolume(Number(slider.value) + 1);
}

function decreaseVolume() {
    const slider = document.getElementById("volumeSlider");
    setVolume(Number(slider.value) - 1);
}

function renderDlnaServers() {
    const serversEl = document.getElementById("dlnaServers");
    if (!serversEl) {
        return;
    }

    if (dlnaServers.length === 0) {
        serversEl.innerHTML = "<div class=\"empty\">No media servers found</div>";
        return;
    }

    const html = dlnaServers.map((server, index) => {
        const activeClass = server.id === dlnaServerId ? " active" : "";
        return `
<div class="station${activeClass}" onclick="selectDlnaServerByIndex(${index})">
<div class="station-main">${escapeHtml(server.name || "DLNA Media Server")}</div>
</div>`;
    }).join("");

    serversEl.innerHTML = html;
}

function renderDlnaBreadcrumb() {
    const el = document.getElementById("dlnaBreadcrumb");
    const upBtn = document.getElementById("dlnaUpBtn");

    if (!el) {
        return;
    }

    if (!dlnaServerId || dlnaBreadcrumb.length === 0) {
        el.innerHTML = "<div class=\"empty\">Select a media server</div>";
        if (upBtn) {
            upBtn.classList.add("hidden");
        }
        return;
    }

    const ancestors = dlnaBreadcrumb.slice(0, -1);
    const html = ancestors.map((node, index) => {
        return `<button class="dlna-path-pill" onclick="openDlnaCrumb(${index})">${escapeHtml(node.title || "Folder")}</button>`;
    }).join("");

    el.innerHTML = html;

    if (upBtn) {
        upBtn.classList.toggle("hidden", dlnaBreadcrumb.length <= 1);
    }
}

function goUpDlnaLevel() {
    if (dlnaBreadcrumb.length <= 1) {
        return;
    }

    openDlnaCrumb(dlnaBreadcrumb.length - 2);
}

function renderDlnaItems() {
    const el = document.getElementById("dlnaItems");
    if (!el) {
        return;
    }

    if (!dlnaServerId) {
        el.innerHTML = "<div class=\"empty\">Choose a server to browse music</div>";
        return;
    }

    if (!dlnaItems || dlnaItems.length === 0) {
        el.innerHTML = "<div class=\"empty\">No items</div>";
        return;
    }

    const html = dlnaItems.map((item, index) => {
        const isFolder = item.type === "folder";
        const icon = isFolder ? "📁" : "🎵";
        const rowClass = isFolder ? "folder-item" : "track-item";
        const activeClass = !isFolder && dlnaCurrentTrack && dlnaCurrentTrack.id === item.id ? " active" : "";
        const subtitle = isFolder ? "" : (item.artist || item.album || "Track");
        const metaHtml = subtitle ? `<div class="dlna-item-meta">${escapeHtml(subtitle)}</div>` : "";

        return `
<div class="station ${rowClass}${activeClass}" onclick="openDlnaItem(${index})">
<div>
<div class="dlna-item-title">${icon} ${escapeHtml(item.title || "Untitled")}</div>
${metaHtml}
</div>
</div>`;
    }).join("");

    el.innerHTML = html;
}

function refreshDlnaServers() {
    loadDlnaServers(true);
}

function loadDlnaServers(forceRefresh) {
    const query = forceRefresh ? "?refresh=1" : "";

    fetch("/api/dlna/servers" + query)
        .then((r) => r.json())
        .then((data) => {
            if (!data.available) {
                dlnaServers = [];
                dlnaServerId = "";
                dlnaItems = [];
                dlnaBreadcrumb = [];
                renderDlnaServers();
                renderDlnaBreadcrumb();
                renderDlnaItems();
                setStatusText(data.error || "DLNA unavailable");
                scheduleDlnaRestoreRetry();
                return;
            }

            dlnaServers = data.servers || [];
            renderDlnaServers();

            if (!dlnaServers.some((server) => server.id === dlnaServerId)) {
                dlnaServerId = "";
                dlnaItems = [];
                dlnaBreadcrumb = [];
            }

            renderDlnaBreadcrumb();
            renderDlnaItems();
            restoreDlnaDirectory();
        })
        .catch(() => {
            setStatusText("Cannot load media servers");
        });
}

function restoreDlnaDirectory() {
    if (dlnaRestoreAttempted || dlnaRestoreInFlight || playbackMode !== "media_server") {
        return;
    }

    dlnaRestoreInFlight = true;
    fetch("/api/dlna/directory")
        .then((r) => r.json())
        .then((data) => {
            const directory = data.directory;
            if (!directory) {
                dlnaRestoreAttempted = true;
                return;
            }
            if (!dlnaServers.some((server) => server.id === directory.server_id)) {
                scheduleDlnaRestoreRetry();
                return;
            }

            dlnaServerId = directory.server_id;
            dlnaBreadcrumb = Array.isArray(directory.breadcrumb) && directory.breadcrumb.length > 0
                ? directory.breadcrumb
                : [{ id: directory.container_id || "0", title: "Root" }];
            dlnaCurrentTrack = directory.track && (directory.track.id || directory.track.url)
                ? directory.track
                : null;
            dlnaRestoreAttempted = true;
            renderDlnaServers();
            renderDlnaBreadcrumb();
            browseDlnaContainer(directory.container_id || "0", true);
            if (dlnaCurrentTrack) {
                setNowPlayingInfo(dlnaCurrentTrack.title || "", dlnaCurrentTrack.artist || "");
            }
        })
        .catch(() => {
            scheduleDlnaRestoreRetry();
        })
        .finally(() => {
            dlnaRestoreInFlight = false;
        });
}

function scheduleDlnaRestoreRetry() {
    if (dlnaRestoreAttempted || dlnaRestoreRetries >= DLNA_RESTORE_MAX_RETRIES || playbackMode !== "media_server") {
        return;
    }

    dlnaRestoreRetries += 1;
    setTimeout(() => loadDlnaServers(true), 5000);
}

function selectDlnaServerByIndex(index) {
    const server = dlnaServers[index];
    if (!server) {
        return;
    }

    dlnaServerId = server.id;
    dlnaBreadcrumb = [{ id: "0", title: server.name || "Root" }];
    dlnaItems = [];
    renderDlnaServers();
    renderDlnaBreadcrumb();
    browseDlnaContainer("0", true);
}

function goDlnaHome() {
    if (!dlnaServerId) {
        if (dlnaServers.length > 0) {
            selectDlnaServerByIndex(0);
        }
        return;
    }

    dlnaBreadcrumb = dlnaBreadcrumb.length > 0 ? [dlnaBreadcrumb[0]] : [{ id: "0", title: "Root" }];
    browseDlnaContainer("0", true);
}

function openDlnaCrumb(index) {
    if (index < 0 || index >= dlnaBreadcrumb.length) {
        return;
    }

    const target = dlnaBreadcrumb[index];
    dlnaBreadcrumb = dlnaBreadcrumb.slice(0, index + 1);
    browseDlnaContainer(target.id, true);
}

function browseDlnaContainer(containerId, replaceLast) {
    if (!dlnaServerId) {
        return;
    }

    fetch("/api/dlna/browse?server_id=" + encodeURIComponent(dlnaServerId) + "&container_id=" + encodeURIComponent(containerId || "0"))
        .then((r) => r.json())
        .then((data) => {
            if (data.error) {
                setStatusText(data.error);
                return;
            }

            dlnaItems = dedupeDlnaFolders(data.items || []);

            if (replaceLast && dlnaBreadcrumb.length === 0) {
                dlnaBreadcrumb = [{ id: containerId || "0", title: "Root" }];
            }

            renderDlnaBreadcrumb();
            renderDlnaItems();
        })
        .catch(() => {
            setStatusText("Cannot browse media folder");
        });
}

function dedupeDlnaFolders(items) {
    const seenFolderNames = new Set();
    return items.filter((item) => {
        if (item.type !== "folder") {
            return true;
        }
        const key = (item.title || "").trim().toLowerCase();
        if (seenFolderNames.has(key)) {
            return false;
        }
        seenFolderNames.add(key);
        return true;
    });
}

function openDlnaItem(index) {
    const item = dlnaItems[index];
    if (!item) {
        return;
    }

    if (item.type === "folder") {
        dlnaBreadcrumb.push({
            id: item.id,
            title: item.title || "Folder"
        });
        browseDlnaContainer(item.id, false);
        return;
    }

    playDlnaTrack(item);
}

function playDlnaTrack(item) {
    if (!item) {
        return;
    }

    dlnaCurrentTrack = item;
    const containerId = dlnaBreadcrumb.length > 0 ? dlnaBreadcrumb[dlnaBreadcrumb.length - 1].id : "0";

    fetch("/api/dlna/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            server_id: dlnaServerId,
            container_id: containerId,
            breadcrumb: dlnaBreadcrumb,
            item_id: item.id,
            title: item.title || "",
            artist: item.artist || "",
            url: item.url || ""
        })
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error || data.status === "unavailable") {
                setStatusText(data.error || "Cannot play media track");
                return;
            }

            playerState = "playing";
            updateButton();
            setStationText("Playing: " + (item.title || "DLNA Track"));
            setStatusText(
                data.queue_length ? `Playing ${data.queue_length} tracks` : "Streaming from media server"
            );
            setNowPlayingInfo(item.title || "", item.artist || "");
            renderDlnaItems();
        })
        .catch(() => {
            setStatusText("Cannot start media playback");
        });
}

function syncStatus() {
    fetch("/api/status")
        .then((r) => r.json())
        .then((data) => {
            if (data.mode && data.mode !== playbackMode) {
                setMode(data.mode, false);
            }

            if (data.available === false || data.state === "unavailable") {
                playerState = "stopped";
                updateButton();
                setStatusText("MPD/MPC unavailable");
                setNowPlayingInfo("", "");
                return;
            }

            playerState = data.state;
            updateButton();

            if (typeof data.volume === "number") {
                document.getElementById("volumeSlider").value = data.volume;
                document.getElementById("volumeValue").innerHTML = data.volume + "%";
            }

            if (playbackMode === "radio") {
                if (data.station && data.station.id) {
                    currentStation = data.station.id;
                    renderStations();
                    setStationText("Playing: " + data.station.name);
                } else if (data.state !== "playing") {
                    setStationText("Ready");
                }
            } else {
                if (data.current_url && dlnaItems.length > 0) {
                    const matchingItem = dlnaItems.find((item) => item.url && item.url === data.current_url);
                    if (matchingItem) {
                        dlnaCurrentTrack = matchingItem;
                        renderDlnaItems();
                    }
                }

                if (data.state === "playing") {
                    const mediaTitle = (data.now_playing && (data.now_playing.title || data.now_playing.raw)) ||
                        (dlnaCurrentTrack && dlnaCurrentTrack.title) ||
                        "DLNA Track";
                    setStationText("Playing: " + mediaTitle);
                } else if (data.state === "paused") {
                    setStationText("Paused");
                } else {
                    setStationText("Media server ready");
                }
            }

            if (data.now_playing && (data.now_playing.title || data.now_playing.artist)) {
                setNowPlayingInfo(data.now_playing.title || "", data.now_playing.artist || "");
            } else if (playbackMode === "media_server" && dlnaCurrentTrack) {
                setNowPlayingInfo(dlnaCurrentTrack.title || "", dlnaCurrentTrack.artist || "");
            } else {
                setNowPlayingInfo("", "");
            }

            if (data.state === "playing") {
                setStatusText(playbackMode === "radio" ? "Streaming" : "Streaming from media server");
            } else if (data.state === "paused") {
                setStatusText("Paused");
            } else {
                setStatusText("Idle");
            }
        });
}

function togglePlay() {
    if (playerState === "playing") {
        fetch("/api/pause")
            .then((r) => r.json())
            .then(() => {
                playerState = "paused";
                updateButton();
                setStatusText("Paused");
            });
    } else if (playerState === "paused") {
        fetch("/api/resume")
            .then((r) => r.json())
            .then(() => {
                playerState = "playing";
                updateButton();
                setStatusText(playbackMode === "radio" ? "Streaming" : "Streaming from media server");
            });
    } else if (playbackMode === "media_server") {
        if (!dlnaCurrentTrack) {
            setStatusText("Select a media track first");
            return;
        }
        playDlnaTrack(dlnaCurrentTrack);
    } else {
        playRadio();
    }
}

function getCurrentIndex() {
    return getVisibleStations().findIndex((s) => s.id === currentStation);
}

function getDlnaTracks() {
    return (dlnaItems || []).filter((item) => item.type !== "folder");
}

function prevDlnaTrack() {
    const tracks = getDlnaTracks();
    if (tracks.length > 0) {
        let idx = -1;
        if (dlnaCurrentTrack) {
            idx = tracks.findIndex(
                (t) => t.id === dlnaCurrentTrack.id || (t.url && dlnaCurrentTrack.url && t.url === dlnaCurrentTrack.url)
            );
        }
        const prevIdx = idx <= 0 ? tracks.length - 1 : idx - 1;
        playDlnaTrack(tracks[prevIdx]);
        return;
    }

    if (playerState === "playing" || playerState === "paused") {
        fetch("/api/prev")
            .then((r) => r.json())
            .then(() => {
                syncStatus();
            })
            .catch(() => {
                setStatusText("Cannot skip to previous track");
            });
        return;
    }

    setStatusText("No media tracks available");
}

function nextDlnaTrack() {
    const tracks = getDlnaTracks();
    if (tracks.length > 0) {
        let idx = -1;
        if (dlnaCurrentTrack) {
            idx = tracks.findIndex(
                (t) => t.id === dlnaCurrentTrack.id || (t.url && dlnaCurrentTrack.url && t.url === dlnaCurrentTrack.url)
            );
        }
        const nextIdx = idx < 0 || idx >= tracks.length - 1 ? 0 : idx + 1;
        playDlnaTrack(tracks[nextIdx]);
        return;
    }

    if (playerState === "playing" || playerState === "paused") {
        fetch("/api/next")
            .then((r) => r.json())
            .then(() => {
                syncStatus();
            })
            .catch(() => {
                setStatusText("Cannot skip to next track");
            });
        return;
    }

    setStatusText("No media tracks available");
}

function prevStation() {
    if (playbackMode === "media_server") {
        prevDlnaTrack();
        return;
    }

    const visibleStations = getVisibleStations();
    if (visibleStations.length === 0) {
        return;
    }

    const idx = getCurrentIndex();
    const prevIdx = idx <= 0 ? visibleStations.length - 1 : idx - 1;
    play(visibleStations[prevIdx].id);
}

function nextStation() {
    if (playbackMode === "media_server") {
        nextDlnaTrack();
        return;
    }

    const visibleStations = getVisibleStations();
    if (visibleStations.length === 0) {
        return;
    }

    const idx = getCurrentIndex();
    const nextIdx = idx >= visibleStations.length - 1 ? 0 : idx + 1;
    play(visibleStations[nextIdx].id);
}

function powerOff() {
    if (!confirm("Do you want to shut down Raspberry Pi?")) {
        return;
    }

    fetch("/api/poweroff")
        .then((r) => r.json())
        .then(() => {
            setStationText("Shutting down...");
            setStatusText("Powering off");
            setNowPlayingInfo("", "");
        });
}

function refreshPage() {
    location.reload();
}

function addCategory() {
    const input = document.getElementById("newCategoryName");
    const name = input.value.trim();
    if (!name) {
        return;
    }

    fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
    })
        .then((r) => r.json())
        .then((created) => {
            input.value = "";
            selectedCategoryId = created.id;
            loadRadioData();
        });
}

function renameSelectedCategory() {
    const category = getSelectedCategory();
    if (!category) {
        return;
    }

    const input = document.getElementById("renameCategoryName");
    const name = input ? input.value.trim() : "";
    if (!name || !name.trim()) {
        return;
    }

    fetch("/api/categories/" + category.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
    }).then(() => loadRadioData());
}

function deleteSelectedCategory() {
    const category = getSelectedCategory();
    if (!category) {
        return;
    }

    if (!confirm("Delete category '" + category.name + "'? Stations in this category will move to favorites.")) {
        return;
    }

    fetch("/api/categories/" + category.id, {
        method: "DELETE"
    })
        .then((r) => r.json())
        .then((result) => {
            if (result.error) {
                alert(result.error);
            }
            selectedCategoryId = getFavoritesCategoryId();
            loadRadioData();
        });
}

function addStationToSelectedCategory() {
    const nameInput = document.getElementById("newStationName");
    const urlInput = document.getElementById("newStationUrl");

    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    const category_id = selectedCategoryId;

    if (!name || !url || !category_id) {
        return;
    }

    fetch("/api/stations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, category_id })
    })
        .then((r) => r.json())
        .then(() => {
            nameInput.value = "";
            urlInput.value = "";
            loadRadioData();
        });
}

function editStation(id) {
    const station = stations.find((s) => s.id === id);
    if (!station) {
        return;
    }

    const modal = document.getElementById("editStationModal");
    const nameInput = document.getElementById("editStationName");
    const urlInput = document.getElementById("editStationUrl");
    const categorySelect = document.getElementById("editStationCategory");

    // Fallback for stale cached HTML where modal elements are not available.
    if (!modal || !nameInput || !urlInput || !categorySelect) {
        const name = prompt("Station name", station.name);
        if (!name || !name.trim()) {
            return;
        }

        const url = prompt("Station URL", station.url);
        if (!url || !url.trim()) {
            return;
        }

        fetch("/api/stations/" + id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: name.trim(),
                url: url.trim(),
                category_id: station.category_id
            })
        }).then(() => loadRadioData());
        return;
    }

    editingStationId = id;
    nameInput.value = station.name || "";
    urlInput.value = station.url || "";
    categorySelect.value = String(station.category_id);
    modal.classList.remove("hidden");
}

function closeEditStationModal() {
    editingStationId = null;
    document.getElementById("editStationModal").classList.add("hidden");
}

function saveEditStation() {
    if (!editingStationId) {
        return;
    }

    const name = document.getElementById("editStationName").value.trim();
    const url = document.getElementById("editStationUrl").value.trim();
    const category_id = Number(document.getElementById("editStationCategory").value);

    if (!name || !url) {
        alert("Please fill both station name and URL");
        return;
    }

    fetch("/api/stations/" + editingStationId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name,
            url,
            category_id
        })
    }).then(() => {
        closeEditStationModal();
        loadRadioData();
    });
}

function removeStation(id) {
    const station = stations.find((s) => s.id === id);
    if (!station) {
        return;
    }

    if (!confirm("Delete station '" + station.name + "'?")) {
        return;
    }

    fetch("/api/stations/" + id, {
        method: "DELETE"
    }).then(() => {
        loadRadioData();
        if (isManageStationsOpen) {
            renderManageStationsModal();
        }
    });
}

function bootstrap() {
    fetch("/api/mode")
        .then((r) => r.json())
        .then((data) => {
            const mode = data.mode === "media_server" ? "media_server" : "radio";
            setMode(mode, false);
        })
        .catch(() => {
            setMode("radio", false);
        })
        .finally(() => {
            syncStatus();
            setInterval(syncStatus, 2000);
        });
}

bootstrap();

let bluetoothScanInFlight = false;

function openSettingsModal() {
    document.getElementById("settingsModal").classList.remove("hidden");
}

function closeSettingsModal() {
    document.getElementById("settingsModal").classList.add("hidden");
}

function renderBluetoothDevices(devices) {
    const list = document.getElementById("bluetoothDeviceList");
    if (!list) {
        return;
    }

    if (!devices || devices.length === 0) {
        list.innerHTML = "<div class=\"empty\">No devices found</div>";
        return;
    }

    list.innerHTML = devices.map((d) => {
        const statusClass = d.connected ? " connected" : "";
        const statusText = d.connected ? "Connected" : (d.paired ? "Paired" : "Available");
        const actionLabel = d.connected ? "Disconnect" : "Connect";
        const actionFn = d.connected ? "disconnectBluetoothDevice" : "connectBluetoothDevice";
        const safeMac = escapeHtml(d.mac);

        return `
<div class="admin-item">
<div class="device-item-main">
<span class="device-item-name">${escapeHtml(d.name)}</span>
<span class="device-item-status${statusClass}" id="btStatus-${safeMac}">${statusText}</span>
</div>
<div class="admin-actions">
<button id="btAction-${safeMac}" onclick="${actionFn}('${d.mac}')">${actionLabel}</button>
</div>
</div>`;
    }).join("");
}

function loadBluetoothStatus() {
    fetch("/api/bluetooth/status")
        .then((r) => r.json())
        .then((data) => {
            const toggle = document.getElementById("bluetoothPowerToggle");
            const note = document.getElementById("bluetoothNote");
            const scanBtn = document.getElementById("bluetoothScanBtn");

            if (toggle) {
                toggle.checked = Boolean(data.powered);
                toggle.disabled = !data.available;
            }
            if (scanBtn) {
                scanBtn.disabled = !data.available || !data.powered;
            }
            if (note && !data.available) {
                note.textContent = "Bluetooth is unavailable on this device.";
            }
        });
}

function loadBluetoothDevices() {
    fetch("/api/bluetooth/devices")
        .then((r) => r.json())
        .then((data) => {
            renderBluetoothDevices(data.devices || []);
        });
}

function openBluetoothModal() {
    closeSettingsModal();
    document.getElementById("bluetoothModal").classList.remove("hidden");
    loadBluetoothStatus();
    loadBluetoothDevices();
}

function closeBluetoothModal() {
    document.getElementById("bluetoothModal").classList.add("hidden");
}

function toggleBluetoothPower(powerOn) {
    fetch("/api/bluetooth/power", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ power: powerOn })
    })
        .then((r) => r.json())
        .then(() => {
            loadBluetoothStatus();
            loadBluetoothDevices();
        });
}

function scanBluetoothDevices() {
    if (bluetoothScanInFlight) {
        return;
    }

    const scanBtn = document.getElementById("bluetoothScanBtn");
    bluetoothScanInFlight = true;
    if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.textContent = "Scanning...";
    }

    fetch("/api/bluetooth/scan", { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
            renderBluetoothDevices(data.devices || []);
        })
        .finally(() => {
            bluetoothScanInFlight = false;
            if (scanBtn) {
                scanBtn.disabled = false;
                scanBtn.textContent = "🔍 Scan for Devices";
            }
        });
}

function setBluetoothActionBusy(mac, label) {
    const btn = document.getElementById("btAction-" + mac);
    if (btn) {
        btn.disabled = true;
        btn.textContent = label;
    }
}

function connectBluetoothDevice(mac) {
    setBluetoothActionBusy(mac, "Connecting...");

    fetch("/api/bluetooth/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: mac })
    })
        .then((r) => r.json().then((data) => ({ ok: r.ok, data: data })))
        .then(({ ok, data }) => {
            if (!ok) {
                alert("Connect failed: " + (data.error || "unknown error"));
            }
        })
        .catch(() => {
            alert("Connect failed: request error");
        })
        .finally(() => {
            loadBluetoothDevices();
        });
}

function disconnectBluetoothDevice(mac) {
    setBluetoothActionBusy(mac, "Disconnecting...");

    fetch("/api/bluetooth/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: mac })
    })
        .then((r) => r.json().then((data) => ({ ok: r.ok, data: data })))
        .then(({ ok, data }) => {
            if (!ok) {
                alert("Disconnect failed: " + (data.error || "unknown error"));
            }
        })
        .catch(() => {
            alert("Disconnect failed: request error");
        })
        .finally(() => {
            loadBluetoothDevices();
        });
}

let wifiScanInFlight = false;
let wifiConnectTargetSsid = null;
let wifiNetworks = [];

function openWifiModal() {
    closeSettingsModal();
    document.getElementById("wifiModal").classList.remove("hidden");
    cancelWifiConnect();
    loadWifiStatus();
    scanWifiNetworks();
}

function closeWifiModal() {
    document.getElementById("wifiModal").classList.add("hidden");
    cancelWifiConnect();
}

function loadWifiStatus() {
    fetch("/api/wifi/status")
        .then((r) => r.json().then((data) => ({ ok: r.ok, data: data })))
        .then(({ ok, data }) => {
            const note = document.getElementById("wifiStatusNote");
            if (!note) {
                return;
            }

            if (!ok) {
                note.textContent = "Error: " + (data.error || "failed to load status");
            } else if (!data.available) {
                note.textContent = "Wi-Fi is unavailable on this device.";
            } else if (data.hotspot_active) {
                note.textContent = "Setup hotspot active — connect a phone/computer to the Pi's own Wi-Fi to configure.";
            } else if (data.connected) {
                note.textContent = "Connected to " + data.ssid + (data.ip ? " (" + data.ip + ")" : "");
            } else {
                note.textContent = "Not connected to any Wi-Fi network.";
            }
        })
        .catch(() => {
            const note = document.getElementById("wifiStatusNote");
            if (note) {
                note.textContent = "Error: request failed (check server logs).";
            }
        });
}

function renderWifiNetworks() {
    const list = document.getElementById("wifiNetworkList");
    if (!list) {
        return;
    }

    if (!wifiNetworks || wifiNetworks.length === 0) {
        list.innerHTML = "<div class=\"empty\">No networks found</div>";
        return;
    }

    list.innerHTML = wifiNetworks.map((n) => {
        const lockIcon = n.secured ? "🔒" : "🔓";
        const statusText = n.connected ? "Connected" : (n.saved ? "Saved" : "");
        const statusClass = n.connected ? " connected" : "";
        const safeSsid = escapeHtml(n.ssid).replace(/'/g, "\\'");

        return `
<div class="admin-item">
<div class="device-item-main">
<span class="device-item-name">${lockIcon} ${escapeHtml(n.ssid)}</span>
<span class="device-item-status${statusClass}">${statusText || (n.signal + "%")}</span>
</div>
<div class="admin-actions">
<button onclick="selectWifiNetwork('${safeSsid}', ${n.secured})">${n.connected ? "Reconnect" : "Connect"}</button>
</div>
</div>`;
    }).join("");
}

function scanWifiNetworks() {
    if (wifiScanInFlight) {
        return;
    }

    const scanBtn = document.getElementById("wifiScanBtn");
    wifiScanInFlight = true;
    if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.textContent = "Scanning...";
    }

    fetch("/api/wifi/scan")
        .then((r) => r.json().then((data) => ({ ok: r.ok, data: data })))
        .then(({ ok, data }) => {
            if (!ok) {
                const list = document.getElementById("wifiNetworkList");
                if (list) {
                    list.innerHTML = "<div class=\"empty\">Scan failed: " + escapeHtml(data.error || "unknown error") + "</div>";
                }
                return;
            }
            wifiNetworks = data.networks || [];
            renderWifiNetworks();
        })
        .catch(() => {
            const list = document.getElementById("wifiNetworkList");
            if (list) {
                list.innerHTML = "<div class=\"empty\">Scan failed: request error</div>";
            }
        })
        .finally(() => {
            wifiScanInFlight = false;
            if (scanBtn) {
                scanBtn.disabled = false;
                scanBtn.textContent = "🔍 Scan for Networks";
            }
        });
}

function selectWifiNetwork(ssid, secured) {
    wifiConnectTargetSsid = ssid;
    document.getElementById("wifiConnectSsid").textContent = "Connect to: " + ssid;

    const passwordInput = document.getElementById("wifiPasswordInput");
    passwordInput.value = "";
    passwordInput.style.display = secured ? "" : "none";

    document.getElementById("wifiConnectForm").classList.remove("hidden");
}

function cancelWifiConnect() {
    wifiConnectTargetSsid = null;
    const form = document.getElementById("wifiConnectForm");
    if (form) {
        form.classList.add("hidden");
    }
}

function submitWifiConnect() {
    if (!wifiConnectTargetSsid) {
        return;
    }

    const password = document.getElementById("wifiPasswordInput").value;
    const ssid = wifiConnectTargetSsid;

    fetch("/api/wifi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid: ssid, password: password })
    })
        .then((r) => r.json().then((data) => ({ ok: r.ok, data: data })))
        .then(({ ok, data }) => {
            if (!ok) {
                alert("Connect failed: " + (data.error || "unknown error"));
                return;
            }
            cancelWifiConnect();
            loadWifiStatus();
            scanWifiNetworks();
        })
        .catch(() => {
            alert("Connect failed: request error");
        });
}