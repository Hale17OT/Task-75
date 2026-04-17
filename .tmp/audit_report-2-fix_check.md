# Issue Recheck Report (Round 3)

Date: 2026-04-17  
Method: Static inspection of current repository state.

## 1) Report download path is not restricted to approved storage roots

- Severity: **Medium**
- Previous conclusion: **Partial Pass**
- Current status: **Fixed**
- Evidence:
  - Canonicalization and approved roots are now enforced in `backend/src/services/report-service.ts:584` through `backend/src/services/report-service.ts:620`.
  - `realpath` is used for both target file and roots (`backend/src/services/report-service.ts:592`, `backend/src/services/report-service.ts:599`).
  - Root containment check via `relative(...)` + absolute/backtrack guard is present (`backend/src/services/report-service.ts:605` through `backend/src/services/report-service.ts:608`).
  - Violation triggers alert + explicit denial (`backend/src/services/report-service.ts:610` through `backend/src/services/report-service.ts:619`).
  - Route still downloads path from service, but service now returns validated canonical path (`backend/src/routes/reports.ts:66`, `backend/src/routes/reports.ts:68`, `backend/src/services/report-service.ts:625`).

## 2) Frontend ISO date formatting uses local timezone conversion

- Severity: **Low**
- Previous conclusion: **Partial Pass**
- Current status: **Fixed**
- Evidence:
  - Formatter now uses UTC getters: `getUTCMonth/getUTCDate/getUTCFullYear` at `frontend/src/utils/date.ts:47`.
  - Inline rationale comment explicitly documents timezone-stability intent (`frontend/src/utils/date.ts:44` through `frontend/src/utils/date.ts:46`).

## 3) Environment-variable naming is inconsistent in documentation

- Severity: **Low**
- Previous conclusion: **Partial Pass**
- Current status: **Fixed**
- Evidence:
  - README now includes explicit mapping section: `README.md:105`.
  - Direct mapping row clarifies `BACKEND_KEY_VAULT_MASTER_KEY -> KEY_VAULT_MASTER_KEY` (`README.md:119`).
  - Explanatory note explicitly states both names refer to the same value via docker-compose remapping (`README.md:134`).

## Final Summary

- Issue 1: **Fixed**
- Issue 2: **Fixed**
- Issue 3: **Fixed**

Overall: **All three reported items are fixed in the current inspected state.**
