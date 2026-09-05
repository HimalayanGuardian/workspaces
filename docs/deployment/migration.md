# Migrating to the restructured deployment

Two migrations live here:

- [**From the previous layout of this repository**](#from-the-previous-layout) — you already run
  this fork with `docker compose -f docker-compose.yml -f deployments/hgn/docker-compose.prod.yml`.
- [**From a stock Plane install**](#from-a-stock-plane-install) — the box runs upstream Plane from
  Docker Hub images and you want this fork's data-preserving replacement.

Then: [what changed and why](#what-changed), and
[how to merge upstream afterwards](#merging-upstream-after-this-change).

---

## From the previous layout

Nothing about the running stack changes: same services, same volumes, same images, same Postgres.
What changes is which files describe it and where configuration lives. Budget 20 minutes plus a
rebuild.

### 1. Back up first

```bash
cd /opt/workspaces
docker compose -f docker-compose.yml -f deployments/hgn/docker-compose.prod.yml \
  exec -T plane-db pg_dump -U plane plane | gzip > ~/pre-restructure.sql.gz
docker run --rm -v workspaces_uploads:/data -v ~:/backup \
  alpine:3.20 tar czf /backup/pre-restructure-uploads.tar.gz -C /data .
```

### 2. Record the project name, before anything else

This is the one step that can lose data if skipped. The volume prefix is the compose project name,
which previously came from the checkout directory:

```bash
docker volume ls --format '{{.Name}}' | grep -E 'pgdata|uploads'
# workspaces_pgdata
# workspaces_uploads      ← the prefix is "workspaces"
```

Whatever that prefix is, `COMPOSE_PROJECT_NAME` in the new `.env` must equal it. If your checkout
was not called `workspaces`, the template's default is wrong for you and the first `up` would
create empty volumes and appear to have lost every project.

### 3. Keep the old secrets

`SECRET_KEY` in particular: it decrypts the instance configuration rows in the database. A new one
invalidates every session and breaks the stored SMTP and OAuth settings.

```bash
grep -E '^(SECRET_KEY|POSTGRES_PASSWORD|RABBITMQ_PASSWORD|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|LIVE_SERVER_SECRET_KEY|ODOO_BASE_URL|ODOO_API_KEY)=' \
  .env apps/api/.env > ~/old-secrets.txt
cat ~/old-secrets.txt
```

`LIVE_SERVER_SECRET_KEY` will not be there — the old layout never passed one to the live server,
which is why collaborative editing did not work. Generate a fresh one; nothing depends on its
previous value.

### 4. Stop the stack and pull

```bash
docker compose -f docker-compose.yml -f deployments/hgn/docker-compose.prod.yml down
mv .env .env.pre-restructure          # keep it until the new stack is verified
git pull
```

### 5. Write the new `.env`

```bash
deployments/hgn/init-env.sh your.real.domain
```

Then carry the old values across, editing `.env`:

| Copy from                                                | Into `.env`            |
| -------------------------------------------------------- | ---------------------- |
| old `apps/api/.env` `SECRET_KEY`                         | `SECRET_KEY`           |
| old `.env` `POSTGRES_PASSWORD`                           | `POSTGRES_PASSWORD`    |
| old `.env` `RABBITMQ_PASSWORD`                           | `RABBITMQ_PASSWORD`    |
| old `.env` `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | the same two           |
| old `apps/api/.env` `ODOO_BASE_URL` / `ODOO_API_KEY`     | the same two           |
| the prefix from step 2                                   | `COMPOSE_PROJECT_NAME` |
| old `.env` `LISTEN_HTTP_PORT`                            | `LISTEN_HTTP_PORT`     |

The Postgres, RabbitMQ and MinIO passwords must match what is already inside the volumes, or those
services reject the credentials on start-up.

Two values are _not_ carried over, because their old values were wrong:

- **`TRUSTED_PROXIES`** was `0.0.0.0/0`. The template ships `private_ranges`, which is correct
  behind the host nginx and stops clients spoofing their own IP.
- **`CORS_ALLOWED_ORIGINS`** and the five `*_BASE_URL` values are now derived from `APP_DOMAIN`.
  Check the derived values look right rather than pasting the old ones.

`apps/api/.env` is no longer read in production. Leave it for development or delete it; the
production stack does not look at it.

### 6. Start and verify

```bash
docker compose up -d --build
deployments/hgn/verify.sh https://your.real.domain
```

Note there are no `-f` flags: `COMPOSE_FILE` in `.env` supplies them.

`verify.sh` should report 0 failures. If it reports that the proxy is not on loopback, or that
`plane-db` holds unrelated secrets, `COMPOSE_FILE` is not being picked up — check you are in the
repository root and that `.env` has all three files listed.

### 7. Update the host nginx

The vhost template was renamed and gained gzip and a hardened upgrade map. Your installed copy
still works, so this is optional, but the new one is what the guide describes:

```bash
sudo cp deployments/hgn/nginx.conf /etc/nginx/sites-available/workspaces.conf
sudo sed -i 's/workspaces.example.com/your.real.domain/g' /etc/nginx/sites-available/workspaces.conf
# re-add the certbot certificate lines if your existing file has them and the template's paths differ
sudo nginx -t && sudo systemctl reload nginx
```

If you previously put the `map $http_upgrade $connection_upgrade` block in
`/etc/nginx/conf.d/upgrade-map.conf`, the new vhost no longer needs it — it declares its own map
under a vhost-specific name. Leaving the old file in place is harmless unless another site uses it.

### 8. Clean up

Once `verify.sh` passes and someone has signed in:

```bash
rm ~/old-secrets.txt .env.pre-restructure
```

### Rolling back

```bash
git checkout <the commit before the restructure>
mv .env.pre-restructure .env
docker compose -f docker-compose.yml -f deployments/hgn/docker-compose.prod.yml up -d --build
```

The volumes are untouched throughout, so this loses nothing.

---

## From a stock Plane install

The box runs upstream Plane (Docker Hub images, most likely installed by upstream's `setup.sh`) and
you want this fork instead, keeping the data.

### 1. Survey what is there

```bash
deployments/hgn/inspect-existing.sh          # assumes /opt/plane
OLD_DIR=/var/plane deployments/hgn/inspect-existing.sh
```

Read-only: it changes nothing. Three things in its output decide whether this is possible:

- **Postgres major version** must be 15, matching `postgres:15.7-alpine`. A 14 or 16 install needs
  a dump-and-restore across versions, not a volume reuse.
- **The last applied `db` migration** must be at or below this fork's latest (the script prints
  both). Upstream ahead of the fork means the fork's code would run against a newer schema.
- **`SECRET_KEY`** must be recoverable from the old env file. Without it the encrypted instance
  configuration rows are unreadable and the instance has to be reconfigured by hand.

### 2. Dump, don't share volumes

Point the new stack at a _copy_, so the old install stays bootable if you need to fall back.

```bash
OLD_DB=$(docker ps --format '{{.Names}}' | grep -E 'plane.*db|db.*plane' | head -1)
docker exec -t "$OLD_DB" pg_dump -U plane -d plane --no-owner --no-privileges | gzip > ~/stock-plane.sql.gz
docker run --rm -v <old_project>_uploads:/data -v ~:/backup \
  alpine:3.20 tar czf /backup/stock-uploads.tar.gz -C /data .
```

### 3. Stop the old stack and free the ports

```bash
cd /opt/plane && docker compose down          # or the old install's own command
```

Keep its volumes. Do not `down -v`.

### 4. Install this fork

Follow [`DEPLOYMENT.md`](../../DEPLOYMENT.md) §2 through §4, with one change in §3: after
`init-env.sh`, replace the generated `SECRET_KEY` with the old install's, and set
`COMPOSE_PROJECT_NAME` to something _different_ from the old prefix so the two sets of volumes
cannot collide.

### 5. Load the data, then start the rest

```bash
docker compose up -d plane-db plane-minio
gunzip -c ~/stock-plane.sql.gz | docker compose exec -T plane-db psql -U plane -d plane
docker run --rm -v ${COMPOSE_PROJECT_NAME}_uploads:/data -v ~:/backup \
  alpine:3.20 tar xzf /backup/stock-uploads.tar.gz -C /data

docker compose up -d --build       # migrator brings the schema up to 0123
deployments/hgn/verify.sh https://your.real.domain
```

### 6. Apply the Engineering Operations workflow

The migration creates the tables; the bootstrap creates the workflow the dashboards are phrased in.
Skip it and everything loads, nothing errors, and every number is zero. See
[`DEPLOYMENT.md` §7a](../../DEPLOYMENT.md#7a-apply-the-workflow-to-your-workspace).

---

## What changed

### Deleted

**Deployment paths that could only ever install stock Plane.** Each assembles or downloads
`makeplane/*` images published from upstream's Docker Hub account. This fork's code is not in those
images and the fork publishes none of its own, so none of these could deploy it.

| Path                                               | What it was                                                                                                                                            | Why it is gone                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deployments/cli/**` (14 files)                    | Upstream's interactive installer: `install.sh`, a compose file of `makeplane/*` images, `variables.env`, restore scripts, a README and its screenshots | Downloads its compose file and env template from `github.com/makeplane/plane` releases and pulls upstream images. `build.yml`'s `context: ../../` resolved to `<repo>/deployments`, which has no `apps/`, so its build-locally branch could not work from either location it is used |
| `deployments/aio/**` (6 files)                     | All-in-one single-container image                                                                                                                      | Its Dockerfile's only sources are `makeplane/plane-*:${PLANE_VERSION}`. There is no build-from-source stage                                                                                                                                                                          |
| `deployments/swarm/**`                             | `swarm.sh`, Docker Swarm deployment                                                                                                                    | Downloads upstream's compose file and runs `docker stack deploy`. This fork targets single-host Compose behind nginx                                                                                                                                                                 |
| `deployments/kubernetes/**`                        | A five-line README                                                                                                                                     | Links to upstream's Helm chart on Artifact Hub, which deploys `makeplane/*` images                                                                                                                                                                                                   |
| `apps/proxy/Caddyfile.aio.ce`                      | Caddyfile for the AIO image                                                                                                                            | Its only consumer was `deployments/aio/community/build.sh`                                                                                                                                                                                                                           |
| `deployments/cli/community/restore.sh`             | Volume restore                                                                                                                                         | Hard-codes the `plane-app` project prefix, so it exits 1 before doing anything on this fork's volumes                                                                                                                                                                                |
| `deployments/cli/community/restore-airgapped.sh`   | Restore for Plane's commercial air-gapped edition                                                                                                      | A product this fork does not ship, and broken as shipped: line 2 is `+set -euo pipefail`, and its quoted glob makes the loop iterate the literal string `*.tar.gz`                                                                                                                   |
| `deployments/cli/community/migration-0.13-0.14.sh` | One-time v0.13.2 → v0.14 volume migration                                                                                                              | The fork is at 1.4.2                                                                                                                                                                                                                                                                 |

Replacement for the two useful ones: `deployments/hgn/backup.sh`, and the restore procedure in
[`DEPLOYMENT.md` §9](../../DEPLOYMENT.md#restoring-a-backup) — both keyed on
`COMPOSE_PROJECT_NAME` rather than a hard-coded prefix.

**Image-publishing CI.**

| File                                       | Why it is gone                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/build-branch.yml`       | Publishes `makeplane/*` images to upstream's Docker Hub, needs `DOCKERHUB_*` secrets the fork does not have, and triggers on push to `preview` — the fork's working branch. Half its jobs referenced `deployments/aio` and `deployments/cli` |
| `.github/workflows/feature-deployment.yml` | Builds `./aio/Dockerfile-app`, a path that does not exist in the repository, and deploys via Helm to upstream's Tailscale-reachable preview cluster                                                                                          |

The other seven workflows — lint, types, CodeQL, i18n, copyright, react-doctor, check-version — are
untouched. If a fork-owned image pipeline is ever wanted, `build-branch.yml` is the template and is
one `git show` away.

**Superseded by this restructure.**

| File                                      | Replaced by                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deployments/hgn/docker-compose.prod.yml` | `deployments/production/compose.yml` (how it runs safely) + `deployments/hgn/compose.yml` (where traffic enters)                                                                                                                                                                                            |
| `deployments/hgn/nginx-workspaces.conf`   | `deployments/hgn/nginx.conf` — renamed, plus gzip, HSTS and a vhost-scoped upgrade map                                                                                                                                                                                                                      |
| `deployments/hgn/DEPLOYMENT.md`           | Folded into `DEPLOYMENT.md`. About half of it duplicated the root guide verbatim, its own preamble declared two sections out of date, it described the overlay as only a port change when it also carried the health checks, and it linked `../../deployment.md`, which 404s on a case-sensitive filesystem |
| `Deployment.md`                           | `DEPLOYMENT.md` — a case rename, matching `README.md`, `CONTRIBUTING.md`, `AGENTS.md`. **On a case-insensitive checkout (macOS, Windows) this arrives as a rename git may not apply cleanly** — if `git pull` leaves both or neither, `git checkout -- DEPLOYMENT.md`                                       |

**Dead configuration.**

| File                                                                                                            | Why it is gone                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/space/nginx/nginx.conf`                                                                                   | No Dockerfile copies it. `apps/space/Dockerfile.space` serves the app with `react-router-serve`                                                                                                                                                 |
| `apps/web/Dockerfile.dev`, `apps/admin/Dockerfile.dev`, `apps/space/Dockerfile.dev`, `apps/live/Dockerfile.dev` | No compose file, workflow or document references any of them. `CONTRIBUTING.md` runs the frontends with `pnpm dev` on the host. `apps/api/Dockerfile.dev` is kept — it is used by both `docker-compose-local.yml` and `docker-compose-test.yml` |
| `.idx/dev.nix`                                                                                                  | Unreferenced Google Project IDX config pinning Node 20 against the repository's Node 22 (`.node-version`, `package.json`)                                                                                                                       |

### Modified

| File                                  | Change                                                                                                                                                                                                                                                                                                                                     | Why                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`                  | Rewritten: one anchor for the four Django roles instead of four copies; explicit environment for `live`, `proxy`, `plane-db`, `plane-mq`, `plane-minio`; all seven Caddy variables; fail-fast `${VAR:?}` on the six secrets; MinIO pinned to `RELEASE.2025-09-07T16-13-09Z`; `proxy_data`/`proxy_config` volumes; `container_name` dropped | The base file both duplicated blocks and starved three containers of their configuration. Detail in [architecture.md](architecture.md#rewriting-the-root-compose-file-rather-than-patching-it) |
| `apps/proxy/Caddyfile.ce`             | Inline defaults on `FILE_SIZE_LIMIT`, `BUCKET_NAME` and `SITE_ADDRESS`; `caddy fmt`                                                                                                                                                                                                                                                        | Without the `SITE_ADDRESS` default the config is rejected outright — the outage that started this. `caddy fmt` silences a warning Caddy logs on every boot                                     |
| `.env.example`                        | One line: `LIVE_SERVER_SECRET_KEY`                                                                                                                                                                                                                                                                                                         | The base compose file now requires it; the live server exits without it                                                                                                                        |
| `apps/api/.env.example`               | Comment text only                                                                                                                                                                                                                                                                                                                          | It asserted that Compose never expands `${…}` inside an `env_file`. That is false on Compose 2.24+. The advice it justified is still correct, for a different reason                           |
| `deployments/hgn/inspect-existing.sh` | Derives the fork's latest migration instead of hard-coding `0122`; header points at this guide                                                                                                                                                                                                                                             | It was stale by one migration on the day it was written, and no document told anyone when to run it                                                                                            |

### Added

| File                                 | Purpose                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `deployments/production/compose.yml` | Health checks, start-up ordering, log rotation                                                                           |
| `deployments/hgn/compose.yml`        | Caddy on loopback, `TRUSTED_PROXIES=private_ranges`                                                                      |
| `deployments/hgn/.env.example`       | The production configuration template — the single source of truth                                                       |
| `deployments/hgn/init-env.sh`        | Generates `.env`: fills the domain, generates six secrets, `chmod 600`, checks the Compose version, validates the result |
| `deployments/hgn/verify.sh`          | The regression checklist, executable. 51 checks; exit code is the failure count                                          |
| `deployments/hgn/backup.sh`          | Postgres dump + uploads tar, checksummed and rotated                                                                     |
| `deployments/hgn/nginx.conf`         | Host nginx vhost, validated against nginx 1.24 and 1.28                                                                  |
| `DEPLOYMENT.md`                      | The one deployment guide                                                                                                 |
| `docs/deployment/architecture.md`    | Why the files look like this                                                                                             |
| `docs/deployment/migration.md`       | This document                                                                                                            |

---

## Merging upstream after this change

Add the upstream remote once:

```bash
git remote add upstream https://github.com/makeplane/plane.git
git fetch upstream
```

Then a merge behaves as follows.

**Deleted directories come back as modify/delete conflicts** whenever upstream edits them. Expect
this for `deployments/cli/**`, `deployments/aio/**` and `.github/workflows/build-branch.yml`,
which upstream touches regularly. The resolution is always the same:

```bash
git rm -r deployments/cli deployments/aio deployments/swarm deployments/kubernetes
git rm .github/workflows/build-branch.yml .github/workflows/feature-deployment.yml
git rm apps/proxy/Caddyfile.aio.ce apps/space/nginx/nginx.conf
git rm apps/web/Dockerfile.dev apps/admin/Dockerfile.dev apps/space/Dockerfile.dev apps/live/Dockerfile.dev
```

**Two files will genuinely conflict** and need reading: `docker-compose.yml` and
`apps/proxy/Caddyfile.ce`. Upstream has touched the compose file once since 2025-09 and the
Caddyfile four times, so this is rare but real. When resolving the Caddyfile, keep the `{$VAR:default}`
forms; when resolving the compose file, keep the anchor and the explicit `environment` blocks, and
check whether upstream added a service that needs adding to both overlays.

**Then re-run the gate.** Every one of these should pass before the merge is committed:

```bash
docker compose config --quiet                                    # production chain
docker compose -f docker-compose.yml config --quiet              # base alone
docker compose -f docker-compose-local.yml config --quiet        # dev
docker compose -f docker-compose-test.yml config --quiet         # test
docker run --rm -v "$PWD/apps/proxy/Caddyfile.ce:/c:ro" caddy:2.11-alpine \
  caddy validate --config /c --adapter caddyfile                 # with no environment at all
docker compose up -d --build && deployments/hgn/verify.sh https://your.domain
```

The Caddy check with an empty environment is the one that would have caught the original outage.
