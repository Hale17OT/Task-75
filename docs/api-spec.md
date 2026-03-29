# SentinelFit API Spec

## Base
- Base URL: `http://<host>:3000`
- Default local URLs:
  - Frontend: `http://127.0.0.1:5173`
  - Backend: `http://127.0.0.1:3000`

## Envelope

### Success
```json
{
  "ok": true,
  "data": {}
}
```

### Error
```json
{
  "ok": false,
  "error": {
    "code": "string_code",
    "message": "Human-readable message",
    "details": null
  }
}
```

## Authentication and Signing

### Cookies
- `sf_session`: session token (httpOnly)
- `sf_workstation`: workstation binding token (httpOnly)

### Station header
- `x-station-token` is required by platform workflows and is attached to all frontend requests.

### Signed request headers (authenticated protected routes)
- `x-sf-timestamp` ISO timestamp
- `x-sf-nonce` unique nonce
- `x-sf-signature` HMAC SHA-256 hex digest

Payload format used for signature:
`METHOD\nPATH_WITH_QUERY\nTIMESTAMP\nNONCE\nSHA256(JSON_BODY_OR_EMPTY)`

### Unsigned routes
- `/api/auth/bootstrap/status`
- `/api/auth/restore`
- `/api/auth/bootstrap/admin`
- `/api/auth/login`
- `/api/auth/pin/reenter`

All other authenticated application APIs require valid signed headers.

## Health

### GET `/`
Returns API identity.

### GET `/health/live`
- Auth: none
- Response data:
  - `status`
  - `environment`
  - `service`

### GET `/health/ready`
- Auth: none
- Response data:
  - `status` (`ok` or `degraded`)
  - `environment`
  - `services.api`
  - `services.database`
- Status: `200` when DB reachable, `503` when degraded.

## Auth API (`/api/auth`)

### GET `/bootstrap/status`
- Auth: none
- Response data:
  - `requiresBootstrap: boolean`

### POST `/restore`
- Auth: none
- Uses cookies if present
- Response data:
  - `session` (`null` in current implementation for restore response body)
  - `warmLocked: boolean`
  - `currentUser: SessionUser | null`
  - `hasPin: boolean`
  - `warmLockMinutes: number`
  - `sessionTimeoutMinutes: number`
  - `lastActivityAt: string | null`

### POST `/bootstrap/admin`
- Auth: none
- Request body:
```json
{
  "username": "owner",
  "fullName": "Facility Owner",
  "password": "Owner12345!X"
}
```
- Response data:
  - `currentUser`
  - `sessionSecret`
  - `sessionTimeoutMinutes`
  - `warmLockMinutes`
  - `hasPin`
- Sets cookies: `sf_session`, `sf_workstation`

### POST `/login`
- Auth: none
- Request body:
```json
{
  "username": "admin",
  "password": "Admin12345!X"
}
```
- Response data: same shape as bootstrap admin
- Sets cookies: `sf_session`, `sf_workstation`

### POST `/pin/setup`
- Auth: signed + active session
- Request body:
```json
{ "pin": "1234" }
```
- Response data:
```json
{ "hasPin": true }
```

### POST `/pin/reenter`
- Auth: unsigned route, but requires matching warm session/workstation cookies and context
- Request body:
```json
{
  "username": "admin",
  "pin": "1234"
}
```
- Response data: same shape as login
- Sets refreshed cookies: `sf_session`, `sf_workstation`

### POST `/warm-lock`
- Auth: signed + active session
- Response data:
```json
{ "warmLocked": true }
```

### POST `/logout`
- Auth: signed + active session
- Response data:
```json
{ "loggedOut": true }
```
- Clears cookies: `sf_session`, `sf_workstation`

### GET `/session`
- Auth: signed + active session
- Response data:
```json
{
  "session": {
    "currentUser": {
      "id": 1,
      "username": "admin",
      "fullName": "System Administrator",
      "roles": ["Administrator", "Coach", "Member"]
    },
    "hasPin": true,
    "warmLockMinutes": 5,
    "sessionTimeoutMinutes": 30,
    "lastActivityAt": "2026-03-29T00:00:00.000Z"
  }
}
```

## Self API (`/api/self`)

### GET `/profile`
- Auth: signed
- Roles: any authenticated user
- Response data:
  - `member: MemberSummary`

### POST `/consent/face`
- Auth: signed
- Request body:
```json
{ "consentStatus": "granted" }
```
- Response data:
  - `member: MemberSummary`

## Members API (`/api/members`)
Requires signed session and role `Coach` or `Administrator`.

### GET `/`
- Response data:
  - `members: MemberSummary[]`
  - `coaches: CoachSummary[]`

### POST `/`
- Request body:
```json
{
  "username": "member01",
  "fullName": "Member One",
  "password": "Member12345!X",
  "phone": "251912345678",
  "locationCode": "HQ",
  "notes": "optional",
  "coachUserId": 2
}
```
- Response data:
  - `member: MemberSummary`

### POST `/:id/coach-assignment`
- Request body:
```json
{ "coachUserId": 2 }
```
- Response data:
  - `member: MemberSummary`

### POST `/:id/consent/face`
- Request body:
```json
{ "consentStatus": "declined" }
```
- Response data:
  - `member: MemberSummary`

### GET `/coaches/:coachUserId/locations`
- Response data:
  - `locations: [{ coachUserId, locationCode, isActive, assignedAt }]`

### POST `/coaches/:coachUserId/locations`
- Request body:
```json
{ "locationCode": "HQ" }
```
- Response data:
  - `location: { coachUserId, locationCode, isActive }`

## Faces API (`/api/faces`)
Requires signed session and role `Member`, `Coach`, or `Administrator`.

### POST `/challenge`
- Request body:
```json
{ "memberUserId": 3 }
```
- Response data:
```json
{
  "challenge": {
    "challengeId": "token",
    "issuedAt": "ISO",
    "expiresAt": "ISO",
    "minDelayMs": 1000,
    "maxDelayMs": 30000
  }
}
```

### POST `/dedup-check`
- Request body:
```json
{
  "memberUserId": 3,
  "sourceType": "camera",
  "centerImageBase64": "data:image/png;base64,...",
  "turnImageBase64": "data:image/png;base64,..."
}
```
- Response data:
  - `dedup.duplicateWarning` (`null`, detailed match, or redacted warning)
  - `dedup.warningDetected: boolean`

### POST `/enroll`
- Request body:
```json
{
  "memberUserId": 3,
  "sourceType": "camera",
  "challengeId": "challenge-token",
  "centerImageBase64": "data:image/png;base64,...",
  "turnImageBase64": "data:image/png;base64,..."
}
```
- Response data:
  - `result.faceRecordId`
  - `result.versionNumber`
  - `result.blurScore`
  - `result.livenessScore`
  - `result.duplicateWarning`

### PATCH `/:faceRecordId/deactivate`
- Response data:
```json
{ "deactivated": true }
```

### GET `/history/:memberUserId`
- Response data:
  - `history[]` with `faceRecordId`, `status`, `versionNumber`, scores, timestamps

### GET `/audit/:memberUserId`
- Response data:
  - `auditTrail[]` with `eventType`, `actorName`, `details`, `createdAt`

## Content API (`/api/content`)
Requires signed session. Some routes additionally require coach/admin.

### GET `/posts`
- Query optional: `locationCode`
- Response data:
  - `posts: ContentPost[]`

### POST `/posts`
- Roles: `Coach` or `Administrator`
- Request body:
```json
{
  "kind": "tip",
  "title": "Hydration Tip",
  "body": "Drink before training.",
  "locationCode": "HQ"
}
```
- Response data:
  - `post: ContentPost`

### POST `/views`
- Request body:
```json
{ "postId": 12 }
```
- Response data:
```json
{ "recorded": true }
```

### POST `/search-events`
- Request body:
```json
{
  "searchTerm": "mobility",
  "locationCode": "HQ"
}
```
- Response data:
```json
{ "recorded": true }
```

### GET `/analytics`
- Roles: `Coach` or `Administrator`
- Query:
  - `startDate` (`YYYY-MM-DD`, optional)
  - `endDate` (`YYYY-MM-DD`, optional, must be >= startDate)
  - `locationCode` (optional)
  - `includeHistorical` (`true|false`, optional)
- Response data:
  - `analytics.viewsByStation[]`
  - `analytics.topPosts[]`
  - `analytics.searchTrends[]`
  - `analytics.posts[]`

## Dashboards API (`/api/dashboards`)
Requires signed session and `Administrator` role.

### GET `/me`
- Response data:
  - `layout: DashboardWidget[]`
  - `templates: DashboardTemplate[]`

### PUT `/me`
- Request body:
```json
{
  "layout": [
    {
      "id": "viewsByStation-1",
      "widgetType": "viewsByStation",
      "title": "Views by station",
      "locationCode": "HQ",
      "x": 0,
      "y": 0,
      "width": 6,
      "height": 4
    }
  ]
}
```
- Response data:
  - `layout: DashboardWidget[]`

### POST `/templates`
- Request body:
```json
{
  "name": "Weekly Template",
  "layout": []
}
```
- Response data:
  - `template: DashboardTemplate`

## Reports API (`/api/reports`)
Requires signed session.

### GET `/schedules`
- Roles: `Administrator`
- Response data:
  - `schedules: ReportScheduleSummary[]`

### GET `/recipients`
- Roles: `Administrator`
- Response data:
  - `recipients: RecipientSummary[]`

### POST `/schedules`
- Roles: `Administrator`
- Request body:
```json
{
  "templateId": 1,
  "name": "Weekly Operations Snapshot",
  "cronExpression": "0 6 * * 1",
  "format": "pdf",
  "locationCode": "HQ",
  "subscriberUserIds": [1, 2]
}
```
- Response data:
  - `schedule` summary with id, cron, export format, owner, timestamps

### POST `/generate`
- Roles: `Administrator`
- Request body:
```json
{
  "templateId": 1,
  "format": "excel",
  "locationCode": "HQ"
}
```
- Response data:
  - `report` includes export id, paths, checksum, payload snapshot

### GET `/inbox`
- Roles: any authenticated user
- Response data:
  - `inbox: ReportInboxItem[]`

### GET `/inbox/:id/download`
- Roles: owner of inbox item
- Response: file download stream
- Side effect: marks inbox item as read

## Admin API (`/api/admin`)
Requires signed session and `Administrator` role.

### GET `/console`
- Response data:
  - `console.metrics`
  - `console.recentLogs[]`
  - `console.recentAlerts[]`

### POST `/backups`
- Response data:
  - `backup: { id, keyId, filePath, checksum }`

### POST `/recovery/dry-run`
- Request body:
```json
{ "backupRunId": 10 }
```
- Response data:
  - `recovery` pass/fail summary

## Common Error Codes
- `validation_failed` (400)
- `password_policy` (400)
- `pin_policy` (400)
- `image_invalid` / `image_too_large` / `image_too_small` (400)
- `capture_timing_invalid` (400)
- `consent_required` (400)
- `quality_failed` (400)
- `liveness_failed` (400)
- `missing_session` (401)
- `invalid_session` (401)
- `session_expired` (401)
- `signature_missing` / `signature_invalid` / `timestamp_invalid` / `timestamp_stale` / `nonce_replayed` (401)
- `invalid_credentials` / `invalid_pin_login` (401)
- `forbidden` / `forbidden_location_scope` / `ip_forbidden` (403)
- `warm_locked` (423)
- `account_locked` (423)
- `member_exists` / `user_exists` / `duplicate_detected` (409)
- `rate_limited` (429)
- `internal_error` (500)

## Typed Models (Frontend Contracts)

### `SessionUser`
```ts
{
  id: number;
  username: string;
  fullName: string;
  roles: ("Member" | "Coach" | "Administrator")[];
}
```

### `MemberSummary`
```ts
{
  id: number;
  username: string;
  fullName: string;
  phoneMasked: string | null;
  phoneLast4: string | null;
  locationCode: string;
  notes: string | null;
  active: boolean;
  coachUserId: number | null;
  faceConsentStatus: string;
}
```

### `ReportScheduleSummary`
```ts
{
  id: number;
  templateId: number;
  name: string;
  cronExpression: string;
  exportFormat: "csv" | "excel" | "pdf";
  locationCode: string | null;
  isActive: boolean;
  lastRunAt: string | null;
  createdAt: string;
  subscriberUserIds: number[];
}
```

### `AdminConsole`
```ts
{
  metrics: {
    totalLogs: number;
    openAlerts: number;
    uptimeSeconds: number;
    averageRequestDurationMs: number;
    serverErrorRate: number;
    lastReportDurationMs: number;
    lastBackupDurationMs: number;
  };
  recentLogs: { category: string; level: string; message: string; createdAt: string }[];
  recentAlerts: { alertType: string; severity: string; message: string; createdAt: string }[];
}
```
