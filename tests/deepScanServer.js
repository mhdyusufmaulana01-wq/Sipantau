const express = require('express');

// Port khusus untuk deepScan.test.js — SENGAJA berbeda dari tests/server.js
// (34567/34568). Jest menjalankan file test secara paralel di worker
// terpisah; kalau dua file test sama-sama listen di port yang sama,
// keduanya akan rebutan port dan gagal acak (flaky).
const port = 34579;
const fallbackPort = 34580;

// --- Server utama: PUNYA sitemap.xml ---
const app = express();

app.get('/', (req, res) => {
  res.status(200).send('<html><body><h1>Portal Resmi Kementerian Pertahanan RI</h1><p>Selamat datang.</p></body></html>');
});

app.get('/sitemap.xml', (req, res) => {
  const origin = `http://localhost:${port}`;
  res.set('Content-Type', 'application/xml');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/page-clean-1</loc></url>
  <url><loc>${origin}/page-clean-2</loc></url>
  <url><loc>${origin}/sub/page-defaced</loc></url>
</urlset>`);
});

app.get('/page-clean-1', (req, res) => {
  res.status(200).send('<html><body><h1>Halaman Layanan 1</h1><p>Konten normal.</p></body></html>');
});

app.get('/page-clean-2', (req, res) => {
  res.status(200).send('<html><body><h1>Halaman Layanan 2</h1><p>Konten normal.</p></body></html>');
});

app.get('/sub/page-defaced', (req, res) => {
  res.status(200).send('<html><body><h1>hacked by anonymous</h1><p>slot gacor maxwin</p></body></html>');
});

// --- Server kedua: TANPA sitemap.xml, khusus menguji jalur fallback
// discoverSubpages (crawl link <a href> dari homepage). ---
const fallbackApp = express();

fallbackApp.get('/', (req, res) => {
  res.status(200).send(`
    <html><body>
      <h1>Portal Resmi Kementerian Pertahanan RI</h1>
      <a href="/layanan-clean">Layanan</a>
      <a href="/arsip/berita-defaced">Berita</a>
      <a href="https://situs-lain-di-luar.example.com/abaikan-ini">Link Luar</a>
    </body></html>
  `);
});

fallbackApp.get('/layanan-clean', (req, res) => {
  res.status(200).send('<html><body><h1>Layanan</h1><p>Konten normal.</p></body></html>');
});

fallbackApp.get('/arsip/berita-defaced', (req, res) => {
  res.status(200).send('<html><body><h1>defaced by intruder</h1><p>rtp live gacor</p></body></html>');
});

let server;
let fallbackServer;

function startServer() {
  return new Promise((resolve) => {
    server = app.listen(port, () => resolve());
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

function startFallbackServer() {
  return new Promise((resolve) => {
    fallbackServer = fallbackApp.listen(fallbackPort, () => resolve());
  });
}

function stopFallbackServer() {
  return new Promise((resolve) => {
    if (fallbackServer) fallbackServer.close(() => resolve());
    else resolve();
  });
}

module.exports = {
  startServer, stopServer, port,
  startFallbackServer, stopFallbackServer, fallbackPort,
};
