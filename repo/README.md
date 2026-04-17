# SentinelFit Operations Platform

**Project type: fullstack** (Vue 3 frontend + Express/TypeScript backend + MySQL, orchestrated by Docker Compose).

SentinelFit is a fully on-prem operations platform for gyms and training studios. This implementation delivers the planned vertical slices across authentication, member enrollment, biometric governance, coaching content, analytics, dashboarding, scheduled reporting, observability, and backup/recovery using a Docker-first runtime.

The implementation benchmark used for this repository is captured by the in-repo source, tests, and reviewer notes under [`backend`](./backend), [`frontend`](./frontend), and [`tests`](./tests).

## Stack

- Frontend: Vue 3, TypeScript, Pinia, Tailwind CSS, TensorFlow.js, Chart.js
- Backend: Express, TypeScript, Node.js, node-cron
- Database: MySQL 8
- Runtime: Docker Compose, fully offline/on-prem, no external API dependencies

## Architecture

```
+-----------------+        +----------------------+        +--------------------+
|  Vue 3 frontend | <----> |  Express backend     | <----> |  MySQL 8 (primary) |
|  (port 5173)    |   CORS |  (port 3000)         |  mysql |  (port 3306)       |
+-----------------+        |  - Signed requests   |        +--------------------+
                           |  - RBAC middleware   |
                           |  - Face pipeline     |        +--------------------+
                           |  - Scheduler         | -----> |  MySQL 8 (standby) |
                           |  - Backup / restore  |        |  (port 3307)       |
                           +----------+-----------+        +--------------------+
                                      |
                                      v
                           +----------------------+
                           |  Shared reports dir  |
                           |  (host-mounted)      |
                           +----------------------+
```

- **Frontend (Vue 3 + Pinia + Tailwind + Chart.js + TensorFlow.js)** renders operator workstations, handles camera capture and client-side quality guidance, and signs every request against an in-memory session secret issued by the backend.
- **Backend (Express + TypeScript)** terminates HTTP, enforces per-IP rate limits, IP allowlisting, HMAC request signing with durable nonce replay protection, session/warm-lock handling, RBAC, and all business logic. All cryptographic primitives resolve through a local envelope-encrypted key vault.
- **MySQL primary** stores users, sessions, members, face artifacts metadata, biometric audit logs (immutable via triggers), content posts, dashboards, report schedules, reports, keys, and logs.
- **MySQL standby** is the target for nightly encrypted backups and dry-run restore verification.
- **Shared reports directory** is bind-mounted from the host so CSV/Excel/PDF report exports are directly accessible outside the containers.

## Implemented modules

- Docker-first runtime with frontend, backend, primary MySQL, and standby MySQL
- Password login, server-bound same-workstation PIN re-entry, warm-lock after inactivity, session expiry, and account-wide lockout handling
- Signed request integrity with HMAC, nonce, and timestamp validation
- Inclusive RBAC for Member, Coach, and Administrator
- Member enrollment, coach assignment, masked phone handling, administrator/coach consent updates, member self-service face consent, and operator-entered member passwords with no shared UI default
- Face enrollment with camera capture or image import, encrypted biometric artifacts, client-side quality guidance, pre-submit duplicate warnings, server-issued timed liveness challenges, server-derived face/liveness validation, dedup, versioning, deactivation, and immutable biometric audit records
- Coach content publishing and analytics by station/location/date with MM/DD/YYYY filters, inline chart drill-down, and real view/search event capture
- Admin dashboard layout persistence, configurable widget palette, and reusable report templates
- Scheduled/offline reporting with subscriptions, inbox delivery, actionable downloads, and shared-folder output
- Admin console for logs, alerts, latency/error metrics, backup, and dry-run restore
- Encrypted local key vault with key version metadata and rotation support
- Unit, integration-style, and Playwright end-to-end verification

## Repository layout

- [frontend](./frontend): Vue application
- [backend](./backend): Express API and background services
- [tests/e2e](./tests/e2e): Playwright end-to-end tests

## Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)
- Bash-compatible shell to invoke `./run_tests.sh`

No host-level Node.js, npm, database server, or manual package installation is required. All runtime dependencies, tests, and typechecks execute inside Docker containers.

## Configuration

1. Run with defaults directly via `docker compose up --build` for local/offline bootstrap on a fresh machine.
2. Optionally provide a `.env` file to override defaults for ports, credentials, shared-folder paths, or data directories.

Important environment variables:

- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_ROOT_PASSWORD`
- `MYSQL_PORT`
- `MYSQL_PORT_BIND`
- `MYSQL_HOST`
- `MYSQL_STANDBY_HOST`
- `MYSQL_STANDBY_PORT`
- `MYSQL_STANDBY_PORT_BIND`
- `BACKEND_PORT`
- `BACKEND_NODE_ENV`
- `BACKEND_ALLOWED_ORIGINS`
- `BACKEND_DATA_DIR`
- `BACKEND_REPORTS_SHARED_PATH`
- `REPORTS_SHARED_HOST_PATH`
- `BACKEND_IP_ALLOWLIST`
- `BACKEND_API_RATE_LIMIT_PER_MINUTE`
- `BACKEND_DEMO_SEED_USERS`
- `BACKEND_KEY_VAULT_MASTER_KEY`
- `FRONTEND_PORT`
- `VITE_API_BASE_URL`

The default configuration allows both `localhost` and `127.0.0.1` frontend origins so browser verification remains stable in local and Docker-driven access paths.
The shipped allowlist defaults cover local and private-LAN ranges so the offline deployment path does not start in an allow-all state.
The Docker stack now binds report delivery to `REPORTS_SHARED_HOST_PATH` on the host so exported files are directly visible outside containers.

### Compose-facing → backend-runtime variable mapping

The compose stack uses `BACKEND_*` prefixes on the host so that operators can override every backend setting from `.env` without colliding with frontend or MySQL variables. Inside the backend container those same values are exposed under the shorter names that `backend/src/config.ts` reads. The mapping is fixed in `docker-compose.yml`:

| Compose / `.env` key (host)      | Backend container env (runtime, used by `backend/src/config.ts`) |
| ---                              | ---                                                              |
| `BACKEND_PORT`                   | `PORT`                                                           |
| `BACKEND_NODE_ENV`               | `NODE_ENV`                                                       |
| `BACKEND_ALLOWED_ORIGINS`        | `ALLOWED_ORIGINS`                                                |
| `BACKEND_DATA_DIR`               | `DATA_DIR`                                                       |
| `BACKEND_REPORTS_SHARED_PATH`    | `REPORTS_SHARED_PATH`                                            |
| `BACKEND_IP_ALLOWLIST`           | `IP_ALLOWLIST`                                                   |
| `BACKEND_API_RATE_LIMIT_PER_MINUTE` | `API_RATE_LIMIT_PER_MINUTE`                                  |
| `BACKEND_DEMO_SEED_USERS`        | `DEMO_SEED_USERS`                                                |
| `BACKEND_KEY_VAULT_MASTER_KEY`   | `KEY_VAULT_MASTER_KEY`                                           |
| `MYSQL_HOST`                     | `MYSQL_HOST` (no rename)                                         |
| `MYSQL_PORT`                     | `MYSQL_PORT`                                                     |
| `MYSQL_DATABASE`                 | `MYSQL_DATABASE`                                                 |
| `MYSQL_USER`                     | `MYSQL_USER`                                                     |
| `MYSQL_PASSWORD`                 | `MYSQL_PASSWORD`                                                 |
| `MYSQL_STANDBY_HOST`             | `MYSQL_STANDBY_HOST`                                             |
| `MYSQL_STANDBY_PORT`             | `MYSQL_STANDBY_PORT`                                             |
| `REPORTS_SHARED_HOST_PATH`       | (host bind-mount source for `BACKEND_REPORTS_SHARED_PATH`; not seen inside the container) |
| `MYSQL_PORT_BIND`                | (host port bind for primary MySQL; not seen inside the container) |
| `MYSQL_STANDBY_PORT_BIND`        | (host port bind for standby MySQL; not seen inside the container) |
| `MYSQL_ROOT_PASSWORD`            | consumed by the `mysql` and `mysql-standby` containers, not the backend |
| `FRONTEND_PORT`                  | consumed by the `frontend` container, not the backend            |
| `VITE_API_BASE_URL`              | consumed by the `frontend` container at build time, not the backend |

So when the operational notes (or `backend/src/config.ts`) refer to `KEY_VAULT_MASTER_KEY`, that is the **same value** you set as `BACKEND_KEY_VAULT_MASTER_KEY` in `.env` or `docker-compose.yml`; the backend service block in `docker-compose.yml` rewrites the name on the way into the container. The same rule applies to every `BACKEND_*` row above.

## Run with Docker

The canonical startup command is:

```bash
docker-compose up
```

Equivalent invocations supported by modern Docker Desktop (Compose plugin):

```bash
docker-compose up --build
docker compose up --build
```

The `docker-compose up` form (with a hyphen) and the newer `docker compose up` form are both supported. Use whichever your Docker Desktop / Docker Engine + Compose plugin recognizes; on a fresh install of Docker Desktop the hyphenated `docker-compose up` is shimmed to the same Compose runtime as `docker compose up`.

Services:

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend live health: [http://localhost:3000/health/live](http://localhost:3000/health/live)
- Backend readiness: [http://localhost:3000/health/ready](http://localhost:3000/health/ready)
- Primary MySQL: `localhost:3306`
- Standby MySQL: `localhost:3307`

Shared report delivery:

- Host path: `${REPORTS_SHARED_HOST_PATH}` (default `./shared-reports`)
- Container path: `${BACKEND_REPORTS_SHARED_PATH}` (default `/shared/reports`)
- For Windows UNC/SMB shares, set `REPORTS_SHARED_HOST_PATH` to an absolute host-mounted path available to Docker Desktop.

## Quick start (new machine)

1. Install Docker Desktop (or Docker Engine + Compose plugin) and start Docker.
2. Open this repository directory.
3. Run either of the supported forms:

```bash
docker-compose up
```

or, equivalently:

```bash
docker compose up --build
```

4. Wait until services are healthy, then open [http://localhost:5173](http://localhost:5173).
5. If `BACKEND_DEMO_SEED_USERS=false` (default), complete the one-time "First administrator setup".
6. To stop:

```bash
docker compose down
```

Notes:
- No `.env` file is required for local startup; Compose defaults are provided.
- Ensure ports `5173`, `3000`, `3306`, and `3307` are free on the host.

## Troubleshooting

- Docker daemon not running:
  Start Docker Desktop and retry `docker compose up --build`.

- Port already in use:
  Find and stop conflicting processes, or override bind ports in `.env` (for example `FRONTEND_PORT`, `BACKEND_PORT`, `MYSQL_PORT_BIND`, `MYSQL_STANDBY_PORT_BIND`).

- Backend cannot connect to MySQL after config changes:
  Recreate clean volumes:
  ```bash
  docker compose down --volumes --remove-orphans
  docker compose up --build
  ```

- Health endpoint not ready:
  Check logs:
  ```bash
  docker compose logs backend
  docker compose logs mysql
  ```
  Backend readiness endpoint: [http://localhost:3000/health/ready](http://localhost:3000/health/ready)

- UI loads but login/bootstrap fails:
  Confirm backend is reachable at [http://localhost:3000/health/live](http://localhost:3000/health/live) and that station token input is set in the UI.

## Demo seed accounts

SentinelFit ships with the following demo accounts so verifiers can sign in immediately after `docker compose up --build`:

| Role | Username | Password |
| --- | --- | --- |
| Administrator | `admin` | `Admin12345!X` |
| Coach | `coach` | `Coach12345!X` |
| Member | `member` | `Member12345!X` |

These accounts cover all three roles (Administrator, Coach, Member) and are seeded whenever `BACKEND_DEMO_SEED_USERS=true`. `./run_tests.sh` exports this value automatically. To use the same credentials against a plain `docker compose up --build`, start the stack with:

```bash
BACKEND_DEMO_SEED_USERS=true docker compose up --build
```

If `BACKEND_DEMO_SEED_USERS=false`, no demo credentials are created — the UI instead presents the one-time **First administrator setup** flow documented below. This is a security hardening option for production deployments; reviewers should leave `BACKEND_DEMO_SEED_USERS=true` to exercise the credentials above.

## First-boot administrator setup

When `BACKEND_DEMO_SEED_USERS=false`, SentinelFit presents a one-time administrator bootstrap flow instead of relying on pre-seeded credentials.

1. Start the stack with `docker compose up --build`
2. Open [http://localhost:5173](http://localhost:5173)
3. Complete the "First administrator setup" form
4. The created administrator is signed in immediately and the bootstrap path is closed once an administrator exists

## Testing

The canonical and only supported test entrypoint is:

```bash
./run_tests.sh
```

`run_tests.sh` performs every step inside Docker containers:

- builds `backend` and `frontend` images
- runs backend unit/integration tests: `docker compose run --rm --no-deps backend npm test`
- runs frontend unit tests: `docker compose run --rm --no-deps frontend npm test`
- runs backend and frontend typechecks in the same container pattern
- starts the full stack with `docker compose up --build -d`
- waits for `/health/ready` and the frontend to become available
- runs Playwright end-to-end tests inside a `node:20-bookworm` container against the live Docker stack
- runs signed HMAC regression checks against the live backend (coach-to-admin boundary and biometric audit immutability)
- restarts the stack with `BACKEND_DEMO_SEED_USERS=false` and runs the first-boot bootstrap Playwright scenario

### Verifying the API manually

Once the stack is up, probe the unsigned health endpoints with `curl` against the Docker backend:

```bash
curl -s http://localhost:3000/health/live
curl -s http://localhost:3000/health/ready
```

Bootstrap status and password login are also unsigned:

```bash
curl -s http://localhost:3000/api/auth/bootstrap/status

curl -s -c cookies.txt -X POST \
  -H 'content-type: application/json' \
  -H 'x-station-token: Front-Desk-01' \
  -d '{"username":"admin","password":"Admin12345!X"}' \
  http://localhost:3000/api/auth/login | tee /tmp/login.json
```

Everything under `/api/self`, `/api/members`, `/api/faces`, `/api/content`, `/api/dashboards`, `/api/reports`, and `/api/admin` requires a signed HMAC request. Use the script below (inside the backend container, where `node` is available) to call a signed endpoint from the command line:

```bash
docker compose exec backend node <<'NODE'
const crypto = require('node:crypto');

const sessionSecret = '<<paste-data.sessionSecret-from-login-response>>';
const sessionCookie = '<<paste-sf_session-cookie>>';
const workstationCookie = '<<paste-sf_workstation-cookie>>';
const path = '/api/admin/console';

const timestamp = new Date().toISOString();
const nonce = crypto.randomUUID();
const bodyHash = crypto.createHash('sha256').update('').digest('hex');
const payload = ['GET', path, timestamp, nonce, bodyHash].join('\n');
const signature = crypto
  .createHmac('sha256', Buffer.from(sessionSecret, 'base64'))
  .update(payload)
  .digest('hex');

const response = await fetch(`http://127.0.0.1:3000${path}`, {
  method: 'GET',
  headers: {
    cookie: `sf_session=${sessionCookie}; sf_workstation=${workstationCookie}`,
    'x-station-token': 'Front-Desk-01',
    'x-sf-timestamp': timestamp,
    'x-sf-nonce': nonce,
    'x-sf-signature': signature
  }
});

console.log(response.status, await response.text());
NODE
```

The UI at http://localhost:5173 performs this signing automatically, so browser verification remains the fastest happy-path check.

## Operational notes

- Sensitive fields are encrypted with AES-256 via a local key vault whose key material is envelope-encrypted at rest with `BACKEND_KEY_VAULT_MASTER_KEY`.
- Key metadata is stored in MySQL and historical keys remain available for decrypt-on-read.
- `KEY_VAULT_MASTER_KEY` defaults to `AUTO_GENERATE`, which creates a per-environment master key on first boot and stores it under the backend data directory.
- `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_ROOT_PASSWORD` have local bootstrap defaults for one-command startup; override them for production/shared deployments.
- Persisted session secrets are encrypted and persisted session identifiers are stored as non-reusable hashes.
- Biometric audit records are append-only and protected by MySQL triggers.
- Stored biometric artifacts are encrypted before being written to disk.
- Timed liveness challenges require the prompted head-turn capture to occur within the enforced server-side window.
- Final face-in-frame and liveness acceptance are derived from image content on the server; client landmark clicks are guidance-only and never the source of truth.
- The current biometric dedup/liveness layer uses lightweight local image heuristics suitable for offline baseline validation; high-assurance deployments should replace this with a stronger local face pipeline.
- Face duplicate checks can be previewed before final enrollment submission so operators see warnings during capture review, not only after commit.
- Preview-only dedup checks do not persist orphaned biometric artifacts to disk.
- PIN re-entry is only valid when an active warm session already exists and the browser presents the server-issued workstation binding cookie; the station token remains attribution metadata, not the security proof.
- PIN re-entry shares the sign-in rate limit path and lockout policy to reduce brute-force exposure.
- Auth throttling keeps an IP-level abuse cap, but also keys per-station traffic so independent kiosks on the same LAN do not rate-limit each other by default.
- Request-signing policy:
  - Signed (`x-sf-timestamp` + `x-sf-nonce` + `x-sf-signature`) is required for all authenticated business routes under `/api/self`, `/api/members`, `/api/faces`, `/api/content`, `/api/dashboards`, `/api/reports`, and `/api/admin`.
  - Unsigned exceptions are limited to pre-auth/session-establishment flows: `/api/auth/bootstrap/status`, `/api/auth/bootstrap/admin`, `/api/auth/login`, `/api/auth/pin/reenter`, and `/api/auth/session`.
  - Compensating controls for unsigned exceptions include IP allowlist enforcement, station-aware auth throttling with an IP abuse cap, credential lockout policy, and workstation-binding cookie validation on `/api/auth/session`.
  - Replay protection for signed routes uses nonce single-use records stored in MySQL with TTL, so replay history survives process restarts and multi-instance routing.
- Session-state restoration uses the server session endpoint and keeps the signing secret in memory only, while warm-lock resumes require PIN re-entry.
- Coach access scope is driven by explicit `coach_location_assignments` records rather than inferred from historical member/content data.
- Analytics filters are validated server-side before query execution, including malformed date-range rejection.
- Report exports are written to both a local backend reports directory and the configured shared-folder path.
- Scheduled reports persist their configured export format (`CSV`/`Excel`/`PDF`) and cron runs execute with that same format.
- Scheduled reports can target multiple subscribers, and inbox items expose direct download actions.
- Subscriber inbox access is available to authenticated recipients while schedule/template authoring remains administrator-only.
- Generated reports use the requesting administrator or schedule owner dashboard layout rather than a fixed administrator snapshot.
- The Reports surface loads template state directly, so generation and scheduling do not depend on visiting Dashboards first.
- Shared-folder delivery failures raise `storage_sync_error` alerts in the admin console.
- Admin metrics surface uptime, request latency, server error rate, and recent backup/report timings.
- Startup retries database initialization so `docker compose up` is resilient to MySQL readiness races.
- Nightly encrypted backups and dry-run restore workflows target the standby MySQL instance.
- The local key vault attempts to harden its file permissions on write; operators should still apply OS-level restrictions to the backend data directory.

## Verification checklist

- `docker compose up --build` starts all services without manual intervention.
- Backend readiness reports both API and database health.
- Admin, coach, and member sign-in flows work with role-appropriate navigation.
- `./run_tests.sh` passes end to end.
- Playwright verifies core admin workflow plus coach/member access boundaries.
