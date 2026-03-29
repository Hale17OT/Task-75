# Final Plan

This project will be built as a Docker-first, on-prem SentinelFit Operations platform using coherent vertical slices. Each module will be completed to a trustworthy state before the next begins, with real validations, real state changes, real permissions, failure-path coverage, and matching documentation. Since the workspace is currently empty, this plan is the implementation benchmark.

## 1. System Overview

SentinelFit is an offline-first gym/studio operations platform with three primary personas:

- Member
- Coach
- Administrator

It supports:

- secure sign-in with password and optional workstation PIN
- member enrollment and coach assignment
- face enrollment with client-side and server-side quality checks
- biometric liveness and deduplication
- coaching content publishing and analytics
- configurable admin dashboards and scheduled reports
- on-prem observability, auditability, backup, and dry-run recovery

The system is fully on-prem and must not depend on external APIs, hidden setup, interactive startup, or local-only assumptions outside Docker.

## 2. Architecture Choice And Reasoning

### Architecture

A modular monorepo with three main applications:

- `frontend/` Vue 3 + TypeScript + Pinia + Tailwind
- `backend/` Express + TypeScript + MySQL access + cron workers
- `infra/` Docker Compose, backup and restore scripts, and shared test utilities

### Why this architecture

- Keeps frontend and backend independently testable while sharing contracts.
- Fits the prompt's REST-style API requirement.
- Supports clear module boundaries and vertical slicing.
- Works cleanly with Docker Compose as the canonical runtime.
- Keeps all data, scheduling, and monitoring fully on-prem.

### Architectural principles

- Backend is authoritative for permissions, validation, session state, encryption, audit, and final biometric decisions.
- Frontend may assist with UX and early gating, but never becomes the source of truth.
- MySQL is the system of record.
- Dockerized behavior is authoritative over local behavior.
- Every module must include tests, failure behavior, documentation implications, and Docker verification expectations before implementation starts.

## 3. Runtime And Docker Baseline

### Canonical commands

- Startup: `docker compose up`
- Unified tests: `run_tests.sh`

### Docker-first assumptions

Docker Compose must bring up all required services without manual intervention:

- frontend container
- backend container
- mysql container
- optional test runner container
- optional standby recovery mysql container for dry-run restore verification

### Non-negotiable environment rules

- no hidden setup
- no private infrastructure
- no undeclared dependencies
- no interactive startup prompts
- no absolute local paths in code
- no local-only tooling shortcuts missing from Docker config

## 4. High-Level Module Delivery Sequence

1. Foundation and Docker Runtime
2. Identity, Session, and Request Integrity
3. Roles, Navigation, and Access Control
4. Member Enrollment and Contact Data
5. Face Enrollment and Biometric Governance
6. Coaching Content and Analytics
7. Administrative Dashboard Builder
8. Scheduled Reporting and Offline Delivery
9. Observability, Audit Integrity, Backup, and Recovery
10. Final hardening, E2E verification, documentation closure

Only after a module is complete by its benchmark will the next proceed.

## 5. Major Modules

### Module 1: Foundation And Runtime

- Responsibilities: monorepo structure, Docker Compose runtime, frontend/backend/mysql connectivity, env validation, base README, and `run_tests.sh`.
- Required flows: `docker compose up` boots services, backend reaches MySQL, frontend reaches backend health endpoint, tests run from one entrypoint.
- Failure behavior: invalid env fails fast, DB connection failures are visible, readiness is explicit.
- Tests required: config validation, backend readiness integration, Docker startup verification, unified test entrypoint.

### Module 2: Identity, Session, And Request Integrity

- Responsibilities: password login, optional PIN, warm lock, full session expiry, lockout, logout revocation, HMAC request signing, nonce and timestamp replay protection.
- Required flows: password login, optional PIN setup, PIN unlock after warm lock, full login after session expiry, lockout after repeated failures, signed authenticated requests.
- Key failure behavior: invalid password, locked account, expired session, invalid PIN, stale timestamp, replayed nonce, bad signature.

### Module 3: Roles, Navigation, And Access Control

- Responsibilities: inclusive role hierarchy, route gating, backend authorization, masked field access rules, station identity propagation.
- Required flows: role-aware navigation, server-side authorization, station token attribution.

### Module 4: Member Enrollment And Contact Data

- Responsibilities: member profile creation, coach assignment, consent capture, phone as contact attribute, masking by default.

### Module 5: Face Enrollment And Biometric Governance

- Responsibilities: camera/import enrollment, TensorFlow.js client gating, server validation, liveness, dedup across active and deactivated users, versioning, soft deactivation, immutable audit trail.

### Module 6: Coaching Content And Analytics

- Responsibilities: coach publishing, event capture, station attribution, analytics filters, drill-down charts, inactive member exclusion by default.

### Module 7: Administrative Dashboard Builder

- Responsibilities: drag-and-drop widgets, JSON layout persistence, reusable report templates, consistent fluent-inspired UI.

### Module 8: Scheduled Reporting And Offline Delivery

- Responsibilities: CSV/Excel/PDF generation, cron schedules, in-app inbox delivery, SMB/UNC shared-folder delivery, sync error reporting.

### Module 9: Observability, Audit Integrity, Backup, And Recovery

- Responsibilities: admin console for logs and alerts, access log retention, anomaly alerts, encrypted backups, 30-day retention, dry-run restore with checksum and key validation.

## 6. Domain Model

Core entities include:

- `User`
- `Role`
- `Session`
- `PinCredential`
- `MemberProfile`
- `CoachAssignment`
- `ConsentRecord`
- `FaceRecord`
- `FaceRecordVersion`
- `BiometricAuditEvent`
- `ContentPost`
- `ContentViewEvent`
- `SearchEvent`
- `DashboardLayout`
- `ReportTemplate`
- `ReportSchedule`
- `ReportExport`
- `ReportInboxItem`
- `AnomalyAlert`
- `AccessLog`
- `BackupRun`
- `RecoveryDryRun`
- `KeyMetadata`

## 7. Interface Contracts

Representative APIs:

- `POST /api/auth/login`
- `POST /api/auth/pin/setup`
- `POST /api/auth/pin/unlock`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `POST /api/members`
- `POST /api/faces/enroll`
- `GET /api/analytics/content`
- `PUT /api/dashboards/me`
- `POST /api/report-schedules`
- `POST /api/admin/recovery/dry-run`

Contract rules:

- DTOs validated server-side
- consistent error envelope
- request signing required on authenticated routes
- station token header normalized
- ISO dates in APIs, MM/DD/YYYY formatting in UI only

## 8. Failure Paths

Modules must explicitly plan and verify:

- invalid input
- missing required input
- malformed input
- unauthorized and forbidden actions
- missing resources
- duplicate submission
- stale state
- unavailable dependency
- timeouts
- partial success
- tamper or integrity violations
- startup and config failure

## 9. Logging Strategy

Log categories:

- authentication
- authorization failures
- biometric lifecycle
- content publishing
- analytics warnings
- reporting and cron
- backup and recovery
- startup and runtime health
- anomaly and integrity alerts

Never log passwords, PINs, session secrets, raw biometric payloads, or unnecessary PII.

## 10. Testing Strategy

- Unit tests for business rules and state transitions.
- Integration tests for API and persistence behavior.
- Playwright E2E tests for real UI-to-backend flows.
- Target at least 90 percent meaningful coverage of the relevant behavior surface.
- `run_tests.sh` is the canonical test entrypoint.

## 11. UI Standards

The UI must follow a Fluent-inspired design system implemented in Vue and Tailwind:

- clear visual hierarchy
- consistent 4px and 8px spacing scale
- tokenized colors and typography
- complete hover, active, focus, and disabled states
- loading skeletons or spinners for async transitions
- no layout clipping or unexpected shifts

## 12. Recommended First Slice

1. Foundation and Docker Runtime
2. Auth and session skeleton with DB-backed session state
3. Shared design tokens and app shell
4. Base README and `run_tests.sh`
5. Base logging, config validation, and error envelope

## 13. Execution Status (2026-03-29)

- Completed: workstation binding enforcement on all signed protected routes.
- Completed: server-authorized location scoping in content read/write analytics flows.
- Completed: dedup privacy hardening to redact unrelated member metadata in duplicate warnings/conflicts.
- Completed: scheduled report format persistence and execution for CSV/Excel/PDF.
- Completed: Docker shared-folder host bind-path configuration and documentation updates.
- Completed: targeted regression tests and full canonical verification.

Verification evidence:

- `backend npm run typecheck` passed
- `backend npm test` passed (`93` tests)
- `frontend npm run typecheck` passed
- `frontend npm test` passed (`36` tests)
- `./run_tests.sh` passed end-to-end (Docker runtime + Playwright + clean-install bootstrap)
