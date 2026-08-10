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

module.exports = { extractKTPFromImage };
