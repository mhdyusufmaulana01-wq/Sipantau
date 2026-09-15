const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const { pipeline } = require('stream');
const { findDefacementPattern } = require('./contentPatterns');
const { analyzeSecurityHeaders } = require('./securityHeaders');

/**
 * Parse accepted_status_codes string menjadi fungsi validator.
 * Format: "200-299" atau "200-299, 401, 403" atau "200, 301-302"
 * @param {string} acceptedStr
 * @returns {(code: number) => boolean}
 */
function buildStatusValidator(acceptedStr) {
  if (!acceptedStr) return (code) => code >= 200 && code < 300;

  const rules = acceptedStr.split(',').map((s) => s.trim());
  return (code) => {
    return rules.some((rule) => {
      if (rule.includes('-')) {
        const [min, max] = rule.split('-').map(Number);
        return code >= min && code <= max;
      }
      return code === Number(rule);
    });
  };
}

/**
 * Perform HTTP/HTTPS request check, handling redirects.
 *
 * Catatan implementasi (penting untuk maintainer berikutnya):
 * - Body response didekompresi secara STREAMING (bukan dikumpulkan lalu didekompresi belakangan).
 *   Ini WAJIB, karena kalau body dipotong di 256KB dulu baru didekompresi, potongan gzip/brotli
 *   yang terpotong itu tidak valid dan gunzip/brotli akan gagal — menghasilkan false KEYWORD_MISSING
 *   atau gagal mendeteksi DEFACEMENT_DETECTED pada halaman besar. Jangan diubah ke pendekatan
 *   "collect all lalu decompress" tanpa memahami masalah ini lagi.
 * - Batas 256KB (MAX_CAPTURE_BYTES) adalah keterbatasan yang disengaja demi performa & memori.
 *   Keyword/pola defacement yang letaknya melewati 256KB pertama halaman (setelah decompress)
 *   TIDAK akan terdeteksi. Ini known limitation, bukan bug — dampaknya kecil karena keyword/CMS
 *   marker biasanya ada di awal halaman (<title>, <meta>, konten awal <body>).
 * - Kalau decode gagal (stream corrupt), sistem SENGAJA tidak menjatuhkan vonis KEYWORD_MISSING
 *   atau DEFACEMENT_DETECTED — konten yang tidak bisa dianalisis dianggap "tidak diperiksa",
 *   bukan otomatis dianggap bermasalah. Vonis DOWN untuk kasus itu tetap bisa terjadi lewat
 *   jalur lain (misal HTTP_4XX/5XX) jika memang statusnya bukan sukses.
 *
 * @param {string} urlString - URL yang akan dicek
 * @param {object} options - Opsi tambahan dari konfigurasi monitor
 * @param {number} [options.timeoutMs=5000]
 * @param {string} [options.httpMethod='GET']
 * @param {boolean} [options.ignoreSsl=false]
 * @param {string} [options.acceptedStatusCodes='200-299']
 * @param {string} [options.expectedKeyword='']
 * @param {boolean} [options.checkDefacement=true]
 * @param {number} [redirects=0]
 * @param {number} [maxRedirects=5]
 */
async function checkHttp(urlString, options = {}, redirects = 0, maxRedirects = 5) {
  const {
    timeoutMs = 5000,
    httpMethod = 'GET',
    ignoreSsl = false,
    acceptedStatusCodes = '200-299',
    expectedKeyword = '',
    checkDefacement = true,
  } = options;

  const isAccepted = buildStatusValidator(acceptedStatusCodes);

  return new Promise((resolve) => {
    let resolved = false;
    const startTime = Date.now();

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (e) {
      return finish({ success: false, root_cause: 'INVALID_URL', detail_message: 'Format URL tidak valid' });
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions = {
      method: httpMethod,
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'SiPantauMonitor/1.0', // Custom User-Agent untuk mengurangi WAF block
      },
    };

    // Jika ignore_ssl diaktifkan, abaikan validasi sertifikat SSL
    if (isHttps && ignoreSsl) {
      requestOptions.rejectUnauthorized = false;
    }

    const req = client.request(urlString, requestOptions, (res) => {
      const responseTimeMs = Date.now() - startTime;
      const statusCode = res.statusCode;
      const contentEncoding = (res.headers['content-encoding'] || '').toLowerCase();

      // [FEAT] Security Header Score — dianalisis dari response yang SUDAH
      // diambil di sini, BUKAN request terpisah, supaya tidak menambah beban
      // ke server target. Disertakan di semua jalur finish() di bawah.
      const secHeaders = analyzeSecurityHeaders(res.headers);
      const secHeaderFields = {
        security_header_score: secHeaders.score,
        security_headers_missing: secHeaders.missing,
      };

      // Pilih decoder sesuai Content-Encoding. Jika tidak ada encoding, sourceStream = res langsung.
      let decoder = null;
      if (contentEncoding.includes('br')) {
        decoder = zlib.createBrotliDecompress();
      } else if (contentEncoding.includes('gzip')) {
        decoder = zlib.createGunzip();
      } else if (contentEncoding.includes('deflate')) {
        decoder = zlib.createInflate();
      }

      // Gunakan stream.pipeline (bukan res.pipe() manual) supaya:
      // 1) error di stream manapun (res ATAU decoder) ikut ditangkap & diteruskan,
      // 2) semua stream otomatis di-cleanup/destroy kalau salah satunya berhenti/di-destroy.
      let sourceStream;
      if (decoder) {
        sourceStream = pipeline(res, decoder, () => {
          // no-op: penanganan sukses/gagal sepenuhnya lewat event 'data'/'end'/'error' di bawah,
          // callback ini cuma dibutuhkan agar pipeline() tidak melempar "callback required".
        });
      } else {
        sourceStream = res;
      }

      const bodyChunks = [];
      let totalBytes = 0;
      const MAX_CAPTURE_BYTES = 256 * 1024; // 256 KB batas aman memori (lihat catatan di JSDoc)

      /**
       * Lanjutkan ke evaluasi status code & (jika perlu) analisis konten.
       * Dipanggil dari 3 kemungkinan jalur: cap tercapai, stream 'end', atau stream 'error'.
       * @param {boolean} decodeFailed - true jika body tidak bisa/tidak sempat dianalisis
       */
      const proceedWithBody = (decodeFailed) => {
        if (isAccepted(statusCode)) {
          const bodyText = decodeFailed ? '' : Buffer.concat(bodyChunks).toString('utf-8');
          const bodyLower = bodyText.toLowerCase();

          if (!decodeFailed) {
            // [FEAT] Cek Indikasi Defacement / Konten Judi Online
            if (checkDefacement) {
              const matchedPattern = findDefacementPattern(bodyLower);
              if (matchedPattern) {
                return finish({
                  success: false,
                  root_cause: 'DEFACEMENT_DETECTED',
                  detail_message: `Terdeteksi indikasi defacement/judi online ("${matchedPattern}") pada konten website!`,
                  http_status_code: statusCode,
                  response_time_ms: responseTimeMs,
                  ...secHeaderFields,
                });
              }
            }

            // [FEAT] Cek Kata Kunci Wajib (Keyword Monitoring)
            if (expectedKeyword && expectedKeyword.trim().length > 0) {
              const kw = expectedKeyword.trim().toLowerCase();
              if (!bodyLower.includes(kw)) {
                return finish({
                  success: false,
                  root_cause: 'KEYWORD_MISSING',
                  detail_message: `Kata kunci wajib "${expectedKeyword.trim()}" tidak ditemukan di halaman website`,
                  http_status_code: statusCode,
                  response_time_ms: responseTimeMs,
                  ...secHeaderFields,
                });
              }
            }
          }
          // decodeFailed true (konten tak bisa dianalisis) ATAU lolos semua cek konten -> anggap UP
          return finish({ success: true, http_status_code: statusCode, response_time_ms: responseTimeMs, ...secHeaderFields });
        } else if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          // Handle redirect
          if (redirects >= maxRedirects) {
            return finish({
              success: false,
              root_cause: 'TOO_MANY_REDIRECTS',
              detail_message: 'Melebihi jumlah redirect maksimum',
              http_status_code: statusCode,
              response_time_ms: responseTimeMs,
              ...secHeaderFields,
            });
          }
          const redirectUrl = new URL(res.headers.location, urlString).href;
          // Teruskan options yang sama ke redirect berikutnya
          checkHttp(redirectUrl, options, redirects + 1, maxRedirects).then(finish);
          return;
        } else if (statusCode >= 400 && statusCode < 500) {
          return finish({
            success: false,
            root_cause: 'HTTP_4XX',
            detail_message: `HTTP ${statusCode}`,
            http_status_code: statusCode,
            response_time_ms: responseTimeMs,
            ...secHeaderFields,
          });
        } else if (statusCode >= 500 && statusCode < 600) {
          return finish({
            success: false,
            root_cause: 'HTTP_5XX',
            detail_message: `HTTP ${statusCode}`,
            http_status_code: statusCode,
            response_time_ms: responseTimeMs,
            ...secHeaderFields,
          });
        } else {
          return finish({
            success: false,
            root_cause: 'UNKNOWN_ERROR',
            detail_message: `Status HTTP tidak terduga: ${statusCode}`,
            http_status_code: statusCode,
            response_time_ms: responseTimeMs,
            ...secHeaderFields,
          });
        }
      };

      sourceStream.on('data', (chunk) => {
        if (totalBytes >= MAX_CAPTURE_BYTES) return; // sudah cukup, abaikan sisa chunk

        bodyChunks.push(chunk);
        totalBytes += chunk.length;

        if (totalBytes >= MAX_CAPTURE_BYTES) {
          // [FIX celah #1] Sudah dapat cukup data (256KB hasil decompress) — hentikan stream
          // supaya tidak terus mengunduh & mendekompresi sisa response yang tidak akan dipakai.
          // Ini juga mencegah resource-exhaustion kalau response ternyata "compression bomb".
          sourceStream.destroy();
          proceedWithBody(false); // false = bukan kegagalan decode, cuma dihentikan lebih awal
        }
      });

      sourceStream.on('error', () => {
        // [FIX celah #2] JANGAN cuma set flag lalu menunggu 'end' — stream yang error
        // umumnya TIDAK akan lanjut mengeluarkan event 'end', jadi finish() harus dipanggil
        // langsung dari sini. Kalau tidak, promise ini menggantung sampai socket timeout.
        proceedWithBody(true); // true = decode gagal, skip keyword/defacement check
      });

      sourceStream.on('end', () => {
        proceedWithBody(false);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      finish({ success: false, root_cause: 'TIMEOUT', detail_message: 'HTTP request timeout' });
    });

    req.on('error', (err) => {
      if (!resolved) {
        finish({ success: false, root_cause: 'HTTP_ERROR', detail_message: err.message });
      }
    });

    req.end();
  });
}

module.exports = checkHttp;
