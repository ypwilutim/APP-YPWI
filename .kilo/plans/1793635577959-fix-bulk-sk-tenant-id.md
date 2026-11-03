# Plan: Fix Bulk SK Generate - Missing tenant_id

## Problem
Frontend mapping di `loadSkBulkCandidates()` tidak menyimpan `tenant_id` dari response API ke state `skBulkRows`. Akibatnya saat `submitSkBulkGenerate()` mengirim payload, `tenant_id` bernilai `undefined`. Backend query mencari guru dengan `ta.tenant_id = NULL` → tidak ketemu → error "Guru tidak ditemukan atau tidak aktif".

## Root Cause
File: `public/js/admin-dashboard.js` line 4240-4253
```javascript
skBulkRows = (data.data || []).map(r => ({
    teacher_id: r.teacher_id,
    nama: r.nama,
    nik: r.nik,
    nama_sekolah: r.nama_sekolah,
    unit: r.unit,
    qualified: r.qualified,
    years_of_service: r.years_of_service,
    min_years: r.min_years,
    already_has_sk: r.already_has_sk,
    selected: r.qualified && !r.already_has_sk,
    manual_verified: false,
    sk: r.sk || {}
    // tenant_id: r.tenant_id  ← HILANG
}));
```

## Fix
Tambahkan `tenant_id: r.tenant_id` di mapping object.

## Files to Change
1. `public/js/admin-dashboard.js` - line 4240-4253: tambahkan `tenant_id: r.tenant_id`

## Validation
1. Buka admin dashboard → Documents → Bulk Generate SK
2. Pilih scope sekolah → klik "Muat Daftar Guru"
3. Centang beberapa guru → klik "Generate SK Terpilih"
4. Pastikan tidak ada error "Guru tidak ditemukan atau tidak aktif"
5. Verifikasi SK terbuat di database: `SELECT * FROM sk_guru ORDER BY created_at DESC LIMIT 10`

## Rollback
Revert perubahan di `admin-dashboard.js` line 4240-4253.