/**
 * [FEAT] Analisis Security Header Score.
 *
 * Mengecek keberadaan header HTTP yang berfungsi sebagai lapisan pertahanan
 * di sisi browser (mirip securityheaders.com / Mozilla Observatory).
 * BUKAN request terpisah — dianalisis dari response yang SUDAH diambil
 * httpCheck.js tiap siklus cek uptime, supaya tidak menambah beban ke
 * server target.
 */
const SECURITY_HEADERS_CHECKLIST = [
  {
    key: 'strict-transport-security',
    label: 'Strict-Transport-Security (HSTS)',
    weight: 20,
    desc: 'Memaksa browser selalu pakai HTTPS, mencegah SSL stripping.',
  },
  {
    key: 'content-security-policy',
    label: 'Content-Security-Policy (CSP)',
    weight: 25,
    desc: 'Membatasi script/resource yang boleh dijalankan, pertahanan utama terhadap dampak XSS.',
  },
  {
    key: 'x-frame-options',
    label: 'X-Frame-Options',
    weight: 15,
    desc: 'Mencegah situs disisipkan di <iframe> situs lain (anti-clickjacking).',
  },
  {
    key: 'x-content-type-options',
    label: 'X-Content-Type-Options',
    weight: 15,
    desc: 'Mencegah browser menebak jenis file dari isinya (anti MIME-sniffing).',
  },
  {
    key: 'referrer-policy',
    label: 'Referrer-Policy',
    weight: 15,
    desc: 'Membatasi informasi URL yang bocor ke situs lain saat pengunjung klik link keluar.',
  },
  {
    key: 'permissions-policy',
    label: 'Permissions-Policy',
    weight: 10,
    desc: 'Membatasi fitur browser (kamera, lokasi, dst.) yang boleh dipakai halaman.',
  },
];

const TOTAL_WEIGHT = SECURITY_HEADERS_CHECKLIST.reduce((sum, h) => sum + h.weight, 0); // = 100

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 50) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

/**
 * @param {object} responseHeaders - Object header dari Node http/https
 *   response (`res.headers`) — key-nya sudah otomatis lowercase oleh Node.
 * @returns {{score: number, grade: string, present: string[], missing: string[]}}
 */
function analyzeSecurityHeaders(responseHeaders) {
  const present = [];
  const missing = [];
  let score = 0;

  for (const item of SECURITY_HEADERS_CHECKLIST) {
    if (responseHeaders && responseHeaders[item.key]) {
      score += item.weight;
      present.push(item.label);
    } else {
      missing.push(item.label);
    }
  }

  return {
    score: Math.round((score / TOTAL_WEIGHT) * 100),
    grade: scoreToGrade(score),
    present,
    missing,
  };
}

module.exports = { analyzeSecurityHeaders, SECURITY_HEADERS_CHECKLIST };
