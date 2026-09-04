# Deploying Workspaces

End-to-end guide for building this Plane fork from source and running it on a VPS, including
the Engineering Operations extension (`PROJECT.md`) and the Odoo attendance bridge.

Assumes an Ubuntu VPS with **8 GB RAM**, a domain you control, and **Docker Compose v2.24 or
newer**. A first run takes 20–35 minutes, nearly all of it the image build.

| If you want to…                             | Go to                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Deploy from scratch                         | §1 through §7                                                                        |
| Upgrade an existing install                 | [§8 Upgrading](#8-upgrading)                                                         |
| Understand what the ops layer does          | [`docs/engineering-operations.md`](docs/engineering-operations.md)                   |
| Dig into the Odoo bridge specifics          | [`deployments/hgn/DEPLOYMENT.md`](deployments/hgn/DEPLOYMENT.md)                     |
| Know which Odoo endpoints are still missing | [`odoo-implementation/ODOO_MODULE_SPEC.md`](odoo-implementation/ODOO_MODULE_SPEC.md) |

---

## Architecture

```
browser ──HTTPS──▶ nginx :443 ──127.0.0.1:8080──▶ Caddy ──▶ web      /*
                   (yours, on the host)            (in the  api      /api /auth /static
                                                    stack)  live     /live (websocket)
                                                            space    /spaces
                                                            admin    /god-mode
                                                            minio    /uploads
                                                              │
              worker  ─┐                                      └─ api ──X-Atlas-Key──▶ Odoo bridge
              beat    ─┼─ celery ── RabbitMQ                          (outbound only)
              migrator ┘             Postgres · Valkey
```

Two proxies on purpose. Your nginx keeps 443 and terminates TLS; the stack's bundled Caddy
keeps the path routing it already ships with and binds to loopback. Rebuilding Caddy's routes in
nginx would mean publishing five container ports and hand-writing every location block, so nginx
has a single `location /`.

**The beat scheduler is not optional here.** It is what runs the operations reminders — missing
work logs, missing check-ins, blocked and overdue work, requests waiting on a PM. Without it the
rest of the product works and the notifications simply never arrive.

---

## 1. Before you touch the server

### Push the code

The server deploys from git. Commit and push to your fork first, or you will build stock Plane
and wonder where the Operations section went.

```bash
git status --short          # nothing important uncommitted
git push origin preview
```

### Point the DNS

```bash
dig +short workspaces.example.com   # should print the VPS IP
```

Replace `workspaces.example.com` consistently everywhere below.

> [!WARNING]
> **HTTPS is a prerequisite of attendance, not a hardening step.** Browser geolocation only works
> in a secure context. On plain HTTP the check-in button reports location unavailable and nobody
> can clock in at all.

---

## 2. Docker and the code

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in

docker compose version          # must be v2.24.0 or newer — the overlay uses !override
```

```bash
sudo mkdir -p /opt/workspaces && sudo chown $USER:$USER /opt/workspaces
git clone -b preview <your-fork-url> /opt/workspaces
cd /opt/workspaces
```

### Don't run `setup.sh` on the server

It ends with `corepack enable` and `pnpm install`, which need a Node toolchain the server does
not have and the Docker build does not use. It creates the env files first, so it half-works and
then exits 1. Do the copies yourself:

```bash
cp .env.example .env
for s in web api space admin live; do cp apps/$s/.env.example apps/$s/.env; done
```

---

## 3. The two env files

This is where self-hosted Plane usually goes wrong. The root `.env` configures the
infrastructure containers; `apps/api/.env` configures Django. Where they overlap they must agree
exactly.

### Root `.env`

```dotenv
POSTGRES_USER="plane"
POSTGRES_PASSWORD="<long random string>"
POSTGRES_DB="plane"

RABBITMQ_USER="plane"
RABBITMQ_PASSWORD="<long random string>"
RABBITMQ_VHOST="plane"

# MinIO root credentials — treat as secrets
AWS_ACCESS_KEY_ID="<long random string>"
AWS_SECRET_ACCESS_KEY="<long random string>"
AWS_S3_ENDPOINT_URL="http://plane-minio:9000"
AWS_S3_BUCKET_NAME="uploads"
USE_MINIO=1

# Caddy stays plain HTTP on loopback; nginx in front does TLS.
# Leave SITE_ADDRESS as :80 so Caddy never tries to fetch its own certificate.
LISTEN_HTTP_PORT=8080
SITE_ADDRESS=:80
CERT_EMAIL=
TRUSTED_PROXIES=0.0.0.0/0
FILE_SIZE_LIMIT=5242880
```

### `apps/api/.env`

```dotenv
DEBUG=0

# Generate this. Do not leave it blank — see the trap below.
SECRET_KEY="<50 random chars>"

# The single most important line for whether login works at all.
CORS_ALLOWED_ORIGINS="https://workspaces.example.com"

# Must match the root .env
POSTGRES_USER="plane"
POSTGRES_PASSWORD="<same as root>"
POSTGRES_HOST="plane-db"
POSTGRES_DB="plane"
POSTGRES_PORT=5432
# Leave DATABASE_URL commented out — the POSTGRES_* variables above are enough.

REDIS_URL="redis://plane-redis:6379/"
RABBITMQ_HOST="plane-mq"
RABBITMQ_USER="plane"
RABBITMQ_PASSWORD="<same as root>"
RABBITMQ_VHOST="plane"

AWS_ACCESS_KEY_ID="<same as root>"
AWS_SECRET_ACCESS_KEY="<same as root>"
AWS_S3_ENDPOINT_URL="http://plane-minio:9000"
USE_MINIO=1

# Every one of these is the public https URL; the paths stay as they are
WEB_URL="https://workspaces.example.com"
APP_BASE_URL="https://workspaces.example.com"
ADMIN_BASE_URL="https://workspaces.example.com"
SPACE_BASE_URL="https://workspaces.example.com"
LIVE_BASE_URL="https://workspaces.example.com"

GUNICORN_WORKERS=4

# Attendance. Leave blank for now; §6 switches it on.
ODOO_BASE_URL=""
ODOO_API_KEY=""
```

```bash
# generate the secret key
python3 - <<'PY'
import secrets, string
print("".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(50)))
PY
```

### Four traps in this step

**`SECRET_KEY` must be set.** Left blank, Django generates a random one _per process_. The api,
worker and beat containers each end up with a different key, and every restart invalidates every
session and every password-reset link. It presents as users being logged out at random.

**`CORS_ALLOWED_ORIGINS` decides whether login works at all.** Django derives
`SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` and `CSRF_TRUSTED_ORIGINS` from this one variable.
If _any_ origin in the list starts with `http:`, secure cookies are switched off for all of them.
Leave the stock localhost list in place and sign-in fails with a CSRF error that never names the
cause. One origin, `https://`, no trailing slash.

**Never write `${...}` in `DATABASE_URL` or `REDIS_URL`.** Compose passes `env_file` values
through literally — it does not expand them. Django prefers `DATABASE_URL` over the discrete
`POSTGRES_*` variables the moment it is non-empty, so a placeholder-shaped URL produces a
database host called `${POSTGRES_HOST}`. The shipped example now has it commented out; leave it
that way, or write the URL out in full.

**Two storage defaults are wrong for containers.** `apps/api/.env.example` ships
`AWS_S3_ENDPOINT_URL="http://localhost:9000"` and `USE_MINIO=0`. Inside the api container
`localhost` is that container, so uploads fail. And because `WEB_URL`'s scheme becomes the public
prefix for every uploaded file, an `http://` there means images get blocked as mixed content on
your HTTPS page.

---

## 4. nginx and TLS

`$connection_upgrade` is not built in and must be defined once at `http{}` level:

```nginx
# /etc/nginx/conf.d/upgrade-map.conf
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

```bash
sudo cp deployments/hgn/nginx-workspaces.conf /etc/nginx/sites-available/workspaces.conf
sudo sed -i 's/workspaces.example.com/your.real.domain/g' \
        /etc/nginx/sites-available/workspaces.conf
sudo ln -s /etc/nginx/sites-available/workspaces.conf /etc/nginx/sites-enabled/

# The 443 block references certs that don't exist yet. Comment it out, bring nginx
# up on 80, then let certbot write the block back in.
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your.real.domain
```

**Why `X-Forwarded-Proto` matters:** Django's production settings read that header to decide
whether a request is secure. The template sets it. Drop it and every session cookie is issued as
though the site were plain HTTP — which looks like a login that submits, succeeds, and lands you
back on the sign-in page.

---

## 5. Bring the stack up

Always pass both compose files. The overlay is what keeps Caddy off ports 80 and 443 and what
adds the health checks and startup ordering, so starting without it collides with nginx _and_
lets the beat scheduler race the database.

```bash
echo 'alias dcw="docker compose -f docker-compose.yml -f deployments/hgn/docker-compose.prod.yml"' \
  >> ~/.bashrc && source ~/.bashrc
```

```bash
# Confirm the merge before building
dcw config | grep -A4 'proxy:' | grep -A3 ports
# expect exactly one mapping: 127.0.0.1:8080 -> 80
# if you also see 80:80 or 443:443, the overlay didn't apply — check the compose version
```

```bash
dcw up -d --build     # first build pulls and compiles; give it 15–30 min
```

The overlay makes the start-up order real, so this takes a minute longer than it used to and
that is the point:

```
plane-db, plane-redis, plane-mq   → healthy
migrator                          → runs the migrations, exits 0
api, worker, beat-worker          → start only after the migrator succeeded
```

```bash
dcw ps
# plane-migrator: Exited (0)          ← correct, it is a one-shot
# api:            Up (healthy)
# bgworker,
# beatworker:     Up                  ← no health check; they serve no HTTP
```

If `api` sits at `Up (health: starting)` for more than two minutes, follow it:

```bash
dcw logs -f api
```

Then open `https://your.real.domain/god-mode` and create the instance administrator. That account
configures the instance; ordinary members sign up on the main app afterwards.

---

## 6. Set up Engineering Operations

Two steps. The first is required; the second is only needed if you want attendance.

### 6a. Apply the workflow to your workspace

`PROJECT.md` fixes a nine-state workflow, a label vocabulary and nine work item types. The
bootstrap creates them. It is **additive and idempotent** — anything that already exists is left
exactly as it is, and nothing is ever deleted, so it is safe to re-run.

```bash
# See what it would do first
dcw exec api python manage.py bootstrap_engineering_ops --workspace <your-slug> --dry-run

# Then do it
dcw exec api python manage.py bootstrap_engineering_ops --workspace <your-slug>
```

```
Applying 9 states, 22 labels and 9 issue types to hgn.
  Travel Portal
    states:  +4 Ready for Test Deployment, QA Testing, Ready for Release, Halt
    renamed: Done -> Deployed
    labels:  +22
  issue types: +9 created, 9 project links
Done.
```

The one non-additive thing it does is rename a project's `Done` state to `Deployed`, and only
while no work item is sitting in it. Past that point the name is part of somebody's history and
it is left alone — you will get a separate `Deployed` state instead.

A workspace admin can do the same thing from the UI at **Operations → Settings → Apply the
engineering workflow**. Same code path.

> [!NOTE]
> If your projects already have their own state names, skip the bootstrap and map them instead:
> **Operations → Settings → State mapping**. Every dashboard and metric is phrased in semantic
> buckets (`qa`, `blocked`, `developer_owned`…), and that screen is what tells them which of your
> states fill each one. Leave it wrong and the dashboards read zero without erroring.

### 6b. Confirm the reminders are scheduled

The beat scheduler keeps its schedule in the database and syncs the code's entries into it on
start-up. Four should appear:

```bash
dcw exec api python manage.py shell -c "
from django_celery_beat.models import PeriodicTask
for t in PeriodicTask.objects.filter(name__startswith='engineering-ops'):
    print(t.name, '->', t.task, '[enabled]' if t.enabled else '[DISABLED]')
"
```

```
engineering-ops-missing-work-logs   -> ...operations_reminder_task.remind_missing_work_logs   [enabled]
engineering-ops-missing-attendance  -> ...operations_reminder_task.remind_missing_attendance  [enabled]
engineering-ops-blocked-and-overdue -> ...operations_reminder_task.remind_blocked_and_overdue [enabled]
engineering-ops-operations-tickets  -> ...operations_reminder_task.remind_operations_tickets  [enabled]
```

Nothing printed means the beat worker has not started yet — `dcw logs beatworker`.

You can run one by hand rather than waiting for the schedule:

```bash
dcw exec api python manage.py shell -c "
from plane.bgtasks.operations_reminder_task import remind_blocked_and_overdue
print(remind_blocked_and_overdue(), 'notifications queued')
"
```

The work-log and attendance reminders are hourly and each checks the workspace's _local_ hour
before firing (17:00 and 10:00 by default, configurable in Operations → Settings). Running them
outside those hours correctly queues nothing.

---

## 7. Switch attendance on

The stack runs fine without this. With `ODOO_BASE_URL` unset the status endpoint reports the
feature unavailable, the navbar control hides itself and the attendance screen says so plainly —
no errors, nothing broken.

> [!IMPORTANT]
> **Do the allow-list first — it's on another machine.** `/api/v1/*` on the Odoo host is
> restricted at its reverse proxy to the Atlas API host's IP. This VPS is a new client and will
> be denied until its address is added. Expect the first end-to-end test to fail with a 403 from
> nginx rather than anything in Plane.

```nginx
# on the Odoo host (VM01)
location /api/v1/ {
    allow 172.16.10.54;          # the Atlas API host
    allow <this VPS public IP>;  # add this line
    deny all;
    proxy_pass http://odoo;
}
```

```dotenv
# apps/api/.env
ODOO_BASE_URL="https://<the odoo host>"   # no trailing slash
ODOO_API_KEY="<from Odoo → Settings → Atlas Bridge>"
```

> [!WARNING]
> **Never regenerate that key.** Atlas is a second consumer of the same bridge and holds the same
> key. Generating a new one in Odoo silently breaks Atlas. Read the existing key; don't create one.

```bash
dcw up -d --force-recreate api worker beat-worker
# env_file is read at container creation — a restart alone won't pick it up
```

### What works and what doesn't yet

The deployed bridge serves three endpoints: today's status, check in, check out. Everything built
on those works now. Four more are called but **not yet served**, and they answer `200` with
`{"available": false}` rather than an error:

| Screen                     | State                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| Navbar check in / out      | Works                                                                             |
| Attendance → Today         | Works                                                                             |
| Attendance → History       | Needs `GET /api/v1/attendance/history`                                            |
| Attendance → Leave         | Needs `GET /api/v1/leave/me`                                                      |
| Attendance → Holidays      | Needs `GET /api/v1/holidays`                                                      |
| Attendance → Working hours | Needs `GET /api/v1/employees/working-hours`                                       |
| Attendance → Who is in     | Works — falls back to a cached per-person fan-out until `/attendance/team` exists |

Contracts for the missing five are in
[`odoo-implementation/ODOO_MODULE_SPEC.md`](odoo-implementation/ODOO_MODULE_SPEC.md). Once the
Odoo module ships they start returning data with no change on this side and no redeploy.

### Prove the email mapping before the team notices

Every Workspaces account is supposed to match an Odoo employee by email. Intent drifts — a married
name, a `@hgn` vs `@hgsoftware` address, one contractor added in a hurry. Check once; it turns a
fortnight of one-off complaints into a list.

```bash
dcw exec api python manage.py shell -c \
  "from plane.db.models import User; print('\n'.join(User.objects.filter(is_active=True).values_list('email', flat=True)))" \
  | tr 'A-Z' 'a-z' | sort > /tmp/plane-users.txt

curl -s -H "X-Atlas-Key: $KEY" "$ODOO/api/v1/employees" \
  | jq -r '.employees[].work_email // empty' | tr 'A-Z' 'a-z' | sort > /tmp/odoo-emails.txt

comm -23 /tmp/plane-users.txt /tmp/odoo-emails.txt   # accounts with no employee
```

---

## 8. Verify, working outward

### The stack

```bash
dcw ps                                   # api healthy, migrator exited 0
curl -s https://your.real.domain/api/instances/ | head -c 200
```

### Engineering Operations

Signed in, in a browser:

- [ ] **Operations** appears in the left sidebar, below Projects.
- [ ] `/<workspace>/operations` loads and the four dashboard tabs (My work, Project manager, QA,
      DevOps) each render without an error panel.
- [ ] **Work logs** — today's draft appears without you creating it, autosaves as you type
      ("Saved" under the hours field), and **File it** refuses an empty log.
- [ ] **Requests** — file one, move it New → PM review → Approved, then convert it into a work
      item. The new work item opens, carries the description and priority, and the ticket becomes
      read-only with a link to it.
- [ ] **Records** — create one; it does **not** appear in any project's work item list.
- [ ] **Deployments** — record one, set it to Deployed, and confirm the completed time filled
      itself in.
- [ ] **Analytics** — the four sections load. Empty numbers on a new install are correct; an
      error panel is not.
- [ ] **Reports** — pick Weekly, then **Copy as text**.
- [ ] A hard refresh on a deep link like `/<workspace>/operations/work-logs` still loads. If it
      404s, Caddy's SPA fallback is not in play.

The dashboards read zero on a brand-new workspace and that is correct — they measure work that
has moved through the workflow. Come back after a sprint.

### Attendance

```bash
# 1 · the bridge, from the VPS itself
KEY=<key>; ODOO=https://<odoo host>
curl -s -o /dev/null -w '%{http_code}\n' "$ODOO/api/v1/health"   # 401 — key required
curl -s -H "X-Atlas-Key: $KEY" "$ODOO/api/v1/health"             # 200 — names the db
# a 403 here is the allow-list, not your code
```

```bash
# 2 · through Plane, signed in as yourself
curl -s -b <cookie jar> https://your.real.domain/api/attendance/me/

# the test that proves the enforcement is real —
# the bridge would happily accept this, Plane must not
curl -s -X POST -b <cookie jar> -H 'Content-Type: application/json' \
  -d '{}' https://your.real.domain/api/attendance/check-in/
# expect 400 location_required
```

The full attendance checklist — including the cases that must _not_ write to Odoo — is in
[`deployments/hgn/DEPLOYMENT.md` §7](deployments/hgn/DEPLOYMENT.md).

---

## 9. Upgrading

```bash
cd /opt/workspaces
dcw exec -T plane-db pg_dump -U plane plane | gzip > ~/plane-$(date +%F).sql.gz   # back up first
git pull
dcw up -d --build
```

The migrator runs automatically and the api, worker and beat wait for it to exit 0 before
starting — so a failed migration now stops the deploy instead of leaving a running api on a
half-migrated schema. Watch it:

```bash
dcw logs -f plane-migrator
dcw logs -f api
```

### Upgrading onto the Engineering Operations release specifically

```bash
# 1 · confirm the migration landed
dcw exec api python manage.py showmigrations db | grep 0123
# [X] 0123_engineering_operations

# 2 · apply the workflow (§6a) — new tables alone give you empty dashboards
dcw exec api python manage.py bootstrap_engineering_ops --workspace <your-slug> --dry-run

# 3 · confirm the four reminders registered (§6b)
```

### Backups

```bash
dcw exec -T plane-db pg_dump -U plane plane | gzip > ~/plane-$(date +%F).sql.gz
docker run --rm -v workspaces_uploads:/data -v ~:/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Volume names are prefixed with the compose project name — confirm yours with `docker volume ls`.

### The env files are not in git, by design

`.env` is gitignored, so a `git pull` never touches your secrets — and equally, nothing on the
server is backed up by pushing. Keep both env files somewhere safe outside the repo.

---

## 10. Symptoms worth recognising

Each of these presents as something other than its cause.

| What you see                                       | What it actually is                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Users logged out at random                         | `SECRET_KEY` is blank, so each container generated its own                                                                          |
| Login submits, returns to sign-in                  | `CORS_ALLOWED_ORIGINS` still contains an `http:` origin, or nginx isn't sending `X-Forwarded-Proto`                                 |
| `could not translate host name "${POSTGRES_HOST}"` | `DATABASE_URL` still has `${...}` placeholders in it — comment it out                                                               |
| Stack won't start, port in use                     | The overlay wasn't applied — Caddy tried to take 80/443. Check `docker compose version` ≥ 2.24                                      |
| `api` never leaves `health: starting`              | `dcw logs api`. Usually the database URL or a missing `SECRET_KEY`                                                                  |
| `bgworker`/`beatworker` restarting                 | RabbitMQ wasn't ready. The overlay fixes the ordering — check you passed both compose files                                         |
| Operations sidebar entry missing                   | You are on a stale web image. `dcw up -d --build web`                                                                               |
| Operations pages load, every number is zero        | Either a genuinely new workspace, or the state mapping doesn't match your states — §6a                                              |
| Deep link 404s on refresh, works when clicked      | Caddy's SPA fallback isn't serving `index.html` — you are not on the stack's own web image                                          |
| Reminders never arrive                             | The beat worker is down, or `engineering-ops-*` is missing from `PeriodicTask` — §6b                                                |
| Work log won't submit                              | Correct. An empty log is refused so the "missing logs" count can't be zeroed by clicking the button                                 |
| Ticket won't convert                               | It must be **Approved** first, you must be a member of the target project, and it converts exactly once                             |
| Check-in button absent                             | Expected when `ODOO_BASE_URL` is unset. Otherwise the bridge is unreachable — look for a `plane.external` warning in `dcw logs api` |
| 403 from the bridge                                | The VPS IP isn't in the Odoo allow-list (§7)                                                                                        |
| "Location is unavailable"                          | The page isn't on HTTPS, or the certificate isn't trusted                                                                           |
| One person can't check in                          | Their Workspaces email doesn't match an Odoo `work_email`. The message names the fix; the server logs it at warning level           |
| Attendance history says "not available yet"        | Expected. That bridge endpoint doesn't exist — §7                                                                                   |
| Images upload but don't render                     | `WEB_URL` is `http://`, so file URLs are mixed content                                                                              |
| Pages load but never sync                          | The websocket upgrade headers are missing from the nginx location block                                                             |

---

## The order that matters

Three steps are on machines other than the VPS, and each blocks a later phase in a way that reads
like a bug in the code. Do them early:

1. **Push the commit** — the server deploys from git.
2. **Point the DNS** — TLS gates attendance entirely.
3. **Get the VPS IP onto the Odoo allow-list** — someone else may have to do this for you.

And one that is easy to forget because nothing complains: **run the bootstrap (§6a)**. The
migration creates the tables; the bootstrap creates the workflow the dashboards are phrased in.
Skip it and everything loads, nothing errors, and every number is zero.
