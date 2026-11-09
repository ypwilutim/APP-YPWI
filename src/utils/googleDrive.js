const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

function isDriveEnabled() {
  if (process.env.GOOGLE_DRIVE_ENABLED !== 'true') return false;
  const mode = process.env.GOOGLE_DRIVE_AUTH_MODE || 'oauth';
  if (mode === 'service_account') {
    return !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  }
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
}

function createDriveClient() {
  if (!isDriveEnabled()) return null;
  const mode = process.env.GOOGLE_DRIVE_AUTH_MODE || 'oauth';
  let auth;

  if (mode === 'service_account') {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
  } else {
    auth = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  }

  return google.drive({ version: 'v3', auth });
}

function sanitizeName(name) {
  if (!name) return 'Untitled';
  let cleaned = String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length > 100) cleaned = cleaned.slice(0, 100).trim();
  return cleaned || 'Untitled';
}

async function findChildFolder(drive, parentId, name) {
  const safeName = name.replace(/'/g, "\\'");
  const q = [
    `'${parentId}' in parents`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `name = '${safeName}'`,
    `trashed = false`
  ].join(' and ');
  const res = await drive.files.list({
    q,
    fields: 'files(id,name)',
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  return (res.data.files && res.data.files[0]) || null;
}

async function ensureFolder(drive, parentId, name) {
  const clean = sanitizeName(name);
  const existing = await findChildFolder(drive, parentId, clean);
  if (existing) return existing.id;
  const res = await drive.files.create({
    requestBody: {
      name: clean,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    fields: 'id,name',
    supportsAllDrives: true
  });
  return res.data.id;
}

async function ensureFolderPath(drive, rootId, segments) {
  let currentId = rootId;
  for (const segment of segments) {
    currentId = await ensureFolder(drive, currentId, segment);
  }
  return currentId;
}

async function findFileByName(drive, parentId, name) {
  const safeName = name.replace(/'/g, "\\'");
  const q = [
    `'${parentId}' in parents`,
    `name = '${safeName}'`,
    `trashed = false`
  ].join(' and ');
  const res = await drive.files.list({
    q,
    fields: 'files(id,name)',
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  return (res.data.files && res.data.files[0]) || null;
}

async function uploadBuffer({ buffer, name, mimeType, parentId }) {
  const drive = createDriveClient();
  if (!drive) return { ok: false, error: 'Google Drive is not configured' };

  try {
    const cleanName = sanitizeName(name);
    let finalName = cleanName;
    let counter = 2;
    while (await findFileByName(drive, parentId, finalName)) {
      const extIndex = cleanName.lastIndexOf('.');
      if (extIndex > 0) {
        finalName = cleanName.slice(0, extIndex) + ` (${counter})` + cleanName.slice(extIndex);
      } else {
        finalName = cleanName + ` (${counter})`;
      }
      counter += 1;
      if (counter > 100) break;
    }

    const res = await drive.files.create({
      requestBody: {
        name: finalName,
        parents: [parentId]
      },
      media: {
        mimeType: mimeType || 'application/pdf',
        body: require('stream').Readable.from(buffer)
      },
      fields: 'id,name,webViewLink,webContentLink',
      supportsAllDrives: true
    });

    return {
      ok: true,
      id: res.data.id,
      name: res.data.name,
      webViewLink: res.data.webViewLink || res.data.webContentLink || null
    };
  } catch (error) {
    console.error('[GOOGLE DRIVE] upload error:', error.message);
    return { ok: false, error: error.message };
  }
}

const PROFILE_DOC_LABELS = {
  foto: 'Foto Profil',
  ktp: 'KTP',
  kk: 'KK',
  ijazah: 'Ijazah'
};

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf'
  };
  return map[ext] || 'application/octet-stream';
}

async function archiveProfileFileToDrive({ teacher, docType, localPath }) {
  if (!isDriveEnabled()) return null;
  const rootFolderId = process.env.GOOGLE_DRIVE_PROFILE_ROOT_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    console.warn('[GOOGLE DRIVE] profile root folder is not set');
    return null;
  }
  try {
    let resolvedPath = localPath;
    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.join(process.cwd(), 'public', String(resolvedPath).replace(/^\/+/, ''));
    }
    if (!fs.existsSync(resolvedPath)) {
      console.warn('[GOOGLE DRIVE] local file not found:', resolvedPath);
      return null;
    }
    const drive = createDriveClient();
    const tenantName = teacher.nama_sekolah || teacher.tenant_name || 'Tenant';
    const folderId = await ensureFolderPath(drive, rootFolderId, [
      'Profil Guru',
      tenantName,
      teacher.nama || 'Guru'
    ]);
    const label = PROFILE_DOC_LABELS[docType] || docType;
    const ext = path.extname(resolvedPath);
    const fileName = `${label} - ${teacher.nama || 'Guru'}${ext}`;
    const buffer = fs.readFileSync(resolvedPath);
    const upload = await uploadBuffer({
      buffer,
      name: fileName,
      mimeType: guessMimeType(resolvedPath),
      parentId: folderId
    });
    if (!upload || !upload.ok) return null;
    return {
      folderId,
      fileId: upload.id,
      fileName: upload.name,
      webViewLink: upload.webViewLink
    };
  } catch (error) {
    console.error('[GOOGLE DRIVE] profile archive error:', error.message);
    return null;
  }
}

module.exports = {
  isDriveEnabled,
  createDriveClient,
  sanitizeName,
  ensureFolder,
  ensureFolderPath,
  uploadBuffer,
  archiveProfileFileToDrive,
  PROFILE_DOC_LABELS
};
