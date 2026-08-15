let stations = [];
let currentStation = 1;
let playerState = "stopped";

function renderStations() {
    const html = stations.map((s) => {
        const activeClass = s.id === currentStation ? " active" : "";
        return `
<div class="station${activeClass}" onclick="play(${s.id})">
${s.name}
</div>
`;
    }).join("");

    document.getElementById("stations").innerHTML = html;
}

function loadStations() {
    fetch("/api/stations")
        .then((r) => r.json())
        .then((data) => {
            stations = data;
            if (!stations.some((s) => s.id === currentStation) && stations.length > 0) {
                currentStation = stations[0].id;
            }
            renderStations();
        });
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
    const nextValue = Number(slider.value) + 1;
    setVolume(nextValue);
}

function decreaseVolume() {
    const slider = document.getElementById("volumeSlider");
    const nextValue = Number(slider.value) - 1;
    setVolume(nextValue);
}

function syncStatus() {
    fetch("/api/status")
        .then((r) => r.json())
        .then((data) => {
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

            if (data.station && data.station.id) {
                currentStation = data.station.id;
                renderStations();
                setStationText("Playing: " + data.station.name);
            }

            if (data.now_playing) {
                setNowPlayingInfo(data.now_playing.title || "", data.now_playing.artist || "");
            } else {
                setNowPlayingInfo("", "");
            }

            if (data.state === "playing") {
                setStatusText("Streaming");
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
                setStatusText("Streaming");
            });
    } else {
        play(currentStation);
    }
}

function getCurrentIndex() {
    return stations.findIndex((s) => s.id === currentStation);
}

function prevStation() {
    if (stations.length === 0) {
        return;
    }

    const idx = getCurrentIndex();
    const prevIdx = idx <= 0 ? stations.length - 1 : idx - 1;
    play(stations[prevIdx].id);
}

function nextStation() {
    if (stations.length === 0) {
        return;
    }

    const idx = getCurrentIndex();
    const nextIdx = idx >= stations.length - 1 ? 0 : idx + 1;
    play(stations[nextIdx].id);
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

loadStations();
syncStatus();
setInterval(syncStatus, 2000);


