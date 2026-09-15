const express = require('express');
const zlib = require('zlib');

const app = express();
const port = 34567;

// --- Route Dasar ---
app.get('/normal', (req, res) => {
  res.status(200).send('OK');
});

app.get('/timeout', (req, res) => {
  // Never responds to simulate timeout
});

app.get('/error-500', (req, res) => {
  res.status(500).send('Internal Server Error');
});

app.get('/error-404', (req, res) => {
  res.status(404).send('Not Found');
});

app.get('/redirect', (req, res) => {
  res.redirect('/normal');
});

app.get('/redirect-loop', (req, res) => {
  res.redirect('/redirect-loop2');
});

app.get('/redirect-loop2', (req, res) => {
  res.redirect('/redirect-loop');
});

// --- Route Keyword Monitoring ---
app.get('/with-keyword', (req, res) => {
  res.status(200).send('<html><body><h1>Selamat datang di Portal KEMHAN</h1><p>KEMHAN_TOKEN_VALID</p></body></html>');
});

app.get('/without-keyword', (req, res) => {
  res.status(200).send('<html><body><h1>Halaman kosong tanpa konten yang diharapkan</h1></body></html>');
});

// --- Route Defacement Detection ---
app.get('/defaced', (req, res) => {
  res.status(200).send('<html><body><h1>hacked by anonymous</h1><p>slot gacor maxwin</p></body></html>');
});

app.get('/clean', (req, res) => {
  res.status(200).send('<html><body><h1>Portal Resmi Kementerian Pertahanan RI</h1><p>Selamat datang.</p></body></html>');
});

// --- Route Gzip + Keyword (integrasi test_large_gzip.js) ---
const GZIP_KEYWORD = 'KEMHAN_SECURE_TEST_KEYWORD';

app.get('/gzip-with-keyword', (req, res) => {
  // Buat HTML ~1MB dengan keyword tertanam di posisi ~60KB (dalam batas 256KB)
  let html = '<!DOCTYPE html><html><head><title>Test</title></head><body>';
  html += '<p>Lorem ipsum dolor sit amet. </p>'.repeat(1800); // ~60KB padding
  html += `<div id="secret">${GZIP_KEYWORD}</div>`;
  html += '<p>Sed do eiusmod tempor. </p>'.repeat(30000); // sisa padding besar
  html += '</body></html>';

  const compressed = zlib.gzipSync(Buffer.from(html, 'utf-8'));
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Content-Encoding': 'gzip',
    'Content-Length': compressed.length,
  });
  res.end(compressed);
});

app.get('/gzip-without-keyword', (req, res) => {
  // HTML besar tanpa keyword
  let html = '<!DOCTYPE html><html><head><title>Test</title></head><body>';
  html += '<p>Konten halaman tanpa kata kunci yang diharapkan. </p>'.repeat(5000);
  html += '</body></html>';

  const compressed = zlib.gzipSync(Buffer.from(html, 'utf-8'));
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Content-Encoding': 'gzip',
    'Content-Length': compressed.length,
  });
  res.end(compressed);
});

// --- Route Security Header Score ---
app.get('/secure-headers', (req, res) => {
  res.set({
    'Strict-Transport-Security': 'max-age=31536000',
    'Content-Security-Policy': "default-src 'self'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=()',
  });
  res.status(200).send('<html><body>OK</body></html>');
});

app.get('/no-security-headers', (req, res) => {
  res.status(200).send('<html><body>OK</body></html>');
});

// --- Server lifecycle ---
let server;

function startServer() {
  return new Promise((resolve) => {
    server = app.listen(port, () => {
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = { startServer, stopServer, port, GZIP_KEYWORD };
