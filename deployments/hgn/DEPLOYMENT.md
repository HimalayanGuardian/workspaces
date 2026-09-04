# Attendance appendix — Odoo bridge specifics

> [!NOTE]
> **Start with [`deployment.md`](../../deployment.md) in the repository root.** That is the
> current end-to-end guide and it covers the whole platform, including the Engineering
> Operations layer. This file is kept for the parts it goes deeper on: the Odoo allow-list, the
> bridge's error contract, and the full attendance verification checklist (§6–§7 below).
>
> Two things here are now out of date: §1 says the attendance feature is uncommitted (it is
> committed), and the guide predates the Engineering Operations extension, so it has nothing
> about the migration, the workflow bootstrap or the reminder scheduler.

Building this Plane fork from source behind an nginx that already runs on the box, and
switching on Odoo attendance once it's up.

Assumes: Ubuntu VPS with 8 GB RAM, nginx already holding ports 80/443, a domain you control,
and Docker Compose **v2.24 or newer**. First run takes 20–35 minutes, most of it the build.

Files referenced here live beside this one:

| File                      | Purpose                                     |
| ------------------------- | ------------------------------------------- |
| `docker-compose.prod.yml` | Production overlay — keeps Caddy off 80/443 |
| `nginx-workspaces.conf`   | Host nginx vhost template                   |

---

## Architecture: two proxies, on purpose

```
browser ──HTTPS──▶ nginx :443 ──127.0.0.1:8080──▶ Caddy ──▶ web      /*
                   (already yours)                 (in the   api      /api /auth /static
                                                    stack)   live     /live (websocket)
                                                             space    /spaces
                                                             admin    /god-mode
                                                             minio    /uploads
                                                                │
                                                                └─ api ──X-Atlas-Key──▶ Odoo bridge
                                                                        (outbound only)
```

Your nginx keeps 443 and terminates TLS. The stack's bundled Caddy keeps the path routing it
already ships with and binds to loopback. Rebuilding Caddy's routes in nginx would mean
publishing five container ports and hand-writing every location block, so instead nginx has a
single `location /`.

---

## 1. Before you touch the server

### Push the code

> [!IMPORTANT]
> The attendance feature is currently **uncommitted** in the working tree. The server deploys
> from git, so commit and push to your fork first — otherwise you'll build stock Plane and
> wonder where the button went.

```bash
# on your Mac
git add apps/api apps/web deployments/hgn
git commit -m "feat(attendance): add Odoo check in/out control to the top navigation"
git push origin preview
```

### Point the DNS

Add an A record for the VPS and let it propagate. The hostname goes everywhere below as
`workspaces.example.com` — replace it consistently.

```bash
dig +short workspaces.example.com   # should print the VPS IP
```

> [!WARNING]
> **HTTPS is a prerequisite of the feature, not a hardening step.** Browser geolocation only
> works in a secure context. On plain HTTP the check-in button reports location unavailable and
> nobody can clock in at all.

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

It ends with `corepack enable` and `pnpm install`, which need Node that a server doesn't have
and that Docker builds don't use. It creates the env files first, so it half-works and then
exits 1. Do the copies yourself:

```bash
cp .env.example .env
for s in web api space admin live; do cp apps/$s/.env.example apps/$s/.env; done
echo "SECRET_KEY=\"$(tr -dc 'a-z0-9' </dev/urandom | head -c50)\"" >> apps/api/.env
```

---

## 3. The two env files

This is where self-hosted Plane usually goes wrong. The root `.env` configures the
infrastructure containers; `apps/api/.env` configures Django. Where they overlap they must
agree exactly.

### Root `.env`

```dotenv
POSTGRES_USER="plane"
POSTGRES_PASSWORD="<long random string>"
POSTGRES_DB="plane"

RABBITMQ_USER="plane"
RABBITMQ_PASSWORD="<long random string>"
RABBITMQ_VHOST="plane"

# these are the MinIO root credentials — treat them as secrets
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

# The single most important line in this file. See the trap below.
CORS_ALLOWED_ORIGINS="https://workspaces.example.com"

# must match the root .env, and be written out in full
POSTGRES_USER="plane"
POSTGRES_PASSWORD="<same as root>"
POSTGRES_HOST="plane-db"
POSTGRES_DB="plane"
POSTGRES_PORT=5432
DATABASE_URL=postgresql://plane:<same>@plane-db:5432/plane

REDIS_URL="redis://plane-redis:6379/"
RABBITMQ_HOST="plane-mq"
RABBITMQ_USER="plane"
RABBITMQ_PASSWORD="<same as root>"
RABBITMQ_VHOST="plane"

AWS_ACCESS_KEY_ID="<same as root>"
AWS_SECRET_ACCESS_KEY="<same as root>"
AWS_S3_ENDPOINT_URL="http://plane-minio:9000"
USE_MINIO=1

# every one of these is the public https URL — the paths stay as they are
WEB_URL="https://workspaces.example.com"
APP_BASE_URL="https://workspaces.example.com"
ADMIN_BASE_URL="https://workspaces.example.com"
SPACE_BASE_URL="https://workspaces.example.com"
LIVE_BASE_URL="https://workspaces.example.com"

GUNICORN_WORKERS=4
```

### Three traps in this step

**`CORS_ALLOWED_ORIGINS` decides whether login works at all.** Django derives
`SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` and `CSRF_TRUSTED_ORIGINS` from this one
variable. If _any_ origin in the list starts with `http:`, secure cookies are switched off for
all of them. Leave the stock localhost list in place and sign-in fails with a CSRF error that
never names the cause. One origin, `https://`, no trailing slash.

**Write `DATABASE_URL` out literally.** The shipped example uses `${POSTGRES_USER}`-style
expansion. Compose passes `env_file` values through as raw strings, so those placeholders can
reach Django unexpanded and produce a database host that doesn't exist. Typing the URL out
costs nothing and removes the question.

**Two storage defaults are wrong for containers.** `apps/api/.env.example` ships
`AWS_S3_ENDPOINT_URL="http://localhost:9000"` and `USE_MINIO=0`. Inside the api container
`localhost` is that container, so uploads fail. And because `WEB_URL`'s scheme becomes the
public prefix for every uploaded file, an `http://` there means images get blocked as mixed
content on your HTTPS page.

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
sudo cp deployments/hgn/nginx-workspaces.conf \
        /etc/nginx/sites-available/workspaces.conf
sudo sed -i 's/workspaces.example.com/your.real.domain/g' \
        /etc/nginx/sites-available/workspaces.conf
sudo ln -s /etc/nginx/sites-available/workspaces.conf /etc/nginx/sites-enabled/

# the 443 block references certs that don't exist yet — comment it out, bring nginx
# up on 80, and let certbot write the block back in
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your.real.domain
```

**Why `X-Forwarded-Proto` matters:** Django's production settings read that header to decide
whether a request is secure. The template sets it. Drop it and every session cookie is issued
as though the site were plain HTTP — which looks like a login that submits, succeeds, and
lands you back on the sign-in page.

---

## 5. Bring the stack up

Always pass both compose files. The overlay is what keeps Caddy off ports 80 and 443, so
starting without it collides with nginx.

```bash
echo 'alias dcw="docker compose -f docker-compose.yml -f deployments/hgn/docker-compose.prod.yml"' \
  >> ~/.bashrc && source ~/.bashrc
```

```bash
# confirm the merge before building
dcw config | grep -A4 'proxy:' | grep -A3 ports
# expect exactly one mapping: 127.0.0.1:8080 -> 80
# if you also see 80:80 or 443:443, the overlay didn't apply — check the compose version
```

```bash
dcw up -d --build     # first build pulls and compiles; give it 15–30 min
dcw ps                # every service up; plane-migrator exits 0, which is correct
dcw logs -f api
```

Then open `https://your.real.domain/god-mode` and create the instance administrator. That
account configures the instance; ordinary members sign up on the main app afterwards.

---

## 6. Switch attendance on

The stack runs fine without this. With `ODOO_BASE_URL` unset the status endpoint reports the
feature unavailable and the navbar simply doesn't render the control — no errors, nothing
broken.

> [!IMPORTANT]
> **Do the allow-list first — it's on another machine.** `/api/v1/*` on the Odoo host is
> restricted at its reverse proxy to the Atlas API host's IP. This VPS is a new client and will
> be denied until its address is added. Expect the first end-to-end test to fail with a 403
> from nginx rather than anything in Plane.

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
# append to apps/api/.env
ODOO_BASE_URL="https://<the odoo host>"   # no trailing slash
ODOO_API_KEY="<from Odoo → Settings → Atlas Bridge>"
```

> [!WARNING]
> **Never regenerate that key.** Atlas is a second consumer of the same bridge and holds the
> same key. Generating a new one in Odoo silently breaks Atlas. Read the existing key; don't
> create one.

```bash
dcw up -d --force-recreate api worker
# env_file is read at container creation — a restart alone won't pick it up
```

### Prove the email mapping before the team notices

Every Workspaces account is supposed to match an Odoo employee by email. Intent drifts — a
married name, a `@hgn` vs `@hgsoftware` address, one contractor added in a hurry. Check once;
it turns a fortnight of one-off complaints into a list.

```bash
dcw exec api python manage.py shell -c \
  "from plane.db.models import User; print('\n'.join(User.objects.filter(is_active=True).values_list('email', flat=True)))" \
  | tr 'A-Z' 'a-z' | sort > /tmp/plane-users.txt

curl -s -H "X-Atlas-Key: $KEY" "$ODOO/api/v1/employees" \
  | jq -r '.employees[].work_email // empty' | tr 'A-Z' 'a-z' | sort > /tmp/odoo-emails.txt

comm -23 /tmp/plane-users.txt /tmp/odoo-emails.txt   # accounts with no employee
```

---

## 7. Verify, working outward

Don't skip the curl step — it separates "my config is wrong" from "the network is wrong".

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

Then in the browser:

- [ ] The control appears in the top bar, immediately left of your avatar.
- [ ] Check in — then confirm the record appears in Odoo's attendance view **with the
      coordinates on it**, not just in the UI.
- [ ] Check out; the hours land.
- [ ] Deny location, try to check in — refused with the "allow location" message, and **nothing
      written to Odoo**. Verify the second half in Odoo.
- [ ] Deny location and check _out_ — this must still succeed, or an open session is stranded
      with Odoo counting hours.
- [ ] Open two tabs and check in from both — no duplicate session, no alarming error.
- [ ] Break `ODOO_API_KEY` on purpose — the control disappears and the rest of the workspace is
      unaffected.

**One thing to pass on:** bridge punches are labelled _Atlas_ in Odoo, so a Workspaces punch
and an Atlas punch look identical there. Separating them would need a new value in the addon,
which is a module upgrade on VM01 and out of scope.

---

## 8. Symptoms worth recognising

Each of these presents as something other than its cause.

| What you see                      | What it actually is                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Login submits, returns to sign-in | `CORS_ALLOWED_ORIGINS` still contains an `http:` origin, or nginx isn't sending `X-Forwarded-Proto`                                 |
| Stack won't start, port in use    | The overlay wasn't applied — Caddy tried to take 80/443. Check `docker compose version` ≥ 2.24                                      |
| Check-in button absent            | Expected when `ODOO_BASE_URL` is unset. Otherwise the bridge is unreachable — look for a `plane.external` warning in `dcw logs api` |
| 403 from the bridge               | The VPS IP isn't in the Odoo allow-list (§6)                                                                                        |
| "Location is unavailable"         | The page isn't on HTTPS, or the certificate isn't trusted                                                                           |
| One person can't check in         | Their Workspaces email doesn't match an Odoo `work_email`. The message names the fix; the server logs it at warning level           |
| Images upload but don't render    | `WEB_URL` is `http://`, so file URLs are mixed content                                                                              |
| Pages load but never sync         | The websocket upgrade headers are missing from the nginx location block                                                             |

---

## 9. Updating later

```bash
cd /opt/workspaces && git pull
dcw up -d --build      # migrator runs automatically before api comes back
dcw logs -f api
```

### Backing up first

```bash
dcw exec -T plane-db pg_dump -U plane plane | gzip > ~/plane-$(date +%F).sql.gz
docker run --rm -v workspaces_uploads:/data -v ~:/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Volume names are prefixed with the compose project name — confirm yours with
`docker volume ls`.

### The env files are not in git, by design

`.env` is gitignored, so a `git pull` never touches your secrets — and equally, nothing on the
server is backed up by pushing. Keep both env files somewhere safe outside the repo.

---

## The order that matters

Three steps are on machines other than the VPS, and each blocks a later phase in a way that
reads like a bug in the code. Do them early:

1. **Push the commit** — the server deploys from git.
2. **Point the DNS** — TLS gates the whole feature.
3. **Add this VPS's IP to the Odoo allow-list** — otherwise your first test fails with a 403.

Everything else is recoverable in place.
