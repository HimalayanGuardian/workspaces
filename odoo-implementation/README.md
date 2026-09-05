# atlas-odoo-bridge

An Odoo addon that exposes a small REST API over Odoo's HR models so [Atlas](https://github.com/HimalayanGuardian/atlas-backend)
can offer attendance, leave and holiday features without employees ever logging into Odoo.

**Odoo stays the system of record.** This module stores nothing of its own and adds no business rules — every
endpoint is a thin projection of `hr.employee`, `hr.attendance`, `hr.leave` and `resource.calendar.leaves`.
Atlas never talks to Odoo models directly; it only speaks to these endpoints.

- Odoo **17.0+**
- Depends on `hr`, `hr_attendance`, `hr_holidays`

> [!IMPORTANT]
> **This is the Odoo addon's own document, written for Atlas.** It is kept here for reference; it
> is not the guide for deploying Workspaces. Two of its instructions do not apply to this
> repository:
>
> - Where it says to **generate a new API key**, do not. Atlas is already a consumer of the same
>   bridge and holds the same key; generating a new one silently breaks Atlas. Read the existing
>   key instead.
> - Its note that `ODOO_BASE_URL` / `ODOO_API_KEY` are only a first-boot fallback describes
>   Atlas's settings model. In Workspaces those two variables in `.env` are the _only_ source, and
>   `api`, `worker` and `beat-worker` must be recreated for a change to take effect.
>
> See [`DEPLOYMENT.md` §8](../DEPLOYMENT.md#8-switch-attendance-on).

---

## Deployment

This addon deploys to the **Odoo host**, not to the Atlas host. It is a separate target on its own cadence —
`git pull && docker compose up` in the Atlas project will never touch it, and does not need to.

```
Atlas server                      Odoo server
├── atlas-api      ──HTTPS──▶     └── odoo
└── atlas-postgres                    └── custom-addons/atlas-odoo-bridge
```

Odoo's `addons_path` points at a directory _containing_ modules, and this repository's root contains
`atlas_bridge/`. So mount **the repository root**, not the inner module directory — then `git pull` is the whole
update.

### First install (Odoo in Docker)

```bash
cd /path/to/odoo
mkdir -p custom-addons && cd custom-addons
git clone https://github.com/HimalayanGuardian/atlas-odoo-bridge.git
```

Add the mount to Odoo's `docker-compose.yml`:

```yaml
services:
  odoo:
    volumes:
      - ./custom-addons/atlas-odoo-bridge:/mnt/extra-addons/atlas-odoo-bridge
```

`/mnt/extra-addons` is already on the addons path in the official image. If yours uses a custom `odoo.conf`,
add the directory to `addons_path` there instead.

```bash
docker compose up -d
```

Then, in Odoo: **Apps → Update Apps List → Atlas Bridge → Install**.

### Updating

The step that is easy to forget is the module upgrade — restarting Odoo reloads controller code but does
**not** apply changes to models or views.

```bash
cd /path/to/odoo/custom-addons/atlas-odoo-bridge && git pull
cd /path/to/odoo
docker compose exec odoo odoo -u atlas_bridge -d <database> --stop-after-init
docker compose restart odoo
```

Realistically this is rare: the addon is a few hundred lines with no dependencies and no business logic of its
own, so it changes far less often than Atlas does.

### Installed natively instead?

Clone to `/opt/odoo/custom-addons/atlas-odoo-bridge`, add that path to `addons_path` in `odoo.conf`, then
`sudo systemctl restart odoo` and upgrade the module from the Apps screen.

## Configure

**Settings → Atlas Bridge → API access → Generate a new key**, then save.

Then, in Atlas, sign in as an administrator and go to **Settings → Odoo connection**: paste the URL and the key,
and press **Test connection**. That is the whole handshake — **the credentials live in Atlas's database, not in
its environment, so connecting Odoo needs no redeploy and no downtime.**

`ODOO_BASE_URL` / `ODOO_API_KEY` in the Atlas backend's `.env` are a first-boot fallback for a fresh database
only. Once an administrator saves the values in Settings the stored values win, and editing `.env` has no effect.

The key can also be set from the shell:

```bash
odoo shell -d <database> <<'PY'
env["ir.config_parameter"].sudo().set_param("atlas_bridge.api_key", "…")
env.cr.commit()
PY
```

**With no key set, every endpoint returns 503.** That is deliberate — a blank secret must never compare equal to
a blank header, so an unconfigured bridge is a closed one.

### Two things that catch people out

**The Atlas API is a container.** It must reach Odoo by a hostname that resolves _from inside that container_ —
the public hostname, or a LAN IP. `localhost` points at the container itself and will always fail, even when
Odoo runs on the same machine.

**Installing this addon publishes `/api/v1/*` on your Odoo domain.** It is key-protected, but that key grants
read access to all HR data and can write attendance for any employee. Serve Odoo over HTTPS, and restrict those
paths to the Atlas server at your reverse proxy:

```nginx
location /api/v1/ {
    allow 172.16.10.54;   # the Atlas API host
    deny all;
    proxy_pass http://odoo;
}
```

## Authentication

One shared key, sent as a header on every request:

```
X-Atlas-Key: <key>
```

Only the Atlas backend holds it. It is never sent to a browser, and the endpoints set `Cache-Control: no-store`.
Because the key grants read access to all HR data and can write attendance for any employee, **serve Odoo over
HTTPS** and restrict the bridge to the backend's address at your reverse proxy where you can.

## Endpoints

All paths are prefixed `/api/v1`. Every response is JSON; errors are `{"error": {"message", "code"}}`.

| Method | Path                   | Purpose                                                                                                                               |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`              | Reachability and version check                                                                                                        |
| GET    | `/employees`           | Directory — `department_id`, `email`, `include_inactive`                                                                              |
| GET    | `/departments`         | Departments with manager and headcount                                                                                                |
| GET    | `/holidays`            | Company closures — `from`, `to` (defaults to the next year)                                                                           |
| GET    | `/attendance/me`       | Live status: checked in, today's hours, last session                                                                                  |
| POST   | `/attendance/checkin`  | Opens a session — 409 if one is already open. Optional `latitude`/`longitude`                                                         |
| POST   | `/attendance/checkout` | Closes the open session — 409 if there is none. Optional `latitude`/`longitude`                                                       |
| GET    | `/attendance/history`  | Per-day records and hours — `from`, `to`                                                                                              |
| GET    | `/leave/me`            | Current leave, upcoming, requests, per-type balances                                                                                  |
| GET    | `/leave/calendar`      | Approved leave across employees — `employee_ids`, `from`, `to`                                                                        |
| GET    | `/leave/types`         | Leave types a day can be booked against — hour-based types excluded                                                                   |
| POST   | `/leave/day`           | Books one approved day off — `leave_type_id`, optional `date` (defaults to today) and `reason`. 409 if Odoo refuses                   |
| POST   | `/leave/request`       | Files a request and leaves it pending — `leave_type_id`, `from`, optional `to` (defaults to `from`) and `reason`. 409 if Odoo refuses |
| GET    | `/leave/pending`       | Every request awaiting a decision — optional `employee_ids`. Not date-windowed                                                        |
| POST   | `/leave/approve`       | Approves one request — `leave_id`. Idempotent on an already-approved record                                                           |
| POST   | `/leave/refuse`        | Declines one request — `leave_id`, optional `reason`. Idempotent on an already-declined record                                        |

Every employee-scoped endpoint takes `employee_id` **or** `email`. Atlas authenticates its own users and passes
the mapping through; the bridge does not manage sessions.

```bash
curl -H "X-Atlas-Key: $ODOO_API_KEY" \
  "https://odoo.example.com/api/v1/attendance/me?email=dev@example.com"

curl -X POST -H "X-Atlas-Key: $ODOO_API_KEY" -H "Content-Type: application/json" \
  -d '{"employee_id": 42}' \
  "https://odoo.example.com/api/v1/attendance/checkin"
```

### Notes on the data

- **Times are UTC.** Odoo stores naive UTC datetimes; the bridge serialises them with an explicit `Z`. Day
  bucketing in `/attendance/history` uses the _employee's_ timezone, which is returned alongside the days.
- **`worked_hours_today` includes the open session.** Odoo's `worked_hours` is only computed when a record is
  closed, so a running total that ignored the open one would read `0` all morning.
- **Balances are computed from validated allocations minus validated leave**, not from `hr.leave.type`'s
  helper methods — those have changed signature between Odoo releases.
- **Location is optional and never blocks a punch.** `checkin` and `checkout` accept `latitude` and
  `longitude` in the JSON body and store them on Odoo's `in_latitude`/`in_longitude` and
  `out_latitude`/`out_longitude`. Both must be present and in range or the pair is ignored — a refused browser
  permission, a device with no fix, or an Odoo build without those fields all still check in, with the
  location simply left empty. Coordinates are recorded, never verified: the bridge does not check that
  somebody was near an office.
- **Ranges are capped at 400 days** so a mistyped window cannot read years of attendance in one call, and a
  single leave request at 60.
- **Leave decisions are made as a real Odoo user, and `sudo()` is not enough.** hr*holidays' approval checks
  are business rules written against `env.user`, not access rights, so superuser mode does not satisfy them:
  they ask whether the acting user is the employee's Time Off Manager or an HR officer. Under `auth="none"`
  the acting user is the public user, who is neither — and a leave type set to two-step validation refuses
  the \_first* approval with _"you are not his time off manager"_. So `/leave/approve`, `/leave/refuse` and
  `/leave/day` rebind the record with `with_user()` before acting. Set **Settings → Atlas Bridge → Approves
  leave as** to the user whose authority these decisions should carry; left empty, the first active Time Off
  Manager is used, and if there is none the attempt is logged and will fail.
- **Decisions are stamped with a note as well as an approver.** Odoo records the user above as the approver,
  which is real but is not the Atlas person who clicked. So `/leave/approve` also writes **"Approved by PM"**
  and `/leave/refuse` **"Declined by PM"** (plus the reason, when one is given) into `report_note` and the
  chatter. Atlas holds the individual identity — its API logs the acting user on its side.
- **`/leave/request` reports the state it actually reached.** A leave type configured for `no_validation` has
  no approval queue to wait in and Odoo validates it on confirm, so the response comes back `validate` rather
  than `confirm`. Atlas tells the employee their leave was approved automatically instead of leaving them
  waiting for a decision nobody will ever be asked to make.

## Development

```bash
odoo -d atlas --addons-path=addons,/path/to/atlas-odoo-bridge -u atlas_bridge --dev=all
```

The module is pure Python plus one settings view; there is no build step. After changing `main.py`, restart the
Odoo worker — `--dev=reload` picks controller changes up automatically.
