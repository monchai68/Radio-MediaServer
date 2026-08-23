FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MPD_HOST=127.0.0.1 \
    MPD_PORT=6600

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y bluez mpc \
    && rm -rf /var/lib/apt/lists/*

COPY Docker/requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/requirements.txt

COPY app.py /app/app.py
COPY stations.json /app/stations.json
COPY templates /app/templates
COPY static /app/static
COPY Docker/entrypoint.sh /usr/local/bin/piradio-entrypoint
COPY Docker/wsgi.py /app/wsgi.py

RUN chmod 755 /usr/local/bin/piradio-entrypoint

EXPOSE 5000

ENTRYPOINT ["/usr/local/bin/piradio-entrypoint"]
CMD ["python", "/app/wsgi.py"]