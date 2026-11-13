#!/usr/bin/env node
/**
 * clean-broken-photos.js
 *
 * Memperbaiki `teachers.link_foto` yang menunjuk ke file yang tidak ada di
 * `public/uploads/`. Untuk guru yang link fotonya rusak:
 *   - `teachers.link_foto` diatur NULL
 *   - `users.is_profile_complete` diatur 0 (profile dianggap belum lengkap)
 *
 * Idempotent: bisa dijalankan berulang kali tanpa efek sisi yang tidak diinginkan.
 *
 * Cara pakai:
 *   node scripts/clean-broken-photos.js
 *
 * Bisa dijadwalkan via cron, atau dijalankan setelah migrasi/restore DB.
 */

'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

function resolveLocalPath(linkFoto) {
  if (!linkFoto) return null;
  const rel = String(linkFoto).replace(/^\/+/, '');
  return path.join(process.cwd(), 'public', rel);
}

async function main() {
  const teachers = await db.query(
    'SELECT id, nama, link_foto FROM teachers WHERE link_foto IS NOT NULL AND link_foto != ""'
  );

  let ok = 0;
  let broken = 0;
  const brokenIds = [];

  for (const t of teachers) {
    const fullPath = resolveLocalPath(t.link_foto);
    if (fullPath && fs.existsSync(fullPath)) {
      ok++;
    } else {
      broken++;
      brokenIds.push(t.id);
    }
  }

  console.log(`[CLEAN-PHOTOS] link_foto valid: ${ok}, rusak: ${broken}`);

  if (!brokenIds.length) {
    console.log('[CLEAN-PHOTOS] Tidak ada foto rusak, tidak ada perubahan.');
    return;
  }

  // Hapus link_foto yang rusak
  const placeholders = brokenIds.map(() => '?').join(',');
  await db.query(
    `UPDATE teachers SET link_foto = NULL WHERE id IN (${placeholders})`,
    brokenIds
  );

  // Tandai user terkait sebagai profile belum lengkap
  const userRows = await db.query(
    `SELECT id, guru_id FROM users WHERE guru_id IN (${placeholders})`,
    brokenIds
  );
  let userUpdated = 0;
  for (const u of userRows) {
    await db.query(
      'UPDATE users SET is_profile_complete = 0 WHERE id = ?',
      [u.id]
    );
    userUpdated++;
  }

  console.log(
    `[CLEAN-PHOTOS] Dihapus ${brokenIds.length} link_foto rusak, direset ${userUpdated} user.is_profile_complete.`
  );
  console.log(`[CLEAN-PHOTOS] Broken teacher_ids: ${brokenIds.join(', ')}`);
}

main()
  .catch((err) => {
    console.error('[CLEAN-PHOTOS] Error:', err.message);
    process.exit(1);
  })
  .finally(() => process.exit(0));