# SentinelFit Operations Platform

SentinelFit is a fully on-prem operations platform for gyms and training studios. This implementation delivers the planned vertical slices across authentication, member enrollment, biometric governance, coaching content, analytics, dashboarding, scheduled reporting, observability, and backup/recovery using a Docker-first runtime.

The implementation benchmark used for this repository is [temp/final_plan_of_action.md](/E:/Hale/Coding/Eaglepoint/Task-75/repo/temp/final_plan_of_action.md).

## Stack

- Frontend: Vue 3, TypeScript, Pinia, Tailwind CSS, TensorFlow.js, Chart.js
- Backend: Express, TypeScript, Node.js, node-cron
- Database: MySQL 8
- Runtime: Docker Compose, fully offline/on-prem, no external API dependencies

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

- [frontend](/E:/Hale/Coding/Eaglepoint/Task-75/repo/frontend): Vue application
- [backend](/E:/Hale/Coding/Eaglepoint/Task-75/repo/backend): Express API and background services
- [tests/e2e](/E:/Hale/Coding/Eaglepoint/Task-75/repo/tests/e2e): Playwright end-to-end tests
- [temp](/E:/Hale/Coding/Eaglepoint/Task-75/repo/temp): planning notes and implementation benchmark

## Prerequisites

- Docker Desktop with Compose
- Node.js 20+
- npm 10+
- Bash-compatible shell for `run_tests.sh`

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
- `BACKEND_DEMO_SEED_USERS`
- `BACKEND_KEY_VAULT_MASTER_KEY`
- `FRONTEND_PORT`
- `VITE_API_BASE_URL`

The default configuration allows both `localhost` and `127.0.0.1` frontend origins so browser verification remains stable in local and Docker-driven access paths.
The shipped allowlist defaults cover local and private-LAN ranges so the offline deployment path does not start in an allow-all state.
The Docker stack now binds report delivery to `REPORTS_SHARED_HOST_PATH` on the host so exported files are directly visible outside containers.

## Run with Docker

The canonical startup command is:

```bash
docker compose up --build
```

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
3. Run:

```bash
docker compose up --build
```

4. Wait until services are healthy, then open [http://localhost:5173](http://localhost:5173).
5. If `BACKEND_DEMO_SEED_USERS=false` (default), complete the one-time “First administrator setup”.
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

Demo users are only created when `BACKEND_DEMO_SEED_USERS=true`.

- `admin` / `Admin12345!X`
- `coach` / `Coach12345!X`
- `member` / `Member12345!X`

The default non-demo runtime leaves seed users disabled so a clean deployment does not start with publicly documented credentials.

## First-boot administrator setup

When `BACKEND_DEMO_SEED_USERS=false`, SentinelFit presents a one-time administrator bootstrap flow instead of relying on pre-seeded credentials.

1. Start the stack with `docker compose up --build`
2. Open [http://localhost:5173](http://localhost:5173)
3. Complete the "First administrator setup" form
4. The created administrator is signed in immediately and the bootstrap path is closed once an administrator exists

## Testing

The canonical unified test entrypoint is:

```bash
./run_tests.sh
```

`run_tests.sh` performs:

- root dependency install
- backend dependency install and coverage-checked tests
- frontend dependency install and coverage-checked tests
- Playwright browser install
- `docker compose up --build -d`
- readiness wait for frontend and backend
- Playwright end-to-end tests
- clean-install Docker restart with demo seeds disabled
- first-boot Playwright bootstrap verification

Local verification commands are still useful, but Dockerized behavior is authoritative:

```bash
cd backend && npm test
cd backend && npm run typecheck
cd frontend && npm test
cd frontend && npm run typecheck
npm run test:e2e
```

`npm run test:e2e` assumes frontend and backend services are already running and reachable on `127.0.0.1:5173` and `127.0.0.1:3000`. For a self-contained run, use `./run_tests.sh` (Docker canonical path).

## Operational notes

- Sensitive fields are encrypted with AES-256 via a local key vault whose key material is envelope-encrypted at rest with `BACKEND_KEY_VAULT_MASTER_KEY`.
- Key metadata is stored in MySQL and historical keys remain available for decrypt-on-read.
- `KEY_VAULT_MASTER_KEY`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_ROOT_PASSWORD` now have runnable local defaults so `docker compose up --build` works without pre-steps.
- For production or shared environments, override these defaults with environment-specific secrets before deployment.
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
- Session-state APIs remain HMAC-signed; the unsigned workstation restore endpoint is limited to warm-lock resume context and never returns session signing secrets.
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
