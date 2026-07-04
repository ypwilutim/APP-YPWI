import fetch from 'node-fetch';

const data = {
  to: '6281234567890',
  nama_siswa: 'Test Siswa',
  bulan: 'Juli 2024',
  jumlah: 100000,
  tanggal_jatuh_tempo: '10 Juli 2024',
  nama_penerima: 'Test Penerima',
  nomor_rekening: '1234567890'
};

const res = await fetch('http://localhost:3000/api/notifications/whatsapp/bill-template', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
});

const result = await res.json();
console.log(result);