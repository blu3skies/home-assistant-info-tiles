# home-assistant-info-tiles

Four independent Flask pages for Home Assistant: `/tiles/buses`, `/tiles/tube`, `/tiles/carbon`, `/tiles/trains`. Root links to each page and JSON endpoint. No weather integration. Original repository was inspected read-only and was not modified.

## Deploy

1. Copy this directory to your Docker host (on Synology, create a Container Manager Project from this directory).
2. `cp .env.example .env`
3. Edit `.env`: set **BUS_STOP_ID** to the verified Craignair Road stop towards Brixton and **NATIONAL_RAIL_TOKEN** to your OpenLDBWS token. Optionally set **TFL_SUBSCRIPTION_KEY**. Your supplied stop ID is configured locally. The published source only reads the bus ID from the environment; it does not establish its value. Do not use an unverified stop or copy a stop for the opposite direction.
4. `docker compose up -d --build`
5. Open `http://YOUR_DOCKER_HOST:5050/`, then check the four tiles. `docker compose ps` reports container health; `docker compose logs --tail=100` shows server logs.
6. Add the webpage cards below using a host name/address reachable from the device displaying Home Assistant. `localhost` would mean that device, not your Docker host.

The image runs Gunicorn as a non-root user with debug disabled. Keep one worker: its threaded, per-source cache shares upstream results across all clients. Multiple workers/containers would have separate caches. No database or persistent volume is needed. Build requires internet for the base image and Python packages; operation needs outbound HTTPS to TfL, National Rail and Carbon Intensity. Browsers load all assets locally, including vendored Chart.js. No public exposure is required. Stop with `docker compose down`.

## Settings

All settings come from the server environment. Compose loads `.env`; Python itself does not read it.

| Variable | Default | Meaning |
|---|---|---|
| BUS_STOP_ID | unset | Required verified TfL stop ID |
| TFL_SUBSCRIPTION_KEY | unset | Optional TfL subscription key |
| NATIONAL_RAIL_TOKEN | unset | Required rail token |
| STATION_CODE | HNH | Herne Hill CRS code |
| STATION_NAME | Herne Hill for HNH | Display heading; set when changing station |
| TRAIN_ROW_LIMIT | 4 | Maximum rows per platform, after filtering |
| TRAIN_FETCH_ROWS | 150 | Upstream rows (use 1–150) |
| BUSES_REFRESH_SECONDS | 60 | Bus cache/retry interval; example uses 30 |
| TUBE_REFRESH_SECONDS | 60 | Tube cache/retry interval |
| CARBON_REFRESH_SECONDS | 1800 | Carbon cache/retry interval |
| TRAINS_REFRESH_SECONDS | 60 | Rail cache/retry interval |
| DEVELOPMENT_FIXTURES | 0 | Set exactly 1 only for labelled development data |

Intervals have a five-second minimum. Fetching is demand driven; the first request after an interval refreshes that source, with concurrent requests sharing its result. Failures are retried after that interval. Restarting clears the in-memory cache. Credentials are never included in JSON or client assets. Avoid publishing `.env`.

## Home Assistant cards

Checked against [current official webpage-card documentation](https://www.home-assistant.io/dashboards/iframe/) on 12 November 2026. Each block is a separate card:

```yaml
type: iframe
url: http://YOUR_DOCKER_HOST:5050/tiles/buses
aspect_ratio: 90%
```

```yaml
type: iframe
url: http://YOUR_DOCKER_HOST:5050/tiles/tube
aspect_ratio: 60%
```

```yaml
type: iframe
url: http://YOUR_DOCKER_HOST:5050/tiles/carbon
aspect_ratio: 55%
```

```yaml
type: iframe
url: http://YOUR_DOCKER_HOST:5050/tiles/trains
aspect_ratio: 100%
```

`aspect_ratio` sets height relative to card width: at 400px, 90% gives 360px. Adjust for font size, row count, disruption details and your dashboard layout; Home Assistant does not automatically resize the frame to its content. The tiles have content-sized layouts, two train columns on wide frames and one on narrow frames. Vertical scrolling inside a short frame is intentional; Tube details expand within its frame and remain keyboard accessible.

If Home Assistant uses HTTPS, the tile URLs must also use HTTPS with a certificate trusted by each viewing device. Use a LAN reverse proxy such as Synology's, forwarding to port 5050. HTTP tiles inside HTTPS Home Assistant are blocked as mixed content. Ensure the proxy does not add `X-Frame-Options: DENY/SAMEORIGIN` or a CSP `frame-ancestors` rule that excludes your Home Assistant origin. The app itself permits framing; no sandbox disabling or public internet exposure is needed.

## JSON and failure states

`GET /api/buses`, `/api/tube`, `/api/carbon`, `/api/trains` return `state` (`ok`, `stale`, `unavailable`), `data`, `last_successful_update` (UTC ISO timestamp), `refresh_seconds`, and `fixture`. Empty bus arrays and empty train platform arrays are valid successful results. First-time failures return HTTP 503; stale cached data returns HTTP 200 with `state: stale`. Consumers must inspect state. Failed refreshes preserve the last-success timestamp. The UI hides stale bus/train departures instead of showing old countdowns as live. Tube/carbon can retain explicitly marked stale data. Network failure in the browser also marks data stale. `/health` reports process health, independently of upstream availability or credentials.

Bus arrivals preserve absolute timestamps (or construct one from TfL timeToStation), sort globally and show eight total. Rail only includes explicitly reported platforms 1 and 2; there is no destination-based inference. Rail times use the board timestamp and Europe/London, including midnight rollover. Countdown text updates locally every second. Browser polling is independent for every tile. Carbon uses London midnight through the end of tomorrow (46/48/50 hours around DST), retaining the source's paired half-hour averaging, relative cleanliness `1 - forecast / maxForecast`, colour interpolation, 0.66 guide, past tint and current blue outline. Its minimum pixel width contracts on narrow screens so bars remain within the frame. The source's six-hour label sequence is retained.

## Local checks and fixtures

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
DEVELOPMENT_FIXTURES=1 .venv/bin/gunicorn --bind 127.0.0.1:5050 --workers 1 --threads 8 app:app
```

Fixtures are opt-in and labelled on every tile and JSON response. They are never substituted on live API failures. Disable fixtures before deploying. Tests mock upstream calls and need no credentials.

Troubleshooting: unavailable buses usually mean a missing/wrong stop ID or TfL connectivity; unavailable trains mean a missing/invalid token or National Rail response problem. Valid empty platforms mean no reported platform 1/2 services in the requested upstream window, not an inferred platform. Check DNS, outbound HTTPS and container logs. Increase iframe aspect ratio if rows/details are clipped. A green container health check does not certify upstream feeds. Live configuration was subsequently supplied and verified against all four APIs. TfL identifies the supplied stop as Craignair Road; it is used as supplied for your requested direction.

## Source provenance

Appearance and integration behaviour extracted from [blu3skies/Departures_Board](https://github.com/blu3skies/Departures_Board), specifically app.py, bus_departures.py, train_departures.py, tube_status.py, templates/index.html and static styles/carbon JavaScript. Chart.js 4.4.8 is vendored under its MIT licence (see static/CHART-LICENSE.md). No original repository files are modified. Local `.env` contains user-supplied credentials and is excluded by both `.gitignore` and `.dockerignore`; do not include it when sharing an archive.

Validation: nine mocked backend tests passed; Chromium inspected all tiles at 320px and 1000px, checked no horizontal overflow or JavaScript errors and tested sandboxed iframe rendering. Live APIs returned buses, all 11 Tube lines, carbon periods and platform 1/2 trains. Docker image execution was not verified because the configured Docker daemon is on an inaccessible remote host. Gunicorn ran locally.
