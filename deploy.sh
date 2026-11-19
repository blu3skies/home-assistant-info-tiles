#!/bin/sh
# Run on the Docker host. Credentials stay in the ignored .env file.
set -eu
REPO=https://github.com/blu3skies/home-assistant-info-tiles.git
DEPLOY_DIR=${DEPLOY_DIR:-/volume1/docker/home-assistant-info-tiles}
BRANCH=main
export PATH="/usr/local/bin:/usr/bin:/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Docker/target/usr/bin:$PATH"
for tool in git docker; do
    command -v "$tool" >/dev/null 2>&1 || { echo "Missing $tool. Install Synology Container Manager and Git Server, then retry." >&2; exit 1; }
done
docker info >/dev/null 2>&1 || { echo 'Cannot access Docker. Run this command with sudo on your Synology.' >&2; exit 1; }
compose() {
    if docker compose version >/dev/null 2>&1; then
        docker compose -p home-assistant-info-tiles "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose -p home-assistant-info-tiles "$@"
    else
        echo 'Docker Compose is required. Install/update Synology Container Manager.' >&2
        exit 1
    fi
}
if [ ! -d "$DEPLOY_DIR/.git" ]; then
    if [ -e "$DEPLOY_DIR" ]; then
        echo "Refusing to overwrite an existing non-Git directory: $DEPLOY_DIR" >&2
        exit 1
    fi
    mkdir -p "$(dirname "$DEPLOY_DIR")"
    git clone --branch "$BRANCH" "$REPO" "$DEPLOY_DIR"
fi
cd "$DEPLOY_DIR"
[ "$(git remote get-url origin)" = "$REPO" ] || { echo 'Unexpected origin repository; refusing to deploy.' >&2; exit 1; }
[ "$(git branch --show-current)" = "$BRANCH" ] || { echo 'Expected main branch; refusing to deploy.' >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo 'Local source changes found; commit or remove them before updating. .env may remain local.' >&2; exit 1; }
git pull --ff-only origin "$BRANCH"
if [ ! -f .env ]; then
    (umask 077; cp .env.example .env)
    echo "Created $DEPLOY_DIR/.env. Fill in your credentials there, then run this same command again."
    exit 1
fi
chmod 600 .env
for key in NATIONAL_RAIL_TOKEN BUS_STOP_ID; do
    if ! grep -Eq "^${key}=[^[:space:]#]+" .env; then
        echo "Set $key in $DEPLOY_DIR/.env before deploying." >&2
        exit 1
    fi
done
if grep -Eq '^DEVELOPMENT_FIXTURES=[^0]*1' .env; then
    echo 'Disable DEVELOPMENT_FIXTURES before deploying live tiles.' >&2
    exit 1
fi
# Build first: an unsuccessful build leaves the running container alone.
compose config --quiet
compose build --pull
compose up -d --no-build
container=$(compose ps -q tiles)
[ -n "$container" ] || { echo 'No tiles container found.' >&2; exit 1; }
attempt=0
while [ "$attempt" -lt 30 ]; do
    status=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")
    case "$status" in
        'running healthy')
            echo "Tiles are healthy. Deployed commit: $(git rev-parse --short HEAD)"
            compose port tiles 5050
            exit 0 ;;
        *unhealthy*|exited*|dead*)
            echo 'Container failed its startup check. Inspect docker compose logs tiles in the deployment folder.' >&2
            exit 1 ;;
    esac
    attempt=$((attempt + 1))
    sleep 2
done
echo 'Container did not become healthy within 60 seconds. Inspect docker compose logs tiles.' >&2
exit 1
