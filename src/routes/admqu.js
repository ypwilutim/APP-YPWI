const express = require('express');
const db = require('../../db');
const { authenticateOperator } = require('../middleware/auth');
const { toHijri } = require('hijri-converter');

const router = express.Router();

const hijriMonths = ['Muharam', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Syaban', 'Ramadhan', 'Syawal', 'Dzul Qaidah', 'Dzul Hijjah'];

function gregorianToHijri(date) {
  const h = toHijri(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return {
    day: h.hd,
    month: hijriMonths[h.hm - 1] || 'Muharam',
    year: h.hy
  };
}

function getCurrentHijriYear() {
  return gregorianToHijri(new Date()).year;
}

function getTeacherIdFromUser(user) {
  if (user.guru_id) return user.guru_id;
  if (user.assignments && user.assignments.length > 0) {
    const primary = user.assignments[0];
    return primary.teacher_id || null;
  }
  return null;
}

function getTenantIdFromUser(user) {
  if (user.tenant_id) return user.tenant_id;
  if (user.assignments && user.assignments.length > 0) {
    return user.assignments[0].tenant_id || null;
  }
  return null;
}

router.get('/sk-status', authenticateOperator, async (req, res) => {
  try {
    const teacherId = getTeacherIdFromUser(req.user);
    const tenantId = getTenantIdFromUser(req.user);
    const hijriYear = getCurrentHijriYear();

    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID tidak ditemukan di token' });
    }

    const [existingSk] = await db.query(
      'SELECT * FROM sk_guru WHERE teacher_id = ? AND YEAR(STR_TO_DATE(bm, "%d %M %Y")) = ? ORDER BY created_at DESC LIMIT 1',
      [teacherId, hijriYear]
    );

    if (existingSk) {
      return res.json({
        success: true,
        data: {
          hasSk: true,
          sk: existingSk,
          hijriYear
        }
      });
    }

    const [teacher] = await db.query(
      'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1 ORDER BY ta.created_at ASC, ta.id ASC LIMIT 1',
      [teacherId]
    );

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan' });
    }

    const today = new Date();
    const currMonthIdx = today.getMonth();
    const currYear = today.getFullYear();
    const decMonthIdx = 11;
    const lastDayDec = new Date(currYear, decMonthIdx + 1, 0).getDate();
    const tglSelesai = lastDayDec + ' Desember ' + currYear + ' M';
    let tglMulai;
    if (currMonthIdx === 0) {
      tglMulai = '1 Januari ' + currYear + ' M';
    } else {
      tglMulai = today.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + ' M';
    }

    return res.json({
      success: true,
      data: {
        hasSk: false,
        eligible: true,
        teacher: {
          id: teacher.id,
          nama: teacher.nama,
          nik: teacher.nik,
          nip: teacher.nip,
          tenant_id: teacher.tenant_id,
          tenant_pk: teacher.tenant_pk,
          nama_sekolah: teacher.nama_sekolah,
          unit: teacher.unit || teacher.nama_sekolah || 'Guru',
          pt: teacher.pt || null,
          tmt: teacher.tmt,
          status_kepegawaian: teacher.status_kepegawaian,
          tempat_lahir: teacher.tempat_lahir,
          tanggal_lahir: teacher.tanggal_lahir
        },
        suggested: {
          tgl_mulai: tglMulai,
          tgl_selesai: tglSelesai,
          hijri_year: hijriYear
        }
      }
    });
  } catch (error) {
    console.error('ADMQU SK Status error:', error);
    res.status(500).json({ success: false, message: 'Error fetching SK status: ' + error.message });
  }
});

router.get('/absensi-ringkasan', authenticateOperator, async (req, res) => {
  try {
    const teacherId = getTeacherIdFromUser(req.user);
    const tenantId = getTenantIdFromUser(req.user);

    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID tidak ditemukan di token' });
    }

    const bulan = parseInt(req.query.bulan) || (new Date().getMonth() + 1);
    const tahun = parseInt(req.query.tahun) || new Date().getFullYear();

    const daysInMonth = new Date(tahun, bulan, 0).getDate();

    const firstDayOfMonth = String(tahun).padStart(4, '0') + '-' + String(bulan).padStart(2, '0') + '-01';
    const lastDayOfMonth = String(tahun).padStart(4, '0') + '-' + String(bulan).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0');

    const logs = await db.query(
      'SELECT DAY(al.waktu_scan) as hari, al.status, al.jenis, al.dinas_luar, al.keterangan, al.waktu_scan FROM attendance_logs al WHERE MONTH(al.waktu_scan) = ? AND YEAR(al.waktu_scan) = ? AND al.teacher_id = ?',
      [bulan, tahun, teacherId]
    );

    const leaveLogs = await db.query(
      'SELECT lr.jenis, lr.keterangan, lr.tanggal_mulai, lr.tanggal_selesai FROM leave_requests lr WHERE lr.status = ? AND lr.teacher_id = ? AND ((MONTH(lr.tanggal_mulai) = ? AND YEAR(lr.tanggal_mulai) = ?) OR (MONTH(lr.tanggal_selesai) = ? AND YEAR(lr.tanggal_selesai) = ?) OR (lr.tanggal_mulai <= ? AND lr.tanggal_selesai >= ?))',
      ['approved', teacherId, bulan, tahun, bulan, tahun, firstDayOfMonth, lastDayOfMonth]
    );

    const dailyRecord = {};
    let hadir = 0, terlambat = 0, izin = 0, sakit = 0, dinas_luar = 0, cuti = 0, tanpa_keterangan = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      dailyRecord[d] = { status: '', jenis: '', keterangan: '' };
    }

    const allLogs = [
      ...logs.map(l => ({
        hari: l.hari,
        status: l.status,
        jenis: l.jenis,
        dinas_luar: l.dinas_luar,
        keterangan: l.keterangan,
        waktu_scan: l.waktu_scan
      })),
      ...leaveLogs.flatMap(l => {
        const entries = [];
        const startDate = new Date(l.tanggal_mulai);
        const endDate = new Date(l.tanggal_selesai);
        let current = new Date(startDate);
        while (current <= endDate) {
          if (current.getMonth() === bulan - 1 && current.getFullYear() === tahun) {
            entries.push({
              hari: current.getDate(),
              status: l.jenis,
              jenis: l.jenis,
              dinas_luar: l.jenis === 'dinas_luar' ? 1 : 0,
              keterangan: l.keterangan
            });
          }
          current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
        }
        return entries;
      })
    ];

    allLogs.sort((a, b) => {
      const timeA = a.waktu_scan ? new Date(a.waktu_scan).getTime() : 0;
      const timeB = b.waktu_scan ? new Date(b.waktu_scan).getTime() : 0;
      return timeA - timeB;
    });

    const dailyBest = {};
    allLogs.forEach(l => {
      const day = parseInt(l.hari);
      if (day < 1 || day > daysInMonth) return;
      if (!dailyBest[day]) dailyBest[day] = { masuk: null, pulang: null, masukStatus: null, pulangStatus: null, keterangan: l.keterangan, dinas_luar: l.dinas_luar, jenis: l.jenis };

      const waktu = l.waktu_scan ? new Date(l.waktu_scan) : null;
      const jam = waktu ? waktu.getHours() * 60 + waktu.getMinutes() : -1;

      if (l.jenis === 'masuk') {
        if (!dailyBest[day].masuk || (jam >= 240 && jam < dailyBest[day].masuk) || (dailyBest[day].masuk < 240 && jam >= 240)) {
          dailyBest[day].masuk = jam;
          dailyBest[day].masukStatus = l.status;
        }
      } else if (l.jenis === 'pulang') {
        if (!dailyBest[day].pulang || jam > dailyBest[day].pulang) {
          dailyBest[day].pulang = jam;
          dailyBest[day].pulangStatus = l.status;
        }
      }

      if (l.jenis !== 'masuk' && l.jenis !== 'pulang') {
        dailyBest[day].jenis = l.jenis;
        dailyBest[day].keterangan = l.keterangan;
        dailyBest[day].dinas_luar = l.dinas_luar;
      }
    });

    const daily = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const dayData = dailyBest[d];
      if (!dayData) {
        daily[d] = '-';
        continue;
      }

      if (dayData.jenis && dayData.jenis !== 'masuk' && dayData.jenis !== 'pulang') {
        const label = dayData.jenis === 'izin' ? 'I' : dayData.jenis === 'sakit' ? 'S' : dayData.jenis === 'dinas_luar' ? 'D' : dayData.jenis === 'cuti' ? 'C' : dayData.jenis.charAt(0).toUpperCase();
        daily[d] = label;
        switch (dayData.jenis) {
          case 'izin': izin++; break;
          case 'sakit': sakit++; break;
          case 'dinas_luar': dinas_luar++; break;
          case 'cuti': cuti++; break;
        }
      } else if (dayData.masuk !== null) {
        const status = dayData.masukStatus || 'tepat_waktu';
        daily[d] = status === 'terlambat' ? 'T' : 'H';
        if (status === 'terlambat') terlambat++;
        else hadir++;
      } else {
        daily[d] = '-';
      }
    }

    const weekendDays = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(tahun, bulan - 1, d);
      if (date.getDay() === 0 || date.getDay() === 6) weekendDays.push(d);
    }

    const totalWeekdays = daysInMonth - weekendDays.length;
    const totalHadirCount = hadir + terlambat;
    const tanpaKetCount = totalWeekdays - (hadir + terlambat + izin + sakit + dinas_luar + cuti);
    tanpa_keterangan = Math.max(0, tanpaKetCount);

    res.json({
      success: true,
      data: {
        bulan,
        tahun,
        summary: {
          hadir,
          terlambat,
          izin,
          sakit,
          dinas_luar,
          cuti,
          tanpa_keterangan,
          total_hari_kerja: totalWeekdays,
          total_kehadiran: totalHadirCount
        },
        daily
      }
    });
  } catch (error) {
    console.error('ADMQU Absensi Ringkasan error:', error);
    res.status(500).json({ success: false, message: 'Error fetching absensi ringkasan: ' + error.message });
  }
});

router.get('/slip-gaji', authenticateOperator, async (req, res) => {
  try {
    const teacherId = getTeacherIdFromUser(req.user);
    const tenantId = getTenantIdFromUser(req.user);

    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID tidak ditemukan di token' });
    }

    const bulan = parseInt(req.query.bulan) || (new Date().getMonth() + 1);
    const tahun = parseInt(req.query.tahun) || new Date().getFullYear();
    const periode = tahun + '-' + String(bulan).padStart(2, '0');

    const [teacher] = await db.query(
      `SELECT t.id, t.nama, t.nik, t.nip, t.email, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt,
        ta.jabatan_di_unit, ta.tenant_id, tn.nama_sekolah
       FROM teachers t
       JOIN teacher_assignments ta ON t.id = ta.teacher_id
       JOIN tenants tn ON ta.tenant_id = tn.tenant_id
       WHERE t.id = ? AND t.status_aktif = 1
       ORDER BY ta.created_at ASC, ta.id ASC LIMIT 1`,
      [teacherId]
    );

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan' });
    }

    const [salaryData] = await db.query(
      `SELECT Gaji_Pokok, Tunj_Kinerja, Tunj_Umum, Tunj_Istri, Tunj_Anak,
        Tunj_Kepala_Sekolah, Tunj_Wali_Kelas, Honor_Bendahara
       FROM temp_teachers WHERE nama = ? LIMIT 1`,
      [teacher.nama]
    );

    const gajiPokok = parseFloat(salaryData?.Gaji_Pokok || 0);
    const tunjKinerja = parseFloat(salaryData?.Tunj_Kinerja || 0);
    const tunjUmum = parseFloat(salaryData?.Tunj_Umum || 0);
    const tunjIstri = parseFloat(salaryData?.Tunj_Istri || 0);
    const tunjAnak = parseFloat(salaryData?.Tunj_Anak || 0);
    const tunjKepalaSekolah = parseFloat(salaryData?.Tunj_Kepala_Sekolah || 0);
    const tunjWaliKelas = parseFloat(salaryData?.Tunj_Wali_Kelas || 0);
    const honorBendahara = parseFloat(salaryData?.Honor_Bendahara || 0);

    const daysInMonth = new Date(tahun, bulan, 0).getDate();
    const firstDayOfMonth = String(tahun).padStart(4, '0') + '-' + String(bulan).padStart(2, '0') + '-01';
    const lastDayOfMonth = String(tahun).padStart(4, '0') + '-' + String(bulan).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0');

    const logs = await db.query(
      'SELECT DAY(al.waktu_scan) as hari, al.status, al.jenis, al.dinas_luar, al.keterangan, al.waktu_scan FROM attendance_logs al WHERE MONTH(al.waktu_scan) = ? AND YEAR(al.waktu_scan) = ? AND al.teacher_id = ?',
      [bulan, tahun, teacherId]
    );

    const leaveLogs = await db.query(
      'SELECT lr.jenis, lr.keterangan, lr.tanggal_mulai, lr.tanggal_selesai FROM leave_requests lr WHERE lr.status = ? AND lr.teacher_id = ? AND ((MONTH(lr.tanggal_mulai) = ? AND YEAR(lr.tanggal_mulai) = ?) OR (MONTH(lr.tanggal_selesai) = ? AND YEAR(lr.tanggal_selesai) = ?) OR (lr.tanggal_mulai <= ? AND lr.tanggal_selesai >= ?))',
      ['approved', teacherId, bulan, tahun, bulan, tahun, firstDayOfMonth, lastDayOfMonth]
    );

    const allLogs = [
      ...logs.map(l => ({
        hari: l.hari,
        status: l.status,
        jenis: l.jenis,
        dinas_luar: l.dinas_luar,
        keterangan: l.keterangan,
        waktu_scan: l.waktu_scan
      })),
      ...leaveLogs.flatMap(l => {
        const entries = [];
        const startDate = new Date(l.tanggal_mulai);
        const endDate = new Date(l.tanggal_selesai);
        let current = new Date(startDate);
        while (current <= endDate) {
          if (current.getMonth() === bulan - 1 && current.getFullYear() === tahun) {
            entries.push({
              hari: current.getDate(),
              status: l.jenis,
              jenis: l.jenis,
              dinas_luar: l.jenis === 'dinas_luar' ? 1 : 0,
              keterangan: l.keterangan
            });
          }
          current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
        }
        return entries;
      })
    ];

    allLogs.sort((a, b) => {
      const timeA = a.waktu_scan ? new Date(a.waktu_scan).getTime() : 0;
      const timeB = b.waktu_scan ? new Date(b.waktu_scan).getTime() : 0;
      return timeA - timeB;
    });

    const dailyBest = {};
    allLogs.forEach(l => {
      const day = parseInt(l.hari);
      if (day < 1 || day > daysInMonth) return;
      if (!dailyBest[day]) dailyBest[day] = { masuk: null, pulang: null, masukStatus: null, pulangStatus: null, keterangan: l.keterangan, dinas_luar: l.dinas_luar, jenis: l.jenis };

      const waktu = l.waktu_scan ? new Date(l.waktu_scan) : null;
      const jam = waktu ? waktu.getHours() * 60 + waktu.getMinutes() : -1;

      if (l.jenis === 'masuk') {
        if (!dailyBest[day].masuk || (jam >= 240 && jam < dailyBest[day].masuk) || (dailyBest[day].masuk < 240 && jam >= 240)) {
          dailyBest[day].masuk = jam;
          dailyBest[day].masukStatus = l.status;
        }
      } else if (l.jenis === 'pulang') {
        if (!dailyBest[day].pulang || jam > dailyBest[day].pulang) {
          dailyBest[day].pulang = jam;
          dailyBest[day].pulangStatus = l.status;
        }
      }

      if (l.jenis !== 'masuk' && l.jenis !== 'pulang') {
        dailyBest[day].jenis = l.jenis;
        dailyBest[day].keterangan = l.keterangan;
        dailyBest[day].dinas_luar = l.dinas_luar;
      }
    });

    let hadir = 0, terlambat = 0, izin = 0, sakit = 0, dinas_luar = 0, cuti = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dayData = dailyBest[d];
      if (!dayData) continue;
      if (dayData.jenis && dayData.jenis !== 'masuk' && dayData.jenis !== 'pulang') {
        switch (dayData.jenis) {
          case 'izin': izin++; break;
          case 'sakit': sakit++; break;
          case 'dinas_luar': dinas_luar++; break;
          case 'cuti': cuti++; break;
        }
      } else if (dayData.masuk !== null) {
        const status = dayData.masukStatus || 'tepat_waktu';
        if (status === 'terlambat') terlambat++;
        else hadir++;
      }
    }

    const [deductionSettings] = await db.query(
      'SELECT potongan_terlambat, potongan_izin, potongan_sakit, potongan_tanpa_keterangan, potongan_tidak_hadir, tunj_kehadiran FROM payroll_deduction_settings LIMIT 1'
    );

    const potTerlambat = parseFloat(deductionSettings?.potongan_terlambat || 0);
    const potIzin = parseFloat(deductionSettings?.potongan_izin || 0);
    const potSakit = parseFloat(deductionSettings?.potongan_sakit || 0);
    const potTanpaKet = parseFloat(deductionSettings?.potongan_tanpa_keterangan || 0);
    const potTidakHadir = parseFloat(deductionSettings?.potongan_tidak_hadir || 0);
    const tunjKehadiran = parseFloat(deductionSettings?.tunj_kehadiran || 0);

    const weekendDays = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(tahun, bulan - 1, d);
      if (date.getDay() === 0 || date.getDay() === 6) weekendDays.push(d);
    }
    const totalWeekdays = daysInMonth - weekendDays.length;
    const totalHadirCount = hadir + terlambat;
    const tanpaKetCount = totalWeekdays - (hadir + terlambat + izin + sakit + dinas_luar + cuti);
    const tanpaKeterangan = Math.max(0, tanpaKetCount);

    const totalTunjangan = tunjKinerja + tunjUmum + tunjIstri + tunjAnak + tunjKepalaSekolah + tunjWaliKelas;
    const totalPenggajian = gajiPokok + totalTunjangan + honorBendahara + tunjKehadiran;

    const potonganTerlambat = terlambat * potTerlambat;
    const potonganIzin = izin * potIzin;
    const potonganSakit = sakit * potSakit;
    const potonganTanpaKet = tanpaKeterangan * potTanpaKet;
    const totalPotongan = potonganTerlambat + potonganIzin + potonganSakit + potonganTanpaKet;

    const totalBersih = totalPenggajian - totalPotongan;

    res.json({
      success: true,
      data: {
        periode,
        guru: {
          nama: teacher.nama,
          nip: teacher.nip || '-',
          nik: teacher.nik,
          jabatan: teacher.jabatan_di_unit,
          sekolah: teacher.nama_sekolah
        },
        rincian: {
          gaji_pokok: gajiPokok,
          tunj_kinerja: tunjKinerja,
          tunj_umum: tunjUmum,
          tunj_istri: tunjIstri,
          tunj_anak: tunjAnak,
          tunj_kepala_sekolah: tunjKepalaSekolah,
          tunj_wali_kelas: tunjWaliKelas,
          honor_bendahara: honorBendahara,
          tunj_kehadiran: tunjKehadiran,
          total_penggajian: totalPenggajian,
          potongan_terlambat: potonganTerlambat,
          potongan_izin: potonganIzin,
          potongan_sakit: potonganSakit,
          potongan_tanpa_keterangan: potonganTanpaKet,
          total_potongan: totalPotongan,
          total_bersih: totalBersih
        },
        absensi: {
          hadir,
          terlambat,
          izin,
          sakit,
          dinas_luar,
          cuti,
          tanpa_keterangan,
          total_hari_kerja: totalWeekdays
        }
      }
    });
  } catch (error) {
    console.error('ADMQU Slip Gaji error:', error);
    res.status(500).json({ success: false, message: 'Error fetching slip gaji: ' + error.message });
  }
});

router.get('/slip-gaji/history', authenticateOperator, async (req, res) => {
  try {
    const teacherId = getTeacherIdFromUser(req.user);
    const tenantId = getTenantIdFromUser(req.user);

    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID tidak ditemukan di token' });
    }

    const history = await db.query(
      'SELECT periode, total_gaji, created_at FROM payroll WHERE teacher_id = ? ORDER BY created_at DESC LIMIT 24',
      [teacherId]
    );

    res.json({
      success: true,
      data: history.map(h => ({
        periode: h.periode,
        total_gaji: h.total_gaji,
        tanggal: h.created_at
      }))
    });
  } catch (error) {
    console.error('ADMQU Slip Gaji History error:', error);
    res.status(500).json({ success: false, message: 'Error fetching slip gaji history: ' + error.message });
  }
});

router.get('/sk-list', authenticateOperator, async (req, res) => {
  try {
    const teacherId = getTeacherIdFromUser(req.user);
    const tenantId = getTenantIdFromUser(req.user);

    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID tidak ditemukan di token' });
    }

    const skList = await db.query(
      'SELECT * FROM sk_guru WHERE teacher_id = ? ORDER BY created_at DESC LIMIT 100',
      [teacherId]
    );

    res.json({ success: true, data: skList });
  } catch (error) {
    console.error('ADMQU SK List error:', error);
    res.status(500).json({ success: false, message: 'Error fetching SK list: ' + error.message });
  }
});

module.exports = router;