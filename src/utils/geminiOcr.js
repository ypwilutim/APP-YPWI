// ============================================================
// GEMINI OCR UTILITY
// Extracts structured KTP (Indonesian ID card) fields from an image
// using the Google Gemini Vision API. API key is read from GEMINI_API_KEY in .env
// ============================================================

const fs = require('fs');
const path = require('path');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const KTP_PROMPT = `Kamu adalah OCR yang sangat teliti untuk KTP Indonesia. Ekstrak semua informasi dari gambar KTP ini dan kembalikan HANYA dalam format JSON yang valid tanpa teks lain, tanpa markdown, tanpa penjelasan.

Struktur JSON yang diharapkan:
{
  "nik": "16 digit angka",
  "nama": "nama lengkap",
  "tempat_lahir": "kota tempat lahir",
  "tanggal_lahir": "YYYY-MM-DD (konversi dari DD-MM-YYYY di KTP)",
  "jenis_kelamin": "Laki-laki" atau "Perempuan",
  "gol_darah": "A/B/AB/O atau kosong jika tidak ada",
  "alamat": "alamat jalan",
  "rt_rw": "000/000",
  "kel_desa": "nama kelurahan/desa",
  "kecamatan": "nama kecamatan",
  "agama": "ISLAM/KRISTEN/KATOLIK/HINDU/BUDDHA/KONGHUCU",
  "status_perkawinan": "BELUM KAWIN/KAWIN/CERAI HIDUP/CERAI MATI",
  "pekerjaan": "pekerjaan",
  "kewarganegaraan": "WNI" atau "WNA",
  "berlaku_hingga": "SEUMUR HIDUP" atau "DD-MM-YYYY",
  "is_ktp": true atau false
}

Aturan:
- NIK harus 16 digit angka, perbaiki jika ada karakter salah (I->1, O->0, l->1).
- Jika field tidak ditemukan, gunakan string kosong "".
- is_ktp bernilai true hanya jika gambar benar-benar KTP Indonesia (mengandung NIK 16 digit dan label "Nama", "Alamat", "Tempat/Tgl Lahir").
- Jangan menebak. Keluarkan JSON murni.`;

const RECEIPT_PROMPT = `Kamu adalah OCR ahli untuk struk belanja/struk pembayaran di Indonesia. Ekstrak informasi dari gambar struk ini dan kembalikan HANYA dalam format JSON berikut (tanpa teks lain, tanpa markdown, tanpa penjelasan):

{
  "tanggal": "YYYY-MM-DD (konversi dari DD/MM/YYYY atau DD-MM-YYYY ke ISO)",
  "keterangan": "nama toko/tempat/merchant",
  "nominal": "angka bulat (tanpa pemisah ribuan, titik, koma, atau karakter Rp)",
  "no_bukti": "nomor bukti/struk/nota jika ada, else kosong",
  "jenis": "beli" atau "bayar" (pilih "beli" jika ini pembelian barang/inventory, "bayar" jika pembayaran layanan/listrik/gaji/dll),
  "kategori": "kategori pengeluaran yang cocok dari daftar: Perlengkapan Sekolah, Buku dan Materi, Peralatan Elektronik, Perlengkapan Kantin, Perlengkapan Taman/Kebun, Kendaraan, Gaji Honor / Servis, Listrik, Air, Telepon, Internet / Langganan, Pajak dan Retribusi, Sewa Tempat, ATK / Kantor, Konsumsi / Catering, Transportasi / Bensin, Lain-lain",
  "akun": "kode rekening/akun jika terlihat di struk (bisa kosong)",
  "is_struk": true
}

  PENTING: Jika tidak yakin, kirimkan nominal=0 dan is_struk=false.`;

const RECEIPT_ITEMS_PROMPT = `Kamu adalah OCR ahli untuk struk belanja Indonesia. Ekstrak DAFTAR BARANG dari gambar struk ini. Kembalikan HANYA JSON array (tanpa teks lain, tanpa markdown):

[
  {"no": 1, "nama_barang": "nama barang", "qty": 1, "harga": 5000, "total": 5000},
  {"no": 2, "nama_barang": "nama barang 2", "qty": 2, "harga": 3000, "total": 6000}
]

Aturan:
- qty dan harga harus angka (tanpa pemisah ribuan, titik, koma, atau Rp)
- total = qty * harga
- Jika hanya ada total (tidak ada qty/harga terpisah), qty=1, harga=total
- Hapus baris pajak/subtotal/discount dari daftar
- Jika tidak ada barang, kirimkan array kosong []`;

function fileToBase64(filePath) {
  const buffer = fs.readFileSync(filePath);
  const mime = mimeFromPath(filePath);
  return {
    inlineData: {
      mimeType: mime,
      data: buffer.toString('base64')
    }
  };
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.bmp': return 'image/bmp';
    default: return 'image/jpeg';
  }
}

function parseGeminiJson(text) {
  let cleaned = text.trim();
  // Remove markdown code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  // Extract first JSON object
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  }
  return JSON.parse(cleaned);
}

async function extractKTPFromImage(filePath) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi di .env');
  }

  const imagePart = fileToBase64(filePath);

  const body = {
    contents: [
      {
        parts: [
          { text: KTP_PROMPT },
          imagePart
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const json = await response.json();
  const candidate = json?.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text || '').join('') || '';

  if (!text) {
    throw new Error('Gemini tidak mengembalikan teks hasil OCR');
  }

  const parsed = parseGeminiJson(text);
  return parsed;
}

async function extractReceiptFromImage(fileBuffer, mimeType = 'image/jpeg') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi di .env');
  }

  const base64 = fileBuffer.toString('base64');

  const body = {
    contents: [
      {
        parts: [
          { text: RECEIPT_PROMPT },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const json = await response.json();
  const candidate = json?.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text || '').join('') || '';

  if (!text) {
    throw new Error('Gemini tidak mengembalikan teks hasil OCR');
  }

  return parseGeminiJson(text);
}

async function extractReceiptItems(fileBuffer, mimeType = 'image/jpeg') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi di .env');
  }

  const base64 = fileBuffer.toString('base64');

  const body = {
    contents: [
      {
        parts: [
          { text: RECEIPT_ITEMS_PROMPT },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const json = await response.json();
  const candidate = json?.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text || '').join('') || '';

  if (!text) {
    throw new Error('Gemini tidak mengembalikan teks hasil OCR');
  }

  // Parse as array instead of single object
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  }
  return JSON.parse(cleaned);
}

module.exports = { extractKTPFromImage, extractReceiptFromImage, extractReceiptItems };
