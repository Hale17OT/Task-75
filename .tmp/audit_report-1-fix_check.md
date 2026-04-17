# Issue Recheck Report

Date: 2026-04-17  
Scope: Static verification of the 4 previously reported issues only.

## 1) Repository tracks encrypted biometric artifact files

- Status: **Fixed**
- Result: No encrypted upload artifacts are currently tracked, and ignore rules now cover runtime data paths.
- Evidence:
  - Ignore rules present: `.gitignore:10`, `.gitignore:13`
  - Keep-only exceptions present: `.gitignore:11`, `.gitignore:12`, `.gitignore:14`
  - Currently tracked files under data path are only placeholders: `backend/data/.gitkeep`, `backend/data/uploads/.gitkeep` (from `git ls-files "backend/data/**"`)
  - No tracked `.enc` uploads: `git ls-files "backend/data/uploads/*.enc"` returned empty
- Notes: This confirms current repository state. It does **not** prove historical git history was rewritten.

## 2) Dry-run restore not-found handling for `backupRunId`

- Status: **Fixed**
- Result: Missing backup records now trigger explicit 404 error.
- Evidence:
  - Lookup and guard: `backend/src/services/ops-service.ts:336` to `backend/src/services/ops-service.ts:343`
  - Explicit throw: `throw new AppError(404, "backup_not_found", "Backup run was not found")` at `backend/src/services/ops-service.ts:342`

## 3) Date filter validation accepted semantically invalid dates

- Status: **Fixed**
- Result: Backend and frontend now perform semantic calendar validation (not regex-only).
- Evidence:
  - Backend semantic check function: `backend/src/routes/content.ts:26` to `backend/src/routes/content.ts:44`
  - Backend validation hook applies semantic checks: `backend/src/routes/content.ts:53` to `backend/src/routes/content.ts:77`
  - Frontend semantic date-part validation: `frontend/src/utils/date.ts:3` to `frontend/src/utils/date.ts:14`
  - Frontend parser rejects invalid calendar dates: `frontend/src/utils/date.ts:27` to `frontend/src/utils/date.ts:29`

## 4) Encoding artifacts (mojibake) in UI/docs text

- Status: **Fixed**
- Result: Referenced lines render normal text/symbols.
- Evidence:
  - README command text is clean: `README.md:110`
  - UI widget line text is clean: `frontend/src/components/DashboardBuilderView.vue:58`

## Final Verdict

- Issue 1: **Fixed (current tree/index)**
- Issue 2: **Fixed**
- Issue 3: **Fixed**
- Issue 4: **Fixed**

Overall: **All four reported issues are fixed in the current inspected state.**
