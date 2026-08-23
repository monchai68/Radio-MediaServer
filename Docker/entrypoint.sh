#!/bin/sh
set -eu

mkdir -p /data

if [ ! -f /data/stations.json ]; then
    cp /app/stations.json /data/stations.json
fi

ln -sfn /data/stations.json /app/stations.json
ln -sfn /data/audio_state.json /app/audio_state.json

exec "$@"