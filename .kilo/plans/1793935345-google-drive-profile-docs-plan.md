# Plan: Google Drive Backup for Profile Photos and Complete-Profile Documents

## Goal
Back up teacher profile photos and complete-profile documents (`foto`, `ktp`, `kk`, `ijazah`) to Google Drive, in addition to SK archiving. App download/display continues to use local files; Drive is the backup/archive layer.

## Recommended Structure
`{Drive Root} / Profil Guru / {Tenant / school name} / {Teacher name} / {Foto Profil - Nama.ext}`

Example:
`Profil Guru / SDIT Insan Rabbani / Akbar Irwansya / Foto Profil - Akbar Irwansya.jpg`

## Scope
In scope:
- Upload to Drive on profile photo/document upload and complete-profile submit.
- Backfill endpoint for existing local files.
- DB metadata for Drive file IDs/links.
- Graceful fallback when Drive is disabled.

Out of scope:
- Serving files from Drive instead of local storage.
- Google Sheets/Gmail/Calendar integration.

## DB Changes
Add to `teachers`:
- `drive_profile_folder_id VARCHAR(255) NULL`
- `drive_foto_file_id VARCHAR(255) NULL`
- `drive_foto_web_view_link VARCHAR(500) NULL`
- `drive_ktp_file_id VARCHAR(255) NULL`
- `drive_ktp_web_view_link VARCHAR(500) NULL`
- `drive_kk_file_id VARCHAR(255) NULL`
- `drive_kk_web_view_link VARCHAR(500) NULL`
- `drive_ijazah_file_id VARCHAR(255) NULL`
- `drive_ijazah_web_view_link VARCHAR(500) NULL`

Use `ensureColumn` in `server.js`.

## Files to Modify
- `src/routes/admin.js`:
  - `/api/upload-profile-photo`
  - `/api/public/teachers/:teacherId/upload-document`
  - `/api/public/teachers/:teacherId` (complete profile PUT)
  - add backfill endpoint(s)
- `src/utils/googleDrive.js`:
  - add helper `archiveProfileFileToDrive({ teacher, docType, localPath })`
- `server.js`: ensure columns.

## Implementation Steps
1. Add DB columns via `ensureColumn`.
2. Extend `googleDrive.js`:
   - `getProfileDocLabel(docType)` -> `Foto Profil`, `KTP`, `KK`, `Ijazah`.
   - `archiveProfileFileToDrive({ teacher, docType, localPath })`:
     - resolve local file to buffer
     - ensure folder `{root}/Profil Guru/{tenant}/{teacher}`
     - sanitize filename `{label} - {teacher.nama}{ext}`
     - upload buffer
     - return metadata
3. Update upload endpoints:
   - after saving local file, if Drive enabled, archive file and store metadata
   - failure must not break profile update
4. Update complete-profile PUT:
   - for each uploaded file (`foto`, `ktp`, `kk`, `ijazah`), archive and store metadata
5. Add backfill:
   - `POST /api/admin/sync-profile-drive/:teacherId` uploads all existing local docs
   - optional `POST /api/admin/sync-profile-drive` for tenant/all with batching
6. Admin views:
   - show Drive links only to admin/yayasan

## Folder and Filename Rules
- Folder names sanitized.
- One folder per teacher under `Profil Guru/{Tenant}/{Teacher}`.
- Filename includes document label + teacher name + original extension.

## Access and Privacy
- Drive links are backup metadata; regular users still use local `/uploads/...`.
- Do not make Drive files public.
- Expose `drive_*_web_view_link` only to admin/yayasan.

## Failure Modes
- Drive disabled/misconfigured: local upload succeeds; metadata remains null.
- Missing local file during backfill: skip and record error.
- Upload failure: logged; profile update succeeds.

## Validation
- Upload a profile photo with Drive enabled: verify file in Drive and DB metadata.
- Complete profile with docs: verify all uploaded docs.
- Backfill an existing teacher: verify all available local files.
- Disable Drive: uploads still work locally.