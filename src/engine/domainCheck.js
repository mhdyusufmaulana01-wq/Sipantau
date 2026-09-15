const net = require('net');

const WHOIS_TIMEOUT_MS = 10000;

// Domain generik Indonesia yang berstruktur "second-level" (2 label sebelum
// domain terdaftar, bukan 1) -- mis. kemhan.GO.ID, bukan cuma .id biasa.
// Tanpa daftar ini, "vapt.kemhan.go.id" salah diekstrak jadi "go.id".
const ID_SECOND_LEVEL_SUFFIXES = ['co.id', 'go.id', 'ac.id', 'or.id', 'mil.id', 'net.id', 'web.id', 'sch.id', 'my.id', 'biz.id', 'desa.id'];

/**
 * [FEAT] Ekstrak domain yang BENAR-BENAR terdaftar (registrable domain) dari
 * sebuah hostname/subdomain. Penting karena expiry domain itu berlaku untuk
 * domain induknya, bukan tiap subdomain -- "vapt.kemhan.go.id" dan
 * "mail.kemhan.go.id" sama-sama akan mati bareng kalau "kemhan.go.id" lupa
 * diperpanjang, jadi cukup dicek SEKALI per domain induk (bukan per monitor).
 *
 * KETERBATASAN: ini heuristik sederhana (bukan Public Suffix List lengkap),
 * cukup akurat untuk domain umum (.com, .id, dan second-level .id yang umum)
 * tapi tidak menjamin benar untuk semua TLD dunia yang punya aturan aneh.
 *
 * @param {string} hostname - mis. "vapt.kemhan.go.id"
 * @returns {string|null} mis. "kemhan.go.id", atau null kalau hostname invalid
 */
function extractRegistrableDomain(hostname) {
  if (!hostname) return null;
  const labels = hostname.toLowerCase().split('.').filter(Boolean);
  if (labels.length < 2) return null;

  const lastTwo = labels.slice(-2).join('.');
  for (const suffix of ID_SECOND_LEVEL_SUFFIXES) {
    if (lastTwo === suffix && labels.length >= 3) {
      return labels.slice(-3).join('.');
    }
  }
  return lastTwo;
}

/**
 * Query WHOIS mentah lewat TCP port 43 (protokol WHOIS asli, bukan HTTP).
 */
function queryWhois(domain, server, port = 43) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, server);
    let data = '';
    let resolved = false;

    const finish = (fn, val) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      fn(val);
    };

    socket.setTimeout(WHOIS_TIMEOUT_MS);
    socket.on('connect', () => socket.write(domain + '\r\n'));
    socket.on('data', (chunk) => { data += chunk.toString(); });
    socket.on('end', () => finish(resolve, data));
    socket.on('timeout', () => finish(reject, new Error('WHOIS query timeout')));
    socket.on('error', (err) => finish(reject, err));
  });
}

// Server WHOIS resmi untuk domain .id (dikelola PANDI/Kominfo).
// Domain non-.id (kalau nanti ada) tidak didukung -- lihat catatan di README.
const WHOIS_SERVER_ID = 'whois.id';

/**
 * [FEAT] Cek tanggal expiry registrasi sebuah domain lewat WHOIS.
 * @param {string} hostname - hostname dari URL monitor, mis. "vapt.kemhan.go.id"
 * @returns {Promise<{success: boolean, domain: string|null, expiryDate: string|null, error?: string}>}
 */
async function checkDomainExpiry(hostname) {
  const domain = extractRegistrableDomain(hostname);
  if (!domain) {
    return { success: false, domain: null, expiryDate: null, error: 'Hostname tidak valid' };
  }
  if (!domain.endsWith('.id')) {
    // [KETERBATASAN] Server WHOIS berbeda-beda tiap TLD (butuh referral chain
    // IANA yang lebih kompleks untuk didukung generik). Untuk deployment ini
    // (semua monitor Kemhan berdomain .id) cukup pakai whois.id langsung.
    return { success: false, domain, expiryDate: null, error: 'TLD selain .id belum didukung' };
  }

  try {
    const raw = await queryWhois(domain, WHOIS_SERVER_ID);
    const match = /Registry Expiry Date:\s*(\S+)/i.exec(raw);
    if (!match) {
      return { success: false, domain, expiryDate: null, error: 'Field expiry tidak ditemukan di respons WHOIS' };
    }
    const expiryDate = new Date(match[1]);
    if (isNaN(expiryDate.getTime())) {
      return { success: false, domain, expiryDate: null, error: 'Format tanggal expiry tidak valid' };
    }
    return { success: true, domain, expiryDate: expiryDate.toISOString() };
  } catch (err) {
    return { success: false, domain, expiryDate: null, error: err.message };
  }
}

module.exports = { extractRegistrableDomain, queryWhois, checkDomainExpiry };
