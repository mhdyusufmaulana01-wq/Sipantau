const http = require('http');
const https = require('https');
const { URL } = require('url');

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024; // 512KB cukup untuk sitemap/homepage biasa

/**
 * Ambil body teks dari sebuah URL (tanpa dekompresi — sitemap.xml & HTML
 * pada umumnya kecil dan jarang di-gzip pada request tanpa header
 * Accept-Encoding, jadi cukup sederhana untuk kebutuhan discovery ini).
 * @returns {Promise<string|null>} Body teks, atau null jika gagal/bukan 2xx.
 */
function fetchText(urlString) {
  return new Promise((resolve) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (e) {
      return resolve(null);
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    let resolved = false;
    const finish = (val) => {
      if (resolved) return;
      resolved = true;
      resolve(val);
    };

    const req = client.request(urlString, {
      method: 'GET',
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': 'SiPantauMonitor/1.0 (deep-scan)' },
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return finish(null);
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        if (total >= MAX_BODY_BYTES) return;
        chunks.push(chunk);
        total += chunk.length;
        if (total >= MAX_BODY_BYTES) res.destroy();
      });
      res.on('end', () => finish(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', () => finish(null));
    });

    req.on('timeout', () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
    req.end();
  });
}

/**
 * Ekstrak URL <loc>...</loc> dari isi sitemap.xml, hanya yang satu origin
 * dengan baseUrl (mencegah sitemap index yang menunjuk domain lain).
 */
function extractSitemapUrls(xmlText, origin) {
  const urls = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xmlText)) !== null) {
    try {
      const u = new URL(m[1]);
      if (u.origin === origin) urls.push(u.href);
    } catch (e) { /* skip URL tidak valid */ }
  }
  return urls;
}

/**
 * Ekstrak link <a href="..."> dari HTML, hanya yang satu origin dengan
 * baseUrl, dan buang jangkar (#...), mailto:, tel:, javascript:.
 */
function extractHtmlLinks(html, baseUrl, origin) {
  const urls = [];
  const re = /<a\s+[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw)) continue;
    try {
      const u = new URL(raw, baseUrl);
      if (u.origin === origin) {
        u.hash = '';
        urls.push(u.href);
      }
    } catch (e) { /* skip URL tidak valid */ }
  }
  return urls;
}

/**
 * [FEAT] Temukan subhalaman sebuah situs untuk deep-scan defacement.
 *
 * Strategi (dalam urutan prioritas):
 * 1. Coba baca {origin}/sitemap.xml — kalau berisi URL, gunakan itu (sitemap
 *    biasanya paling komprehensif & murah untuk di-fetch sekali).
 * 2. Kalau sitemap tidak ada/kosong, fallback: ekstrak semua link <a href>
 *    dari halaman utama (1 level crawl dari homepage).
 *
 * KETERBATASAN YANG DISADARI (bukan bug): halaman "yatim" yang sengaja
 * disembunyikan penyerang (tidak ada di sitemap, tidak ditautkan dari mana
 * pun di situs) tidak akan ditemukan oleh strategi ini. Deteksi semacam itu
 * butuh directory brute-forcing yang jauh lebih agresif & berisiko dianggap
 * serangan oleh target — di luar cakupan (lihat Batasan Masalah).
 *
 * @param {string} baseUrl - URL utama monitor (mis. https://kemhan.go.id)
 * @param {number} maxPages - Batas jumlah subhalaman yang dikembalikan
 * @returns {Promise<{pages: string[], source: 'sitemap'|'homepage-links'|'none'}>}
 */
async function discoverSubpages(baseUrl, maxPages = 20) {
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch (e) {
    return { pages: [], source: 'none' };
  }

  // 1. Coba sitemap.xml
  const sitemapText = await fetchText(`${origin}/sitemap.xml`);
  if (sitemapText) {
    const sitemapUrls = extractSitemapUrls(sitemapText, origin);
    if (sitemapUrls.length > 0) {
      return { pages: [...new Set(sitemapUrls)].slice(0, maxPages), source: 'sitemap' };
    }
  }

  // 2. Fallback: crawl link dari homepage
  const homeHtml = await fetchText(baseUrl);
  if (homeHtml) {
    const links = extractHtmlLinks(homeHtml, baseUrl, origin);
    if (links.length > 0) {
      return { pages: [...new Set(links)].slice(0, maxPages), source: 'homepage-links' };
    }
  }

  return { pages: [], source: 'none' };
}

module.exports = { discoverSubpages, fetchText };
