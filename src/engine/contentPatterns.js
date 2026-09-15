/**
 * Pola indikasi defacement / konten judi online, dipakai bersama oleh:
 * - httpCheck.js (cek cepat, hanya pada halaman utama monitor, tiap siklus)
 * - deepScan.js  (cek lambat/berkala, menjelajah subhalaman situs)
 *
 * Satu sumber kebenaran (single source of truth) agar daftar pola tidak
 * dobel-dikelola di dua tempat dan bisa berbeda tanpa sengaja.
 */

// Tanda tangan khas hacker — sangat spesifik & hampir mustahil muncul di
// konten resmi instansi secara wajar, jadi 1 kecocokan saja sudah cukup.
const HACKER_SIGNATURE_PATTERNS = ['hacked by', 'defaced by', 'pwned by', 'touched by'];

// Jargon spam judi online. BEDA dari signature hacker: kata-kata ini BISA
// muncul wajar di konten legitimate, misalnya artikel berita/edukasi yang
// memperingatkan warga soal judi online ("...terutama yang menyatakan diri
// sebagai 'slot gacor'..."). Karena itu butuh KOROBORASI sebelum di-vonis
// defacement — lihat findDefacementPattern().
const GAMBLING_SPAM_PATTERNS = ['agen slot', 'slot gacor', 'situs slot', 'deposit pulsa tanpa potongan', 'rtp live'];

const DEFACEMENT_PATTERNS = [...HACKER_SIGNATURE_PATTERNS, ...GAMBLING_SPAM_PATTERNS];

// Ambang korobasi untuk jargon judi (lihat komentar GAMBLING_SPAM_PATTERNS di atas):
// halaman spam judi ASLI biasanya menumpuk banyak istilah berbeda sekaligus
// (keyword stuffing demi SEO) atau mengulang istilah yang sama berkali-kali —
// bukan menyebutnya sekali saja dalam satu kalimat seperti artikel edukasi.
const GAMBLING_DISTINCT_THRESHOLD = 2; // minimal N istilah judi BERBEDA muncul bersamaan
const GAMBLING_REPEAT_THRESHOLD = 4;   // ATAU 1 istilah yang sama muncul berulang minimal segini kali

function countOccurrences(bodyLower, pattern) {
  if (!bodyLower.includes(pattern)) return 0;
  return bodyLower.split(pattern).length - 1;
}

/**
 * Ekstrak isi tag <title> dari HTML (case-insensitive, sudah cocok dipakai
 * langsung terhadap bodyLower yang sudah di-lowercase oleh caller).
 * @param {string} bodyLower
 * @returns {string} Isi title, atau string kosong kalau tidak ada tag title.
 */
function extractTitleTag(bodyLower) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(bodyLower);
  return m ? m[1].trim() : '';
}

/**
 * Cari pola defacement di dalam teks body (sudah di-lowercase oleh caller).
 *
 * Logika 3 tingkat untuk mengurangi false positive pada artikel legit yang
 * membahas/memperingatkan soal judi online:
 * 1. Signature hacker ("hacked by", dst.) di body mana pun -> vonis langsung.
 * 2. Jargon judi di tag <title> -> vonis langsung, 1 kecocokan CUKUP. Ini teknik
 *    "title hijacking" — menyuntik title halaman demi SEO poisoning (supaya
 *    muncul di hasil pencarian Google dengan kata kunci judi). Berbeda dari
 *    body: artikel edukasi/berita yang MEMBAHAS judi online tidak akan
 *    memberi judul halamannya sendiri dengan jargon spam judi — kalau ada,
 *    itu sinyal yang jauh lebih tegas dibanding sekadar disebut di isi teks.
 * 3. Jargon judi di BODY (di luar title) -> butuh korobasi (>=2 istilah
 *    berbeda, atau 1 istilah diulang >=4 kali) sebelum divonis.
 *
 * @param {string} bodyLower - Body halaman, sudah dalam huruf kecil.
 * @returns {string|null} Pola (atau daftar pola) yang cocok, atau null jika bersih/tidak cukup bukti.
 */
function findDefacementPattern(bodyLower) {
  for (const p of HACKER_SIGNATURE_PATTERNS) {
    if (bodyLower.includes(p)) return p;
  }

  const titleLower = extractTitleTag(bodyLower);
  if (titleLower) {
    for (const p of GAMBLING_SPAM_PATTERNS) {
      if (titleLower.includes(p)) return `${p} (di tag <title>)`;
    }
  }

  const matchedDistinct = [];
  let maxRepeatCount = 0;
  let maxRepeatPattern = null;

  for (const p of GAMBLING_SPAM_PATTERNS) {
    const count = countOccurrences(bodyLower, p);
    if (count > 0) {
      matchedDistinct.push(p);
      if (count > maxRepeatCount) {
        maxRepeatCount = count;
        maxRepeatPattern = p;
      }
    }
  }

  if (matchedDistinct.length >= GAMBLING_DISTINCT_THRESHOLD) {
    return matchedDistinct.join(', ');
  }
  if (maxRepeatCount >= GAMBLING_REPEAT_THRESHOLD) {
    return maxRepeatPattern;
  }

  return null;
}

module.exports = {
  DEFACEMENT_PATTERNS,
  HACKER_SIGNATURE_PATTERNS,
  GAMBLING_SPAM_PATTERNS,
  findDefacementPattern,
  extractTitleTag,
};
