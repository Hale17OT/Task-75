# Test Coverage Audit

## Backend Endpoint Inventory

Resolved from router mounts in `backend/src/app.ts:52`, `backend/src/app.ts:62`, `backend/src/app.ts:64`, `backend/src/app.ts:76`, `backend/src/app.ts:81`, `backend/src/app.ts:87`, `backend/src/app.ts:93`, `backend/src/app.ts:94`, `backend/src/app.ts:100`, `backend/src/app.ts:105` and route declarations in `backend/src/routes/*.ts`.

1. `GET /`
2. `GET /health/live`
3. `GET /health/ready`
4. `GET /api/auth/bootstrap/status`
5. `POST /api/auth/bootstrap/admin`
6. `POST /api/auth/login`
7. `POST /api/auth/pin/setup`
8. `POST /api/auth/pin/reenter`
9. `POST /api/auth/warm-lock`
10. `POST /api/auth/logout`
11. `GET /api/auth/session`
12. `GET /api/self/profile`
13. `POST /api/self/consent/face`
14. `GET /api/members`
15. `POST /api/members`
16. `POST /api/members/:id/coach-assignment`
17. `POST /api/members/:id/consent/face`
18. `GET /api/members/coaches/:coachUserId/locations`
19. `POST /api/members/coaches/:coachUserId/locations`
20. `POST /api/faces/challenge`
21. `POST /api/faces/dedup-check`
22. `POST /api/faces/enroll`
23. `PATCH /api/faces/:faceRecordId/deactivate`
24. `GET /api/faces/history/:memberUserId`
25. `GET /api/faces/audit/:memberUserId`
26. `GET /api/content/posts`
27. `POST /api/content/posts`
28. `POST /api/content/views`
29. `POST /api/content/search-events`
30. `GET /api/content/analytics`
31. `GET /api/dashboards/me`
32. `PUT /api/dashboards/me`
33. `POST /api/dashboards/templates`
34. `GET /api/reports/schedules`
35. `GET /api/reports/recipients`
36. `POST /api/reports/schedules`
37. `POST /api/reports/generate`
38. `GET /api/reports/inbox`
39. `GET /api/reports/inbox/:id/download`
40. `GET /api/admin/console`
41. `POST /api/admin/backups`
42. `POST /api/admin/recovery/dry-run`

## API Test Mapping Table

| Endpoint | Covered | Test type | Test files | Evidence |
|---|---|---|---|---|
| `GET /` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/health.test.ts` | `tests/e2e/api.spec.ts:180` (`GET / returns the backend identity envelope`) |
| `GET /health/live` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/health.test.ts` | `tests/e2e/api.spec.ts:163` |
| `GET /health/ready` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/health.test.ts` | `tests/e2e/api.spec.ts:172` |
| `GET /api/auth/bootstrap/status` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts`, `backend/tests/integration.test.ts` | `tests/e2e/api.spec.ts:188` |
| `POST /api/auth/bootstrap/admin` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:198` |
| `POST /api/auth/login` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts`, `backend/tests/integration.test.ts` | request helper call in `tests/e2e/api.spec.ts:54` used by suites (`:242`, `:631`) |
| `POST /api/auth/pin/setup` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:629` |
| `POST /api/auth/pin/reenter` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:221` |
| `POST /api/auth/warm-lock` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:647` |
| `POST /api/auth/logout` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:637` |
| `GET /api/auth/session` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:213` |
| `GET /api/self/profile` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:246` |
| `POST /api/self/consent/face` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:246` |
| `GET /api/members` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:262` |
| `POST /api/members` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:277` |
| `POST /api/members/:id/coach-assignment` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:314` |
| `POST /api/members/:id/consent/face` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:277` |
| `GET /api/members/coaches/:coachUserId/locations` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:328` |
| `POST /api/members/coaches/:coachUserId/locations` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:328` |
| `POST /api/faces/challenge` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:356` |
| `POST /api/faces/dedup-check` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:373` |
| `POST /api/faces/enroll` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:386` |
| `PATCH /api/faces/:faceRecordId/deactivate` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:426` |
| `GET /api/faces/history/:memberUserId` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:400` |
| `GET /api/faces/audit/:memberUserId` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:413` |
| `GET /api/content/posts` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:439` |
| `POST /api/content/posts` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:439` |
| `POST /api/content/views` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:461` |
| `POST /api/content/search-events` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:469` |
| `GET /api/content/analytics` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:478` |
| `GET /api/dashboards/me` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:493` |
| `PUT /api/dashboards/me` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:493` |
| `POST /api/dashboards/templates` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:514` |
| `GET /api/reports/schedules` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:528` |
| `GET /api/reports/recipients` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:528` |
| `POST /api/reports/schedules` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:538` |
| `POST /api/reports/generate` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:552` |
| `GET /api/reports/inbox` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:565` |
| `GET /api/reports/inbox/:id/download` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:578` |
| `GET /api/admin/console` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:590` |
| `POST /api/admin/backups` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:603` |
| `POST /api/admin/recovery/dry-run` | yes | true no-mock HTTP | `tests/e2e/api.spec.ts`, `tests/e2e/app.spec.ts`, `backend/tests/routes.test.ts` | `tests/e2e/api.spec.ts:611` |

## API Test Classification

1. **True No-Mock HTTP**
   - `tests/e2e/api.spec.ts` (direct real HTTP against running backend; no route/service mocking statements found).
   - `tests/e2e/app.spec.ts` (real browser FE↔BE flow; no `page.route`/mock interception statements found).
   - `tests/e2e/bootstrap.spec.ts` (real first-boot flow through running stack).

2. **HTTP with Mocking**
   - `backend/tests/health.test.ts` via `createStubApp`/`createStubDatabase` (`backend/tests/test-helpers.ts:35`, `backend/tests/test-helpers.ts:18`).
   - `backend/tests/routes.test.ts` via `vi.fn` service doubles injected into `createApp` (`backend/tests/routes.test.ts:53`, `backend/tests/routes.test.ts:209`).
   - `backend/tests/integration.test.ts` mixes real `auth/content/dashboard/logging` services but uses stub DB and multiple stub services (`backend/tests/integration.test.ts:43`, `backend/tests/integration.test.ts:103`).

3. **Non-HTTP (unit/integration without HTTP as API coverage source)**
   - `backend/tests/server.test.ts`, `backend/tests/middleware.test.ts`, `backend/tests/auth-service.test.ts`, `backend/tests/member-service.test.ts`, `backend/tests/content-service.test.ts`, `backend/tests/face-service.test.ts`, `backend/tests/report-service.test.ts`, `backend/tests/ops-service.test.ts`, `backend/tests/dashboard-service.test.ts`, `backend/tests/database.test.ts`, `backend/tests/security.test.ts`, `backend/tests/config.test.ts`, `backend/tests/schema.test.ts`, `backend/tests/key-vault.test.ts`, `backend/tests/crypto.test.ts`, `backend/tests/http.test.ts`, `backend/tests/logger.test.ts`, `backend/tests/request-context.test.ts`, `backend/tests/types.test.ts`, `backend/tests/face-analysis.test.ts`, `backend/tests/face-liveness.test.ts`, `backend/tests/face-dedup.test.ts`.

## Mock Detection

- `vi.mock(...)` module mocks in `backend/tests/server.test.ts:49`, `backend/tests/server.test.ts:53`, `backend/tests/server.test.ts:79`, `backend/tests/server.test.ts:90`, `backend/tests/server.test.ts:94`, `backend/tests/server.test.ts:102`, `backend/tests/server.test.ts:110`, `backend/tests/server.test.ts:114`, `backend/tests/server.test.ts:122`, `backend/tests/server.test.ts:126`, `backend/tests/server.test.ts:130`, `backend/tests/server.test.ts:138`, `backend/tests/server.test.ts:146`, `backend/tests/server.test.ts:161`.
- Service/provider doubles (`vi.fn`) across API path tests in `backend/tests/routes.test.ts:54` through `backend/tests/routes.test.ts:269`.
- Stub DB/provider harness in `backend/tests/integration.test.ts:43` through `backend/tests/integration.test.ts:101`.
- Additional module mocks in service tests: `backend/tests/ops-service.test.ts:18`, `backend/tests/ops-service.test.ts:25`, `backend/tests/ops-service.test.ts:30`, `backend/tests/report-service.test.ts:12`, `backend/tests/report-service.test.ts:16`, `backend/tests/database.test.ts:23`.

## Coverage Summary

- Total endpoints: **42**
- Endpoints with any HTTP tests: **42**
- Endpoints with true no-mock HTTP tests: **42**
- HTTP coverage: **100.0%**
- True API coverage: **100.0%**

## Unit Test Summary

- Test files (backend + frontend unit/spec):
  - Backend: `backend/tests/*.test.ts` (27 files).
  - Frontend: `frontend/tests/*.spec.ts` (7 files).
- Modules covered (evidence via imports in backend tests):
  - **Controllers/routes via HTTP path tests**: `backend/tests/routes.test.ts`, `backend/tests/integration.test.ts`, `backend/tests/health.test.ts`.
  - **Services**: `backend/tests/auth-service.test.ts`, `backend/tests/member-service.test.ts`, `backend/tests/content-service.test.ts`, `backend/tests/face-service.test.ts`, `backend/tests/dashboard-service.test.ts`, `backend/tests/report-service.test.ts`, `backend/tests/ops-service.test.ts`, plus face submodules `backend/tests/face-analysis.test.ts`, `backend/tests/face-liveness.test.ts`, `backend/tests/face-dedup.test.ts`.
  - **Repositories/DB access layer**: `backend/tests/database.test.ts`, plus SQL-path assertions in `backend/tests/integration.test.ts`.
  - **Auth/guards/middleware/security**: `backend/tests/middleware.test.ts`, `backend/tests/security.test.ts`, `backend/tests/request-context.test.ts`, plus auth service tests.
- Important modules not directly unit-tested as standalone modules:
  - Route module files are not imported directly as units (`backend/src/routes/*.ts`), but are covered through HTTP tests.
  - Type-only helper modules (`backend/src/services/face/types.ts`) have no direct behavioral tests (low risk; mostly typing contracts).

## API Observability Check

- **Strong observability** in `tests/e2e/api.spec.ts`: explicit method/path, explicit request body/query, explicit response assertions for status and payload (`tests/e2e/api.spec.ts:163` onward).
- **Moderate/weak API observability** in UI E2E (`tests/e2e/app.spec.ts`, `tests/e2e/bootstrap.spec.ts`): flows validate user-visible outcomes but do not expose explicit HTTP request/response payloads per endpoint.
- **Strong for mocked HTTP tests** in `backend/tests/routes.test.ts`: explicit endpoint calls and response assertions, but business path is heavily mocked.

## Test Quality & Sufficiency

- Success-path coverage: strong across all route families in true no-mock API sweep (`tests/e2e/api.spec.ts:233` onward).
- Failure-path coverage: present for bootstrap conflict, missing session, invalid image/challenge, forbidden access, and multiple signature/auth failures (`tests/e2e/api.spec.ts:198`, `tests/e2e/api.spec.ts:221`, `tests/e2e/api.spec.ts:373`, `tests/e2e/api.spec.ts:386`; `backend/tests/routes.test.ts:416`, `backend/tests/routes.test.ts:895`).
- Validation and edge cases: date validation and tampered signed query checks covered (`backend/tests/routes.test.ts:832`, `backend/tests/routes.test.ts:848`, `backend/tests/routes.test.ts:895`).
- Auth/permission boundaries: strong evidence in both real HTTP and mocked HTTP suites (`tests/e2e/app.spec.ts:121`, `tests/e2e/api.spec.ts:590`, `backend/tests/routes.test.ts:738`, `backend/tests/routes.test.ts:753`).
- Over-mocking risk: significant in backend HTTP tests (`backend/tests/routes.test.ts`, `backend/tests/integration.test.ts`), but mitigated by separate no-mock API suite.

## Tests Check

- `run_tests.sh` is Docker-centered and executes backend/frontend tests, typechecks, and Playwright inside containers (`run_tests.sh:93` through `run_tests.sh:131`, `run_tests.sh:416` through `run_tests.sh:417`).
- No local package-manager dependency for app runtime/tests beyond Docker CLI + shell; this satisfies the Docker-based requirement (`run_tests.sh:10` through `run_tests.sh:13`, `README.md:69`).

## End-to-End Expectations (Fullstack)

- Fullstack expectation is met: real FE↔BE E2E exists in `tests/e2e/app.spec.ts` and clean-install flow in `tests/e2e/bootstrap.spec.ts`.
- Real API no-mock sweep exists independently in `tests/e2e/api.spec.ts`.

## Test Coverage Score (0-100)

**91 / 100**

## Score Rationale

- + High score for complete endpoint inventory coverage with true no-mock HTTP evidence for every backend endpoint.
- + Strong negative-path and security-path checks, including signed-request integrity and role boundaries.
- - Deduction for heavy reliance on mocked provider wiring in backend HTTP test suites (`routes.test.ts`, `integration.test.ts`), which are useful but not sufficient alone.
- - Deduction for weaker API-level observability in browser E2E (asserts UX outcomes rather than explicit API payload contracts).

## Key Gaps

- API payload-contract assertions are strongest in `tests/e2e/api.spec.ts`; browser E2E does not provide granular request/response evidence per endpoint.
- Backend route tests are comprehensive but mostly mock-backed, so they should not be treated as no-mock evidence.
- No direct standalone behavioral tests for some type/helper-only modules (low impact).

## Confidence & Assumptions

- Confidence: **high** for endpoint inventory and static test classification.
- Assumptions (explicit):
  - Classification is static-only; no test execution was performed.
  - “No-mock” classification for Playwright suites is based on absence of visible mocking/interception in test code and direct HTTP/browser calls.

**Test Coverage Verdict: PASS (with quality caveats)**

# README Audit

## Project Type Detection

- Declared explicitly as **fullstack** at top of README (`README.md:3`).

## README Location

- Present at required path: `README.md`.

## Hard Gate Evaluation

- Formatting/readability: **PASS** (clear markdown sections, tables, code blocks).
- Startup instruction (`docker-compose up`) for fullstack/backend: **PASS** (`README.md:109` through `README.md:111`, `README.md:143` through `README.md:144`).
- Access method (URL + ports): **PASS** (`README.md:124` through `README.md:129`).
- Verification method: **PASS** (manual API verification + UI checklist in `README.md:237` through `README.md:337`).
- Environment rules (Docker-contained, no required host package installs): **PASS** (`README.md:69`, testing path in `README.md:219` through `README.md:236`).
- Demo credentials with all roles (auth exists): **PASS** (`README.md:194` through `README.md:199`).

## Engineering Quality Assessment

- Tech stack clarity: strong (`README.md:9` through `README.md:15`).
- Architecture explanation: strong (`README.md:16` through `README.md:41`).
- Testing instructions: strong and specific (`README.md:217` through `README.md:236`).
- Security/roles/workflows: strong coverage (`README.md:295` through `README.md:329`, `README.md:190` through `README.md:216`).
- Presentation quality: strong; content is dense but structured.

## High Priority Issues

- None.

## Medium Priority Issues

- Cross-platform friction: some manual examples are shell-specific (e.g., `/tmp/login.json` in `README.md:255`), which may confuse Windows-only operators.

## Low Priority Issues

- Verification section is comprehensive but long; a minimal “5-minute smoke-check” subsection could improve operator speed.

## Hard Gate Failures

- None.

## README Verdict

**PASS**

**Final Verdicts**

- Test Coverage Audit: **PASS (quality caveats noted)**
- README Audit: **PASS**
