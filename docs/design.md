# SentinelFit Design

## Purpose
SentinelFit is an on-prem operations platform for gyms and studios. It combines role-based operations (Member, Coach, Administrator), biometric governance, reporting, and recovery workflows in a Docker-first deployment.

## Repository Layout
- `frontend/`: Vue 3 + TypeScript SPA
- `backend/`: Express + TypeScript API and background jobs
- `tests/e2e/`: Playwright end-to-end coverage
- `docker-compose.yml`: canonical runtime topology
- `run_tests.sh`: canonical end-to-end verification script

## Runtime Architecture
- Frontend container serves the UI on port `5173`.
- Backend container serves REST endpoints on port `3000`.
- MySQL primary stores operational data.
- MySQL standby is used for dry-run restore verification.
- Shared folder path is mounted for report export distribution.

### Startup sequence
1. Backend loads validated configuration.
2. Database initialization creates schema, applies compatibility column checks, and installs immutable audit triggers.
3. Key vault metadata is synchronized into `encryption_keys`.
4. Services are instantiated.
5. Session and artifact hardening migrations run.
6. Reporting schedules and ops background jobs are registered.

## Core Design Principles
- Backend is authoritative for access control, validation, and persistence.
- Signed requests protect authenticated API routes against tampering and replay.
- Workstation binding cookie is required for session continuity and PIN restore.
- Sensitive fields are encrypted at rest using key-version metadata.
- Audit integrity is enforced in MySQL with immutable triggers.
- Dockerized behavior is considered the source of truth.

## Security Model

### Authentication and session lifecycle
- Login is password-based with complexity requirements.
- Optional PIN re-entry supports warm-lock restore on the same workstation.
- Session timeout and account lockout policies are enforced server-side.
- Warm-lock stores state in session and requires PIN restore if configured.

### Request integrity
Authenticated routes require:
- `x-sf-timestamp`
- `x-sf-nonce`
- `x-sf-signature`
- `x-station-token`

Signature payload format:
`METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(JSON_BODY)`

Controls:
- timestamp freshness window
- nonce replay protection
- per-IP rate limits for sign-in and signed routes
- workstation binding cookie verification

### Network and access restrictions
- IP allowlist middleware blocks requests outside configured ranges.
- Role checks are enforced on route groups and domain operations.

## Roles and Authorization
- `Administrator`: full access, plus inherited `Coach` and `Member` capabilities.
- `Coach`: coaching operations and assigned-location member/content scope.
- `Member`: self profile, self consent, face workflow access to own records.

UI navigation is role-filtered and backend authorization is mandatory for data operations.

## Data Model Summary
Primary entities:
- Identity: `users`, `user_roles`, `sessions`, `pin_credentials`, `failed_login_attempts`, `bootstrap_guard`
- Security keys: `encryption_keys`
- Member ops: `member_profiles`, `coach_assignments`, `coach_location_assignments`, `consent_records`
- Biometrics: `face_records`, `face_record_versions`, `biometric_audit_log`
- Content analytics: `content_posts`, `content_view_events`, `search_events`
- Dashboards/reports: `dashboard_layouts`, `report_templates`, `report_schedules`, `report_subscriptions`, `report_exports`, `report_inbox_items`
- Observability/recovery: `application_logs`, `access_logs`, `anomaly_alerts`, `backup_runs`, `recovery_dry_runs`, `maintenance_mode`

### Integrity constraints
- Biometric audit immutability is enforced with DB triggers that reject updates/deletes.
- Face artifacts and session secrets are stored encrypted with key IDs.
- Report subscriptions are unique per schedule/user.

## Backend Module Responsibilities

### Auth service
- bootstrap-first-admin flow
- password login and lockout tracking
- session create/revoke/touch/warm-lock
- PIN setup and re-entry with workstation binding validation

### Member service
- member creation with encrypted phone storage
- coach assignment and coach-location management
- consent recording and recipient listing
- role-aware member visibility

### Face service
- timed liveness challenge issuance/consumption
- server-side trusted metadata extraction
- blur/liveness checks and dedup checks
- enrollment versioning, deactivation, history, and audit retrieval

### Content service
- post publishing by role/location
- view and search event capture with station attribution
- filtered analytics with location authorization and date validation

### Dashboard service
- per-admin layout persistence
- reusable template creation/listing

### Report service
- schedule creation and cron registration
- ad-hoc report generation (CSV/Excel/PDF)
- inbox delivery and download flow
- shared-folder write with partial-failure alerting

### Ops service
- backup generation and retention cleanup
- dry-run restore to standby MySQL with checksum validation
- runtime metrics aggregation for admin console
- retention and scheduled background maintenance jobs

## Frontend Design
- Single Vue SPA with module views for overview, members, faces, content, analytics, dashboards, reports, inbox, and admin console.
- Pinia auth store manages session state, warm-lock state, and active view authorization.
- API client signs authenticated requests and keeps unsigned auth bootstrap/login/restore routes separate.
- Feature composables isolate domain logic:
  - `useMembers`
  - `useFaceOps`
  - `useContentAnalytics`
  - `useDashboardsReports`
  - `useAdminConsole`

## API and Contract Conventions
- Success envelope:
  - `{ "ok": true, "data": ... }`
- Error envelope:
  - `{ "ok": false, "error": { "code": string, "message": string, "details": object|null } }`
- Validation is Zod-based per route.
- Cookies:
  - `sf_session` (httpOnly)
  - `sf_workstation` (httpOnly)

## Operational Workflows
- Bootstrap (clean install): first admin creation when no admin exists.
- Normal auth: login, signed session usage, optional warm-lock and PIN restore.
- Member lifecycle: enrollment, consent, coach assignment, scoped listing.
- Biometric lifecycle: challenge, dedup preview, enroll, history, deactivation, audit trail.
- Reporting lifecycle: template, schedule/subscribers, export, inbox download.
- Recovery lifecycle: backup creation and dry-run restore pass/fail verification.

## Testing Strategy Implemented
- Backend unit/integration-style tests for services, routes, config, crypto, DB, and security.
- Frontend tests for UI logic/composables.
- Playwright E2E for admin, coach, member, inbox, and bootstrap paths.
- Unified script executes install, typecheck, tests, Docker startup, e2e, and clean-install bootstrap verification.

## Non-Functional Characteristics
- Offline/on-prem by design (no external API dependency).
- Defensive defaults for local deployment with explicit environment overrides.
- Structured logging with sensitive key redaction.
- Explicit error codes/messages for operator-facing troubleshooting.
