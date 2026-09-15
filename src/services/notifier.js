const https = require('https');
const http = require('http');
const { URL } = require('url');
const { db } = require('../db/client');

/**
 * Kamus saran tindakan berdasarkan kode akar masalah.
 * Ditampilkan di notifikasi Telegram agar operator langsung tahu harus menghubungi siapa.
 */
const ROOT_CAUSE_HINTS = {
  DNS_FAILED:               'Domain tidak ditemukan. Cek masa aktif domain atau DNS server. Hubungi: Tim Jaringan / Pengelola Domain.',
  TCP_CONNECTION_REFUSED:   'Server menolak koneksi — kemungkinan Nginx/Apache mati atau diblokir firewall. Hubungi: Sysadmin / Tim Server.',
  TCP_TIMEOUT:              'Server tidak merespon sama sekali — mungkin server fisik mati atau kabel putus. Hubungi: Tim Infrastruktur & Data Center.',
  HTTP_4XX:                 'Kode HTTP error 4xx (Client Error) — Halaman tidak ditemukan atau akses ditolak. Hubungi: Tim Developer.',
  HTTP_5XX:                 'Kode HTTP error 5xx (Server Error) — Ada masalah pada aplikasi atau server overload. Hubungi: Tim Developer / Programmer.',
  TIMEOUT:                  'Koneksi atau request terlalu lambat dimuat (Timeout). Server kemungkinan overload atau antrian terlalu panjang. Hubungi: Tim Sysadmin & Developer.',
  SSL_CERT_EXPIRED:         'Sertifikat SSL KEDALUWARSA — browser akan memblokir pengunjung. SEGERA perpanjang SSL! Hubungi: Tim Keamanan.',
  SSL_ERROR:                'Masalah konfigurasi SSL. Jika website internal, aktifkan "Abaikan SSL" di Admin. Hubungi: Tim Sysadmin.',
  SSL_TIMEOUT:              'Proses handshake SSL timeout. Server terlalu lambat merespon negosiasi SSL. Hubungi: Tim Sysadmin.',
  KEYWORD_MISSING:          'Kata kunci wajib tidak ditemukan pada halaman website — kemungkinan aplikasi crash atau menampilkan halaman error. Hubungi: Tim Developer.',
  DEFACEMENT_DETECTED:      '🚨 PERINGATAN KEAMANAN TINGGI: Terdeteksi indikasi peretasan/defacement/judi online pada konten website! Segera lakukan isolasi & investigasi. Hubungi: Tim CSIRT & Keamanan Siber Kemhan.',
  INVALID_URL:              'Format URL monitor tidak valid. Perbaiki URL di panel Admin.',
  TOO_MANY_REDIRECTS:       'Terlalu banyak redirect (pengalihan halaman). Website terjebak dalam redirect loop. Hubungi: Tim Developer / Sysadmin.',
  HTTP_ERROR:               'Terjadi error di tingkat request HTTP. Hubungi: Tim Developer.',
  UNKNOWN_ERROR:            'Terjadi kesalahan tidak terduga pada sistem. Hubungi: Tim Sysadmin.',
};

/**
 * Ambil saran tindakan dari kamus.
 */
function getActionHint(rootCause) {
  return ROOT_CAUSE_HINTS[rootCause] || 'Terjadi gangguan tidak terduga. Hubungi Tim IT untuk investigasi.';
}

/**
 * Send message via Telegram Bot API
 */
async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) {
    throw new Error('Bot Token dan Chat ID Telegram wajib diisi');
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode === 200 && parsed.ok) {
            resolve({ success: true, data: parsed });
          } else {
            reject(new Error(parsed.description || `Telegram API Error (${res.statusCode})`));
          }
        } catch (e) {
          reject(new Error(`Gagal parse respon Telegram: ${body}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Koneksi ke server Telegram timeout'));
    });

    req.on('error', (err) => {
      reject(new Error(`Gagal menghubungi Telegram: ${err.message}`));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Send message via Generic Webhook (Discord / Slack compatible)
 */
async function sendWebhookMessage(webhookUrl, text) {
  if (!webhookUrl) return;

  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch (e) {
      return reject(new Error('Format Webhook URL tidak valid'));
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const postData = JSON.stringify({ content: text, text: text });

    const req = client.request(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    }, (res) => {
      resolve({ success: res.statusCode >= 200 && res.statusCode < 300 });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Koneksi ke Webhook timeout'));
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

/**
 * Format and dispatch DOWN alert
 */
async function notifyDown(monitor, result) {
  const settings = db.getNotificationSettings();
  const timeStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  
  const text = 
`🚨 <b>[SIPANTAU ALERT] Website DOWN</b>

<b>Website:</b> ${monitor.name}
<b>URL:</b> ${monitor.url}
<b>Status:</b> ❌ DOWN
<b>Akar Masalah:</b> <code>${result.root_cause || 'UNKNOWN'}</code>
<b>Detail:</b> <i>${result.detail_message || '-'}</i>
<b>Waktu:</b> ${timeStr} WIB

💡 <b>Catatan:</b> ${getActionHint(result.root_cause)}

<i>SIPANTAU — Sistem Informasi Pemantauan Terpadu</i>`;
  const promises = [];
  if (settings.telegram_enabled && settings.telegram_bot_token && settings.telegram_chat_id) {
    promises.push(
      sendTelegramMessage(settings.telegram_bot_token, settings.telegram_chat_id, text)
        .catch(err => console.error('[Notifier] Telegram DOWN alert error:', err.message))
    );
  }

  if (settings.webhook_enabled && settings.webhook_url) {
    promises.push(
      sendWebhookMessage(settings.webhook_url, text.replace(/<[^>]*>?/gm, ''))
        .catch(err => console.error('[Notifier] Webhook alert error:', err.message))
    );
  }

  await Promise.all(promises);
}

/**
 * Format and dispatch UP (Recovery) alert
 * @param {object} monitor
 * @param {object} result
 * @param {string} [downtimeDuration] - Durasi downtime dalam format manusiawi, misal "23 menit"
 */
async function notifyUp(monitor, result, downtimeDuration = '') {
  const settings = db.getNotificationSettings();
  const timeStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const pingStr = result.response_time_ms ? `${result.response_time_ms} ms` : '-';
  
  // [FEAT] Tampilkan durasi downtime jika tersedia
  const durationLine = downtimeDuration
    ? `\n<b>Durasi Gangguan:</b> ${downtimeDuration}`
    : '';

  const text = 
`✅ <b>[SIPANTAU RESOLVED] Website Kembali UP</b>

<b>Website:</b> ${monitor.name}
<b>URL:</b> ${monitor.url}
<b>Status:</b> 🟢 UP
<b>Kecepatan Respon:</b> ${pingStr}
<b>Waktu Pulih:</b> ${timeStr} WIB${durationLine}

<i>SIPANTAU — Sistem Informasi Pemantauan Terpadu</i>`;

  const promises = [];
  if (settings.telegram_enabled && settings.telegram_bot_token && settings.telegram_chat_id) {
    promises.push(
      sendTelegramMessage(settings.telegram_bot_token, settings.telegram_chat_id, text)
        .catch(err => console.error('[Notifier] Telegram UP alert error:', err.message))
    );
  }

  if (settings.webhook_enabled && settings.webhook_url) {
    promises.push(
      sendWebhookMessage(settings.webhook_url, text.replace(/<[^>]*>?/gm, ''))
        .catch(err => console.error('[Notifier] Webhook alert error:', err.message))
    );
  }

  await Promise.all(promises);
}

/**
 * [FEAT] Format and dispatch peringatan dini SSL akan kedaluwarsa.
 * Dikirim SEBELUM sertifikat benar-benar expired, agar engineer sempat
 * memperpanjang tanpa website sempat DOWN.
 * @param {object} monitor
 * @param {number} daysRemaining - Sisa hari sampai sertifikat kedaluwarsa
 * @param {string} expiryDate - Tanggal expiry mentah dari sertifikat (ISO/UTC)
 */
async function notifySslExpiring(monitor, daysRemaining, expiryDate) {
  const settings = db.getNotificationSettings();
  const expiryFormatted = new Date(expiryDate).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: 'long', day: 'numeric',
  });

  const urgency = daysRemaining <= 3 ? '🚨' : (daysRemaining <= 7 ? '⚠️' : '🔔');
  const dayLabel = daysRemaining <= 0 ? 'HARI INI' : `${daysRemaining} hari lagi`;

  const text =
`${urgency} <b>[SIPANTAU] Sertifikat SSL Akan Kedaluwarsa</b>

<b>Website:</b> ${monitor.name}
<b>URL:</b> ${monitor.url}
<b>Sisa Waktu:</b> ${dayLabel}
<b>Tanggal Kedaluwarsa:</b> ${expiryFormatted}

💡 <b>Catatan:</b> Segera perpanjang sertifikat SSL (Let's Encrypt/DigiCert) sebelum tanggal tersebut agar website tidak diblokir browser pengunjung.

<i>SIPANTAU — Sistem Informasi Pemantauan Terpadu</i>`;

  const promises = [];
  if (settings.telegram_enabled && settings.telegram_bot_token && settings.telegram_chat_id) {
    promises.push(
      sendTelegramMessage(settings.telegram_bot_token, settings.telegram_chat_id, text)
        .catch(err => console.error('[Notifier] Telegram SSL warning error:', err.message))
    );
  }

  if (settings.webhook_enabled && settings.webhook_url) {
    promises.push(
      sendWebhookMessage(settings.webhook_url, text.replace(/<[^>]*>?/gm, ''))
        .catch(err => console.error('[Notifier] Webhook SSL warning error:', err.message))
    );
  }

  await Promise.all(promises);
}

/**
 * [FEAT] Format and dispatch alert deep-scan defacement: dipicu saat
 * pemindaian subhalaman menemukan indikasi defacement/judi online di
 * halaman SELAIN halaman utama monitor (yang tidak terpantau oleh cek
 * cepat siklus normal).
 * @param {object} monitor
 * @param {Array<{url: string, pattern: string}>} flaggedPages
 * @param {number} pagesScanned
 */
async function notifyDeepScanDefacement(monitor, flaggedPages, pagesScanned) {
  const settings = db.getNotificationSettings();
  const timeStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  const listStr = flaggedPages
    .slice(0, 10)
    .map((p) => `• <code>${p.url}</code> — pola: "${p.pattern}"`)
    .join('\n');
  const moreStr = flaggedPages.length > 10 ? `\n… dan ${flaggedPages.length - 10} halaman lainnya` : '';

  const text =
`🚨 <b>[SIPANTAU ALERT] Defacement Terdeteksi di Subhalaman</b>

<b>Website:</b> ${monitor.name}
<b>URL Utama:</b> ${monitor.url}
<b>Halaman Diperiksa:</b> ${pagesScanned}
<b>Halaman Bermasalah:</b> ${flaggedPages.length}

${listStr}${moreStr}

💡 <b>Catatan:</b> Halaman utama mungkin masih normal — indikasi ini ditemukan di subhalaman/subdirektori yang tidak terpantau cek cepat rutin. SEGERA hubungi Tim CSIRT / Keamanan Siber Kemhan — isolasi & audit forensik.

<i>SIPANTAU — Sistem Informasi Pemantauan Terpadu</i>`;

  const promises = [];
  if (settings.telegram_enabled && settings.telegram_bot_token && settings.telegram_chat_id) {
    promises.push(
      sendTelegramMessage(settings.telegram_bot_token, settings.telegram_chat_id, text)
        .catch(err => console.error('[Notifier] Telegram deep-scan alert error:', err.message))
    );
  }

  if (settings.webhook_enabled && settings.webhook_url) {
    promises.push(
      sendWebhookMessage(settings.webhook_url, text.replace(/<[^>]*>?/gm, ''))
        .catch(err => console.error('[Notifier] Webhook deep-scan alert error:', err.message))
    );
  }

  await Promise.all(promises);
}

/**
 * [FEAT] Format and dispatch peringatan dini DOMAIN akan kedaluwarsa (beda
 * dari SSL -- ini soal registrasi domain di registrar, bukan sertifikat).
 * Penyebab downtime yang sering luput: domain lupa diperpanjang, DNS_FAILED
 * total untuk SEMUA subdomain di bawahnya sekaligus.
 * @param {string} domain - Domain induk, mis. "kemhan.go.id"
 * @param {number} daysRemaining
 * @param {string} expiryDate
 * @param {string[]} affectedMonitorNames - Nama monitor yang akan ikut terdampak
 */
async function notifyDomainExpiring(domain, daysRemaining, expiryDate, affectedMonitorNames) {
  const settings = db.getNotificationSettings();
  const expiryFormatted = new Date(expiryDate).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: 'long', day: 'numeric',
  });

  const urgency = daysRemaining <= 7 ? '🚨' : (daysRemaining <= 30 ? '⚠️' : '🔔');
  const dayLabel = daysRemaining <= 0 ? 'HARI INI' : `${daysRemaining} hari lagi`;
  const affectedList = affectedMonitorNames.map((n) => `• ${n}`).join('\n');

  const text =
`${urgency} <b>[SIPANTAU] Domain Akan Kedaluwarsa</b>

<b>Domain:</b> ${domain}
<b>Sisa Waktu:</b> ${dayLabel}
<b>Tanggal Kedaluwarsa:</b> ${expiryFormatted}

<b>Monitor yang ikut terdampak jika domain ini mati:</b>
${affectedList}

💡 <b>Catatan:</b> Kalau domain ini tidak diperpanjang, SEMUA subdomain di atas akan DOWN total (DNS tidak bisa di-resolve). Segera hubungi Tim Pengelola Domain / Registrar untuk perpanjangan.

<i>SIPANTAU — Sistem Informasi Pemantauan Terpadu</i>`;

  const promises = [];
  if (settings.telegram_enabled && settings.telegram_bot_token && settings.telegram_chat_id) {
    promises.push(
      sendTelegramMessage(settings.telegram_bot_token, settings.telegram_chat_id, text)
        .catch(err => console.error('[Notifier] Telegram domain warning error:', err.message))
    );
  }

  if (settings.webhook_enabled && settings.webhook_url) {
    promises.push(
      sendWebhookMessage(settings.webhook_url, text.replace(/<[^>]*>?/gm, ''))
        .catch(err => console.error('[Notifier] Webhook domain warning error:', err.message))
    );
  }

  await Promise.all(promises);
}

/**
 * Send test notification using given credentials
 */
async function sendTestNotification({ botToken, chatId, webhookUrl }) {
  const timeStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const text = 
`🔔 <b>[UJI COBA NOTIFIKASI BERHASIL]</b>

Koneksi bot Telegram ke <b>SIPANTAU (Sistem Informasi Pemantauan Terpadu)</b> berhasil terhubung dengan sukses!

<b>Waktu Tes:</b> ${timeStr} WIB
<b>Status:</b> Terverifikasi ✅`;

  const results = {};
  
  if (botToken && chatId) {
    try {
      await sendTelegramMessage(botToken, chatId, text);
      results.telegram = { success: true, message: 'Pesan tes Telegram berhasil terkirim!' };
    } catch (err) {
      results.telegram = { success: false, message: err.message };
    }
  }

  if (webhookUrl) {
    try {
      await sendWebhookMessage(webhookUrl, text.replace(/<[^>]*>?/gm, ''));
      results.webhook = { success: true, message: 'Pesan tes Webhook berhasil terkirim!' };
    } catch (err) {
      results.webhook = { success: false, message: err.message };
    }
  }

  return results;
}

module.exports = {
  sendTelegramMessage,
  sendWebhookMessage,
  notifyDown,
  notifyUp,
  notifySslExpiring,
  notifyDeepScanDefacement,
  notifyDomainExpiring,
  sendTestNotification
};
