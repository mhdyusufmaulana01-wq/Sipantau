const { discoverSubpages, fetchText } = require('./siteCrawler');
const { findDefacementPattern } = require('./contentPatterns');

const MAX_PAGES_PER_SITE = 20;
const DELAY_BETWEEN_REQUESTS_MS = 400; // sopan ke server target, hindari terlihat seperti serangan

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * [FEAT] Deep-scan defacement: cek indikasi defacement/judi online di
 * SUBHALAMAN situs, bukan cuma halaman utama.
 *
 * Berbeda dari cek cepat siklus normal (yang hanya menyentuh URL utama
 * monitor), ini menjelajah situs (via sitemap.xml atau link homepage),
 * lalu memeriksa isi tiap subhalaman satu per satu — karena defacer
 * biasanya menanam konten di subdirektori tersembunyi, bukan mengganti
 * halaman utama yang jelas terlihat & cepat ketahuan.
 *
 * Sengaja dijalankan sebagai job TERPISAH & JARANG (harian), bukan tiap
 * siklus cepat 10 detik, karena butuh puluhan request per situs.
 *
 * @param {string} baseUrl - URL utama monitor
 * @param {number} [maxPages] - Batas subhalaman yang dipindai
 * @returns {Promise<{pagesScanned: number, source: string, flaggedPages: Array<{url: string, pattern: string}>}>}
 */
async function scanSiteForDefacement(baseUrl, maxPages = MAX_PAGES_PER_SITE) {
  const { pages, source } = await discoverSubpages(baseUrl, maxPages);

  // Selalu sertakan halaman utama juga — deep-scan berjalan jarang (harian),
  // jadi tidak masalah mengecek ulang meski cek cepat sudah menyentuhnya.
  const allPages = [...new Set([baseUrl, ...pages])].slice(0, maxPages);

  const flaggedPages = [];
  let pagesScanned = 0;

  for (const pageUrl of allPages) {
    const body = await fetchText(pageUrl);
    pagesScanned++;

    if (body) {
      const matched = findDefacementPattern(body.toLowerCase());
      if (matched) {
        flaggedPages.push({ url: pageUrl, pattern: matched });
      }
    }

    // Jeda antar-request supaya tidak membanjiri server target.
    if (pagesScanned < allPages.length) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  return { pagesScanned, source, flaggedPages };
}

module.exports = { scanSiteForDefacement, MAX_PAGES_PER_SITE };
