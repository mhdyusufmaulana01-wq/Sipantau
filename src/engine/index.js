const checkDns = require('./dnsCheck');
const checkTcp = require('./tcpCheck');
const checkHttp = require('./httpCheck');
const checkSsl = require('./sslCheck');
const { URL } = require('url');

/**
 * Orchestrates a single run of all checks sequentially.
 * Fails early if a stage fails.
 * 
 * @param {string} targetUrl - URL yang akan dicek
 * @param {object} [monitorOptions={}] - Konfigurasi dari monitor
 * @param {number} [monitorOptions.timeoutMs=5000]
 * @param {string} [monitorOptions.httpMethod='GET']
 * @param {boolean} [monitorOptions.ignoreSsl=false]
 * @param {string} [monitorOptions.acceptedStatusCodes='200-299']
 */
async function runSingleCheck(targetUrl, monitorOptions = {}) {
  const {
    timeoutMs = 5000,
    httpMethod = 'GET',
    ignoreSsl = false,
    acceptedStatusCodes = '200-299',
  } = monitorOptions;

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    return { status: 'DOWN', root_cause: 'INVALID_URL', detail_message: 'URL yang diberikan tidak valid' };
  }

  const hostname = parsedUrl.hostname;
  const isHttps = parsedUrl.protocol === 'https:';
  const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (isHttps ? 443 : 80);

  const result = {
    status: 'UP',
    root_cause: 'NONE',
    dns_ok: false,
    tcp_ok: false,
    http_status_code: null,
    response_time_ms: null,
    ssl_valid: null,
    ssl_expiry_date: null,
    security_header_score: null,
    security_headers_missing: null,
  };

  // ===== TAHAP 1: DNS CHECK =====
  const dnsRes = await checkDns(hostname, timeoutMs);
  if (!dnsRes.success) {
    return { ...result, status: 'DOWN', root_cause: dnsRes.root_cause, detail_message: dnsRes.detail_message };
  }
  result.dns_ok = true;

  // ===== TAHAP 2: TCP CHECK =====
  const tcpRes = await checkTcp(hostname, port, timeoutMs);
  if (!tcpRes.success) {
    return { ...result, status: 'DOWN', root_cause: tcpRes.root_cause, detail_message: tcpRes.detail_message };
  }
  result.tcp_ok = true;

  // ===== TAHAP 3: HTTP CHECK =====
  // Teruskan semua opsi konfigurasi monitor ke HTTP check
  const httpRes = await checkHttp(targetUrl, {
    timeoutMs,
    httpMethod,
    ignoreSsl,
    acceptedStatusCodes,
    expectedKeyword: monitorOptions.expected_keyword,
    checkDefacement: monitorOptions.check_defacement !== 0,
  });
  result.http_status_code = httpRes.http_status_code || null;
  result.response_time_ms = httpRes.response_time_ms || null;
  // [FEAT] Security Header Score — null kalau tidak ada response sama sekali
  // (DNS/TCP/timeout gagal duluan sebelum sempat terima header apapun).
  result.security_header_score = httpRes.security_header_score ?? null;
  result.security_headers_missing = httpRes.security_headers_missing || null;

  if (!httpRes.success) {
    return { ...result, status: 'DOWN', root_cause: httpRes.root_cause, detail_message: httpRes.detail_message };
  }

  // ===== TAHAP 4: SSL CHECK (khusus HTTPS) =====
  if (isHttps && !ignoreSsl) {
    // Hanya lakukan SSL check jika ignore_ssl TIDAK diaktifkan
    const sslRes = await checkSsl(hostname, port, timeoutMs);
    result.ssl_valid = sslRes.ssl_valid || false;
    result.ssl_expiry_date = sslRes.ssl_expiry_date || null;

    if (!sslRes.success) {
      if (sslRes.root_cause === 'SSL_CERT_EXPIRED') {
        // [BUG FIX] Sertifikat SUDAH kedaluwarsa beneran -> ini masalah serius
        // yang benar-benar memblokir pengunjung (browser menampilkan halaman
        // peringatan merah), bukan sekadar gangguan pengecekan. Vonis DOWN,
        // root_cause dipertahankan SSL_CERT_EXPIRED (bukan digeneralisir jadi
        // SSL_ERROR) agar kamus/notifikasi darurat yang sesuai ikut terpicu.
        return { ...result, status: 'DOWN', root_cause: sslRes.root_cause, detail_message: sslRes.detail_message };
      }
      // SSL_ERROR (misconfig/self-signed) atau SSL_TIMEOUT (gangguan
      // pengecekan) dicatat sebagai warning saja, status tetap UP -- root_cause
      // ASLI-nya dipertahankan (bukan digeneralisir) agar detail tetap akurat.
      result.root_cause = sslRes.root_cause;
      result.detail_message = sslRes.detail_message;
    }
  } else if (isHttps && ignoreSsl) {
    // ignore_ssl aktif, skip SSL check
    result.ssl_valid = null;
  }

  return result;
}

/**
 * Checks a website with retry logic for false-positive prevention.
 * @param {object} monitor - Data monitor dari database
 */
async function checkWebsite(monitor) {
  const {
    url,
    timeout_ms = 5000,
    retry_count = 3,
    retry_delay_ms = 2000,
    http_method = 'GET',
    ignore_ssl = 0,
    accepted_status_codes = '200-299',
    expected_keyword = '',
    check_defacement = 1,
  } = monitor;

  // Bundel semua opsi menjadi satu objek
  const monitorOptions = {
    timeoutMs: timeout_ms,
    httpMethod: http_method,
    ignoreSsl: ignore_ssl === 1 || ignore_ssl === true,
    acceptedStatusCodes: accepted_status_codes,
    expected_keyword,
    check_defacement,
  };

  let lastResult = null;

  for (let attempt = 1; attempt <= retry_count + 1; attempt++) {
    lastResult = await runSingleCheck(url, monitorOptions);

    // Jika UP (termasuk dengan SSL warning), langsung kembalikan hasil
    if (lastResult.status === 'UP') {
      return lastResult;
    }

    // Jika DOWN dan masih ada sisa retry, tunggu lalu coba lagi
    if (attempt <= retry_count) {
      console.log(`[Engine] ${monitor.name}: DOWN (percobaan ${attempt}/${retry_count + 1}), retry dalam ${retry_delay_ms}ms...`);
      await new Promise((res) => setTimeout(res, retry_delay_ms));
    }
  }

  // Kembalikan hasil percobaan terakhir yang gagal
  return lastResult;
}

module.exports = { runSingleCheck, checkWebsite };
