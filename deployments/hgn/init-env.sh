#!/usr/bin/env bash
# First command of every install: create the production .env from the template.
#
#   deployments/hgn/init-env.sh workspaces.example.com
#
# Copies deployments/hgn/.env.example to .env in the repository root, fills in
# the domain, generates every secret, and locks the file down. Refuses to
# overwrite an existing .env -- edit that one by hand instead. Also checks that
# the installed Compose is new enough for the overlays.

set -euo pipefail

DOMAIN=${1:?usage: deployments/hgn/init-env.sh <public-domain>}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TEMPLATE="$ROOT/deployments/hgn/.env.example"
TARGET="$ROOT/.env"

case "$DOMAIN" in
  *://*|*/*) echo "error: pass a bare hostname (workspaces.example.com), not a URL" >&2; exit 1 ;;
esac

if [ -e "$TARGET" ]; then
  echo "error: $TARGET already exists; edit it in place or move it away first" >&2
  exit 1
fi

# The overlays use !override / !reset and env_file `required`, which need
# Compose v2.24 or newer. Older releases merge the port lists instead of
# replacing them, and Caddy ends up fighting nginx for 80/443.
compose_version=$(docker compose version --short 2>/dev/null || true)
if [ -z "$compose_version" ]; then
  echo "error: 'docker compose' is not available; install the Compose v2 plugin" >&2
  exit 1
fi
major=${compose_version%%.*}
minor=${compose_version#*.}; minor=${minor%%.*}
if [ "${major:-0}" -lt 2 ] || { [ "$major" -eq 2 ] && [ "${minor:-0}" -lt 24 ]; }; then
  echo "error: docker compose $compose_version is too old; v2.24 or newer is required" >&2
  exit 1
fi

secret() { openssl rand -hex 32; }

# Every URL in the template is written out literally against the placeholder
# domain, so one global substitution does the whole file and the result carries
# no ${...} for Compose to expand -- the generated .env means the same thing on
# any Compose version.
umask 077
sed \
  -e "s|workspaces\.example\.com|${DOMAIN}|g" \
  -e "s|^SECRET_KEY=$|SECRET_KEY=$(secret)|" \
  -e "s|^LIVE_SERVER_SECRET_KEY=$|LIVE_SERVER_SECRET_KEY=$(secret)|" \
  -e "s|^POSTGRES_PASSWORD=$|POSTGRES_PASSWORD=$(secret)|" \
  -e "s|^RABBITMQ_PASSWORD=$|RABBITMQ_PASSWORD=$(secret)|" \
  -e "s|^AWS_ACCESS_KEY_ID=$|AWS_ACCESS_KEY_ID=$(openssl rand -hex 10)|" \
  -e "s|^AWS_SECRET_ACCESS_KEY=$|AWS_SECRET_ACCESS_KEY=$(secret)|" \
  "$TEMPLATE" > "$TARGET"
chmod 600 "$TARGET"

# Prove the result is a complete configuration before anyone runs `up`.
if ! (cd "$ROOT" && docker compose config --quiet); then
  echo "error: the generated .env does not produce a valid configuration (see above)" >&2
  exit 1
fi

cat <<EOF
Wrote $TARGET (mode 600) for https://${DOMAIN}
  compose files: $(sed -n 's/^COMPOSE_FILE=//p' "$TARGET")
  project name:  $(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$TARGET")

Next:
  1. Review $TARGET -- in particular ODOO_BASE_URL / ODOO_API_KEY if attendance is wanted.
  2. If a stack already runs on this host, make sure COMPOSE_PROJECT_NAME matches
     its volume prefix ('docker volume ls') or it will start with empty volumes.
  3. docker compose up -d --build
  4. deployments/hgn/verify.sh https://${DOMAIN}
EOF
