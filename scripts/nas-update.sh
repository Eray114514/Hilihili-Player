#!/bin/sh

# Run this script from the NAS host's task scheduler, not from a container.
set -eu

COMPOSE_DIR="${HILI_COMPOSE_DIR:-/home/Eray/docker/hilihili}"
COMPOSE_PROJECT="${HILI_COMPOSE_PROJECT:-hilihili}"

cd "$COMPOSE_DIR"
echo "[$(date '+%F %T %Z')] Checking Hilihili images"
docker compose -p "$COMPOSE_PROJECT" pull api worker web
docker compose -p "$COMPOSE_PROJECT" up -d --remove-orphans api worker web
docker compose -p "$COMPOSE_PROJECT" ps api worker web
