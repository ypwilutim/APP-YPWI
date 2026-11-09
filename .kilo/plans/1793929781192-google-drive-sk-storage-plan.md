# Plan: Google Drive Storage for Generated SK + Google Ecosystem Connection

## Goal
Generated SK files are archived to Google Drive in a structured per-tenant folder tree:

`SK / {Tenant / school name} / {Teacher name} / {Gregorian publication year} / {friendly file name}.pdf`

Friendly file name example: `SK Akbar Irwansya Guru Tetap Periode 1 tahun 2026.pdf`.
The app connects to Google through the official `googleapis` client using server-side credentials, while keeping generation/download working when Drive is disabled.

## Scope
In scope:
- Google Drive upload/archive for single and bulk SK generation.
- Folder creation/reuse and filename sanitization.
- DB metadata for Drive file/folder/link.
- Graceful fallback when Drive is not configured.
- Setup documentation for Google Cloud credentials.

Out of scope for first implementation (roadmap only):
- Google Sheets export, Gmail API email, Google Calendar reminders, Google Sign-In.

## Resolved Decisions
- Archive format: PDF only. DOCX remains temporary/local download for editing drafts.
- User access: regular users use app-proxied download (`/api/sk-guru/file/:id`); `drive_web_view_link` is shown only to admin/yayasan dashboards.
- Google ecosystem expansion: implement Sheets/Gmail/Calendar only after Drive integration is stable in production.
- Root folder: `GOOGLE_DRIVE_ROOT_FOLDER_ID` must point to the `SK` root folder; implementation creates `Tenant / Teacher / Year` beneath it.
- Auth default: OAuth2 refresh token for a designated Google account, with service-account mode as a later option.

## Recommended Google Connection Model
Use a designated Google account with OAuth2 offline refresh token:
- `GOOGLE_DRIVE_AUTH_MODE=oauth`
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` (root `SK` folder in that account)

Rationale: avoids service-account storage-quota issues and keeps files visible in a normal Google Drive. Service-account mode can be added later with the same `googleDrive` utility.

## Required Env Additions
```
GOOGLE_DRIVE_ENABLED=false
GOOGLE_DRIVE_AUTH_MODE=oauth
GOOGLE_DRIVE_ROOT_FOLDER_ID=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_DRIVE_UPLOAD_FORMAT=pdf
```

## Files to Add
- `src/utils/googleDrive.js` — auth client, folder ensure/find, upload, sanitize.
- `scripts/google-oauth-setup.js` — one-time helper to obtain refresh token.
- `migrations/migration_sk_guru_drive.sql` — optional SQL mirror of DB changes.

## Files to Modify
- `src/routes/sk-guru.js` — upload after insert in `/generate` and `/bulk-generate`; add `POST /api/sk-guru/sync-drive/:skId`.
- `server.js` — `ensureColumn` calls for Drive metadata on `sk_guru`.
- `public/js/admqu.js` — show Drive link/icon for admin/yayasan only; keep app-proxied download for regular users.
- `public/sdm-dashboard.js` / `public/sdm-dashboard.html` if SK list is shown there (verify during implementation).

## DB Changes
Add to `sk_guru`:
- `drive_file_id VARCHAR(255) NULL`
- `drive_file_name VARCHAR(255) NULL`
- `drive_folder_id VARCHAR(255) NULL`
- `drive_web_view_link VARCHAR(500) NULL`
- `drive_uploaded_at DATETIME NULL`

Use `ensureColumn` in `server.js` startup migration, matching existing pattern.

## Implementation Steps
1. Create `src/utils/googleDrive.js`.
   - `isDriveEnabled()` returns false unless env and credentials present.
   - `createDriveClient()` uses `google.auth.OAuth2` + refresh token.
   - `sanitizeName(name)` removes invalid chars and trims length.
   - `findChildFolder(drive, parentId, name)`.
   - `ensureFolder(drive, parentId, name)`.
   - `ensureFolderPath(drive, rootId, segments[])`.
   - `uploadBuffer({ buffer, name, mimeType, parentId })` returns `{ id, name, webViewLink }`.
   - On any Drive error, log and return `{ ok: false, error }` instead of throwing.

2. Add startup migration in `server.js`:
   - ensure the five Drive columns on `sk_guru`.

3. Update `src/routes/sk-guru.js` `/generate`:
   - Keep existing PDF/DOCX generation.
   - After DB insert, if Drive enabled:
     - Build friendly name:
       - status label from `tentang_type` (`baru -> Guru`, `tetap_guru -> Guru Tetap`, etc.).
       - periode lowercased (`1 Tahun` -> `1 tahun`).
       - year = current Gregorian year.
       - `SK ${teacher.nama} ${statusLabel} Periode ${periodeLower} tahun ${year}`.
     - Folder segments: `[teacher.nama_sekolah, teacher.nama, String(year)]` under root `SK`.
     - Upload PDF buffer.
     - Store returned metadata in `sk_guru`.
   - If upload fails, do not fail SK generation; log warning.

4. Update `/bulk-generate`:
   - In non-preview pass, after insert, generate PDF buffer with `generateSkPdf(htmlData)`.
   - Upload to Drive with same naming/folder logic.
   - Store metadata.
   - Add `drive_file_id` / `drive_web_view_link` to each `generated` item.
   - Keep sequential uploads to avoid memory spikes.

5. Add `POST /api/sk-guru/sync-drive/:skId`:
   - Regenerate PDF from stored SK and re-upload/update metadata.
   - Useful for retry or SKs created before Drive integration.

6. Update frontend SK list:
   - Show Drive icon/link only for admin/yayasan when `drive_web_view_link` exists.
   - Keep existing View/PDF buttons for all users.
   - On generate success, toast should mention Drive archive if enabled.

7. Add setup docs/script:
   - `scripts/google-oauth-setup.js` prints auth URL and exchanges code for refresh token.
   - Document Google Cloud steps: create project, enable Drive API, OAuth consent, client credentials, share root folder.

## Filename and Folder Rules
- Folder/file names sanitized: remove `/\:*?"<>|` and control chars; collapse whitespace; max 100 chars.
- Year folder uses Gregorian publication year (`new Date().getFullYear()`), not Hijri.
- Friendly SK name uses teacher name + status label + periode + Gregorian year.
- If a file with same name exists in target folder, append ` (2)`, ` (3)`, etc.

## Access and Privacy
- Default: file created in designated account; app proxies download through `/api/sk-guru/file/:id` as before.
- `drive_web_view_link` is exposed only to admin/yayasan roles.
- Do not make files publicly readable by default.
- Credentials stay in env/local secret files; never commit.

## Failure Modes
- Drive disabled/misconfigured: SK generation still succeeds; metadata remains null.
- Upload failure: logged, generation succeeds, warning returned where possible.
- Duplicate names: append counter.
- Missing root folder: if invalid, disable uploads with clear log.
- Bulk partial failure: per-row error recorded; successful rows keep metadata.

## Validation
- Generate one SK with Drive disabled: existing behavior unchanged.
- Configure Drive and generate one SK: verify folder tree and file name.
- Bulk generate 3 SKs: verify all three files and DB metadata.
- Delete/retry: sync-drive updates metadata.
- Confirm no secrets in git diff.