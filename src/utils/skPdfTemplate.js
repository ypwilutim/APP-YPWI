const fs = require('fs');
const path = require('path');

const imagesDir = path.join(__dirname, '../../SKTEMPLATE/images');

const imageFiles = {
  kop: 'image2.jpg',
  bismillah: 'image1.png',
  stempel: 'image4.png',
  ttd: 'image3.png'
};

let cachedImages = null;

function loadImagesBase64() {
  if (cachedImages) return cachedImages;
  const result = {};
  for (const [key, filename] of Object.entries(imageFiles)) {
    const filepath = path.join(imagesDir, filename);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeType = ext === 'jpg' ? 'jpeg' : ext;
    const buffer = fs.readFileSync(filepath);
    result[key] = `data:image/${mimeType};base64,${buffer.toString('base64')}`;
  }
  cachedImages = result;
  return result;
}

// Folio / F4 (215mm x 330mm dalam pt)
const F4_WIDTH_PT = 609.45;
const F4_HEIGHT_PT = 935.43;

// Margin diperketat optimal (Atas 12pt, Bawah 12pt, Kiri/Kanan 35pt)
const MARGIN_LEFT = 35.0;
const MARGIN_RIGHT = 35.0;
const MARGIN_TOP = 12.0;
const MARGIN_BOTTOM = 12.0;

const CONTENT_WIDTH = F4_WIDTH_PT - MARGIN_LEFT - MARGIN_RIGHT;

const BASE_FONT_SIZE = 9;
const TITLE_FONT_SIZE = 9.5;

function replacePlaceholders(obj, data) {
  if (typeof obj === 'string') {
    let str = obj;
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `<<${key}>>`;
      str = str.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value || '');
    }
    return str;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => replacePlaceholders(item, data));
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replacePlaceholders(value, data);
    }
    return result;
  }
  return obj;
}

function buildDocDefinition(data) {
  const imagesBase64 = loadImagesBase64();

  const placeholderData = {
    'NO SURAT': data.noSurat,
    'TENTANG': data.tentang,
    'NAMA': data.nama,
    'TTL': data.ttl,
    'TMT': data.tmtFormatted,
    'PT': data.ptFormatted,
    'NIY': data.niy,
    'UNIT': data.unit,
    'JABATAN': data.jabatan,
    'TGL_MULAI': data.tglMulai,
    'STATUS': data.status,
    'TGL_SELESAI': data.tglSelesai,
    'BH': data.bhFormatted,
    'BM': data.bmFormatted,
    'PERIODE': data.periode
  };

  const content = [
    // 1. KOP SURAT
    {
      image: imagesBase64.kop,
      width: CONTENT_WIDTH,
      alignment: 'center',
      margin: [0, 0, 0, 1]
    },
    // 2. BISMILLAH
    {
      image: imagesBase64.bismillah,
      width: 95,
      alignment: 'center',
      margin: [0, 0, 0, 1]
    },
    // 3. JUDUL SURAT
    { text: 'SURAT KEPUTUSAN', style: 'c8Center' },
    { text: 'KETUA YAYASAN PESANTREN WAHDAH ISLAMIYAH LUWU TIMUR', style: 'c8Center' },
    {
      text: [
        { text: 'Nomor : ', style: 'c15' },
        { text: '<<NO SURAT>>', style: 'c26' }
      ],
      style: 'c6'
    },
    { text: 'TENTANG', style: 'c8Center', margin: [0, 1, 0, 0] },
    { text: '<<TENTANG>>', style: 'c26Center' },

    // 4. PREAMBUL
    {
      text: 'KETUA YAYASAN PESANTREN WAHDAH ISLAMIYAH LUWU TIMUR SETELAH,',
      style: 'c15',
      margin: [0, 2, 0, 1]
    },

    // 5. TABEL KONSIDERAN
    {
      table: {
        widths: [85, 10, 15, '*'],
        body: [
          // Menimbang a
          [
            { text: 'Menimbang', style: 'c8' },
            { text: ':', style: 'normal' },
            { text: 'a.', style: 'normal' },
            {
              text: [
                { text: 'Bahwa untuk efektivitas dan keberhasilan penyelenggaraan pendidikan di ', style: 'c19' },
                { text: '<<UNIT>>', style: 'c19Bold' },
                { text: ', perlu menetapkan kembali jabatan ', style: 'c19' },
                { text: '<<JABATAN>>', style: 'c19Bold' },
                { text: ' sesuai dengan kompetensinya.', style: 'c19' }
              ]
            }
          ],
          // Menimbang b
          [
            { text: '', style: 'normal' },
            { text: '', style: 'normal' },
            { text: 'b.', style: 'normal' },
            {
              text: [
                { text: 'Bahwa Saudara/i ', style: 'c19' },
                { text: '<<NAMA>>', style: 'c19Bold' },
                { text: ' dipandang layak, cakap dan memenuhi syarat untuk menetapkan kembali sebagai ', style: 'c19' },
                { text: '<<JABATAN>>', style: 'c19Bold' },
                { text: ' di ', style: 'c19' },
                { text: '<<UNIT>>', style: 'c19Bold' },
                { text: '.', style: 'c19' }
              ]
            }
          ],
          // Mengingat 1
          [
            { text: 'Mengingat', style: 'c8' },
            { text: ':', style: 'normal' },
            { text: '1.', style: 'normal' },
            { text: 'Firman Allah dalam Al-Qur’an Al-Mujadilah (58) ayat 11.', style: 'c19' }
          ],
          // Mengingat 2
          [
            { text: '', style: 'normal' },
            { text: '', style: 'normal' },
            { text: '2.', style: 'normal' },
            { text: 'Undang-Undang No. 20 tahun 2003 tentang Sistem Pendidikan Nasional.', style: 'c19' }
          ],
          // Mengingat 3
          [
            { text: '', style: 'normal' },
            { text: '', style: 'normal' },
            { text: '3.', style: 'normal' },
            { text: 'Undang-Undang No. 14 tahun 2005 tentang Sertifikasi Guru dan Dosen.', style: 'c19' }
          ],
          // Mengingat 4
          [
            { text: '', style: 'normal' },
            { text: '', style: 'normal' },
            { text: '4.', style: 'normal' },
            { text: 'Peraturan Menteri Pendidikan dan Kebudayaan No. 23 tahun 2013 tentang perubahan atas Peraturan Menteri Pendidikan Nasional No. 15 tahun 2010 tentang Standar Pelayanan Minimal Pendidikan Dasar di Kabupaten/Kota.', style: 'c19' }
          ],
          // Memperhatikan 1
          [
            { text: 'Memperhatikan', style: 'c15' },
            { text: ':', style: 'normal' },
            { text: '1.', style: 'normal' },
            { text: 'Anggaran Dasar dan Anggaran Rumah Tangga Yayasan Pesantren Wahdah Islamiyah Luwu Timur.', style: 'c19' }
          ],
          // Memperhatikan 2
          [
            { text: '', style: 'normal' },
            { text: '', style: 'normal' },
            { text: '2.', style: 'normal' },
            { text: 'Hasil Musyawarah Pengurus YPWI Luwu Timur.', style: 'c19' }
          ],
          // MEMUTUSKAN
          [
            { colSpan: 4, text: 'M E M U T U S K A N', style: 'c8Center', margin: [0, 1, 0, 1] },
            {}, {}, {}
          ],
          // Menetapkan
          [
            { text: 'Menetapkan', style: 'c15' },
            { text: ':', style: 'normal' },
            { colSpan: 2, text: '' },
            {}
          ],
          // PERTAMA
          [
            { text: 'PERTAMA', style: 'c13' },
            { text: ':', style: 'normal' },
            {
              colSpan: 2,
              text: [
                { text: 'Terhitung mulai tanggal ', style: 'c19' },
                { text: '<<TGL_MULAI>>', style: 'c19Bold' },
                { text: ' mengangkat yang bersangkutan sebagai ', style: 'c19' },
                { text: '<<JABATAN>>', style: 'c19Bold' },
                { text: ' ', style: 'c19' },
                { text: '<<UNIT>>', style: 'c19' },
                { text: ' selama periode ', style: 'c19' },
                { text: '<<PERIODE>>', style: 'c19' },
                { text: ' sampai dengan tanggal ', style: 'c19' },
                { text: '<<TGL_SELESAI>>', style: 'c19Bold' }
              ]
            },
            {}
          ]
        ]
      },
      layout: {
        defaultBorder: false,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0
      }
    },

    // 6. TABEL BIODATA
    {
      table: {
        widths: [110, 10, '*'],
        body: [
          [{ text: 'Nama', style: 'normal' }, { text: ':', style: 'normal' }, { text: '<<NAMA>>', style: 'bold' }],
          [{ text: 'Tempat/tanggal lahir', style: 'normal' }, { text: ':', style: 'normal' }, { text: '<<TTL>>', style: 'normal' }],
          [{ text: 'Tahun Mulai Tugas', style: 'normal' }, { text: ':', style: 'normal' }, { text: '<<TMT>>', style: 'normal' }],
          [{ text: 'Pendidikan Terakhir', style: 'normal' }, { text: ':', style: 'normal' }, { text: '<<PT>>', style: 'normal' }],
          [{ text: 'Status Kepegawaian', style: 'normal' }, { text: ':', style: 'normal' }, { text: '<<STATUS>>', style: 'normal' }],
          [{ text: 'NIY', style: 'normal' }, { text: ':', style: 'normal' }, { text: '<<NIY>>', style: 'normal' }],
          [{ text: 'Unit Kerja', style: 'normal' }, { text: ':', style: 'normal' }, { text: '<<UNIT>>', style: 'normal' }]
        ]
      },
      layout: {
        defaultBorder: false,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0
      },
      margin: [110, 0.5, 0, 0]
    },

    // 7. DIKTUM KEDUA & KETIGA
    {
      table: {
        widths: [85, 10, '*'],
        body: [
          [
            { text: 'KEDUA', style: 'c13' },
            { text: ':', style: 'normal' },
            { text: 'Apabila dikemudian hari ternyata terdapat kekeliruan dalam keputusan ini akan diadakan perbaikan dan diperhitungkan kembali sebagaimana mestinya.', style: 'c19' }
          ],
          [
            { text: 'KETIGA', style: 'c13' },
            { text: ':', style: 'normal' },
            {
              text: [
                { text: 'Asli ', style: 'c19Bold' },
                { text: 'Keputusan ini diberikan kepada yang bersangkutan dan yang berkepentingan untuk digunakan sebagaimana mestinya.', style: 'c19' }
              ]
            }
          ]
        ]
      },
      layout: {
        defaultBorder: false,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0
      },
      margin: [0, 0.5, 0, 0]
    },

    // 8. BLOK TANDA TANGAN & STEMPEL
    {
      columns: [
        { width: '*', text: '' },
        {
          width: 210,
          stack: [
            {
              table: {
                widths: [65, 10, '*'],
                body: [
                  [
                    { text: 'Ditetapkan di', style: 'normalLeft' },
                    { text: ':', style: 'normal' },
                    { text: 'Luwu Timur', style: 'normalLeft' }
                  ],
                  [
                    { text: 'Pada tanggal', style: 'normalLeft' },
                    { text: ':', style: 'normal' },
                    {
                      text: [
                        { text: '<<BH>>\n', style: 'underlineNormalLeft' },
                        { text: '<<BM>>', style: 'normalLeft' }
                      ]
                    }
                  ]
                ]
              },
              layout: {
                defaultBorder: false,
                paddingLeft: () => 0,
                paddingRight: () => 0,
                paddingTop: () => 0,
                paddingBottom: () => 0
              }
            },
            { text: 'Yayasan Pesantren Wahdah Islamiyah', style: 'c0Center', margin: [0, 1, 0, 0] },
            { text: 'Luwu Timur', style: 'c0Center' },
            { text: 'Ketua', style: 'c0Center' },

            // Area gambar TTD & Stempel
            {
              columns: [
                {
                  image: imagesBase64.stempel,
                  width: 120,
                  margin: [-15, 6, 0, 0]
                },
                {
                  image: imagesBase64.ttd,
                  width: 95,
                  margin: [-50, 14, 0, 0]
                }
              ],
              margin: [0, 0, 0, 0]
            },
            {
              text: 'Usman, S.Pd.I,. Gr.',
              style: 'c37Center',
              margin: [0, -18, 0, 0]
            },
            {
              text: 'NIY.3112198706201402006',
              style: 'c0Center'
            }
          ]
        }
      ],
      margin: [0, 2, 0, 0]
    },

    // 9. TEMBUSAN
    {
      text: 'Tembusan Keputusan ini disampaikan kepada :',
      style: 'tembusanLabel',
      margin: [0, 1, 0, 0]
    },
    {
      ol: [
        { text: 'Pembina YPWI Luwu Timur', style: 'tembusanItem' },
        { text: 'Pengawas YPWI Luwu Timur', style: 'tembusanItem' },
        { text: 'Arsip,-', style: 'tembusanItem' }
      ],
      margin: [15, 0, 0, 0]
    }
  ];

  return replacePlaceholders({
    pageSize: { width: F4_WIDTH_PT, height: F4_HEIGHT_PT },
    pageMargins: [MARGIN_LEFT, MARGIN_TOP, MARGIN_RIGHT, MARGIN_BOTTOM],
    defaultStyle: {
      font: 'NotoSerif',
      fontSize: BASE_FONT_SIZE,
      lineHeight: 1.05
    },
    styles: {
      c6: { alignment: 'center', lineHeight: 1.0 },
      c8: { fontSize: TITLE_FONT_SIZE, bold: true, lineHeight: 1.0 },
      c8Center: { fontSize: TITLE_FONT_SIZE, bold: true, alignment: 'center', lineHeight: 1.0 },
      c13: { fontSize: BASE_FONT_SIZE, lineHeight: 1.05 },
      c15: { fontSize: BASE_FONT_SIZE, bold: true, lineHeight: 1.0 },
      c19: { fontSize: BASE_FONT_SIZE, alignment: 'justify', lineHeight: 1.05 },
      c19Bold: { fontSize: BASE_FONT_SIZE, bold: true, alignment: 'justify', lineHeight: 1.05 },
      c26: { fontSize: BASE_FONT_SIZE, bold: true, lineHeight: 1.0 },
      c26Center: { fontSize: BASE_FONT_SIZE, bold: true, alignment: 'center', lineHeight: 1.0 },
      c37Center: { fontSize: TITLE_FONT_SIZE, bold: true, decoration: 'underline', alignment: 'center', lineHeight: 1.0 },
      c0Center: { fontSize: TITLE_FONT_SIZE, alignment: 'center', lineHeight: 1.05 },
      normal: { fontSize: BASE_FONT_SIZE, lineHeight: 1.05 },
      bold: { fontSize: BASE_FONT_SIZE, bold: true, lineHeight: 1.05 },
      normalLeft: { fontSize: BASE_FONT_SIZE, alignment: 'left', lineHeight: 1.05 },
      underlineNormalLeft: { fontSize: BASE_FONT_SIZE, decoration: 'underline', alignment: 'left', lineHeight: 1.05 },
      tembusanLabel: { fontSize: 8, lineHeight: 1.0 },
      tembusanItem: { fontSize: 8, lineHeight: 1.0 }
    },
    content: content
  }, placeholderData);
}

module.exports = { buildDocDefinition, loadImagesBase64 };