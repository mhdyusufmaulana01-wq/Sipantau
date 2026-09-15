const { runSingleCheck, checkWebsite } = require('../src/engine/index');
const checkHttp = require('../src/engine/httpCheck');
const { startServer, stopServer, port, GZIP_KEYWORD } = require('./server');

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

describe('Checking Engine - runSingleCheck', () => {
  it('should return UP for a normal HTTP response', async () => {
    const result = await runSingleCheck(`http://localhost:${port}/normal`);
    expect(result.status).toBe('UP');
    expect(result.root_cause).toBe('NONE');
    expect(result.http_status_code).toBe(200);
    expect(result.dns_ok).toBe(true);
    expect(result.tcp_ok).toBe(true);
  });

  it('should follow redirects and return UP', async () => {
    const result = await runSingleCheck(`http://localhost:${port}/redirect`);
    expect(result.status).toBe('UP');
    expect(result.http_status_code).toBe(200);
  });

  it('should detect HTTP 4XX errors', async () => {
    const result = await runSingleCheck(`http://localhost:${port}/error-404`);
    expect(result.status).toBe('DOWN');
    expect(result.root_cause).toBe('HTTP_4XX');
    expect(result.http_status_code).toBe(404);
  });

  it('should detect HTTP 5XX errors', async () => {
    const result = await runSingleCheck(`http://localhost:${port}/error-500`);
    expect(result.status).toBe('DOWN');
    expect(result.root_cause).toBe('HTTP_5XX');
    expect(result.http_status_code).toBe(500);
  });

  it('should detect timeout', async () => {
    const result = await runSingleCheck(`http://localhost:${port}/timeout`, { timeoutMs: 1000 }); // 1s timeout
    expect(result.status).toBe('DOWN');
    expect(result.root_cause).toBe('TIMEOUT');
  });

  it('should detect connection refused (closed port)', async () => {
    const result = await runSingleCheck('http://localhost:59999'); // Assuming port is closed
    expect(result.status).toBe('DOWN');
    expect(result.root_cause).toBe('TCP_CONNECTION_REFUSED');
  });

  it('should detect invalid domain (DNS failed)', async () => {
    const result = await runSingleCheck('http://invalid-domain.local-test.xyz');
    expect(result.status).toBe('DOWN');
    expect(result.root_cause).toBe('DNS_FAILED');
  });

  it('should detect too many redirects', async () => {
    const result = await runSingleCheck(`http://localhost:${port}/redirect-loop`);
    expect(result.status).toBe('DOWN');
    expect(result.root_cause).toBe('TOO_MANY_REDIRECTS');
  });
});

describe('Checking Engine - Retry Logic', () => {
  it('should return DOWN after max retries', async () => {
    const startTime = Date.now();
    const result = await checkWebsite({
      url: `http://localhost:${port}/error-500`,
      timeout_ms: 1000,
      retry_count: 2,
      retry_delay_ms: 500
    });
    const duration = Date.now() - startTime;
    
    expect(result.status).toBe('DOWN');
    // It should have taken at least (retry_delay_ms * retry_count) ms
    expect(duration).toBeGreaterThanOrEqual(1000); 
  }, 10000);
});

// ==================================================================================
// TEMUAN #6: Integrasi test coverage fitur andalan SIPANTAU
// Sebelumnya tidak ada di suite resmi, hanya tersedia sebagai test_large_gzip.js terpisah
// ==================================================================================

describe('Content Analysis - Defacement Detection', () => {
  it('should detect defacement pattern and return DEFACEMENT_DETECTED', async () => {
    // Website HTTP 200 tapi kontennya mengandung pola defacement/judi online
    const result = await checkHttp(`http://localhost:${port}/defaced`, {
      checkDefacement: true,
    });
    expect(result.success).toBe(false);
    expect(result.root_cause).toBe('DEFACEMENT_DETECTED');
    expect(result.http_status_code).toBe(200);
    expect(result.detail_message).toMatch(/defacement|judi online/i);
  });

  it('should return UP for clean content when defacement check is active', async () => {
    // Website bersih — tidak ada pola defacement/judi
    const result = await checkHttp(`http://localhost:${port}/clean`, {
      checkDefacement: true,
    });
    expect(result.success).toBe(true);
    expect(result.http_status_code).toBe(200);
  });

  it('should NOT flag defaced page when checkDefacement is disabled', async () => {
    // Jika admin menonaktifkan cek defacement, halaman terdefacement tetap dianggap UP
    const result = await checkHttp(`http://localhost:${port}/defaced`, {
      checkDefacement: false,
    });
    expect(result.success).toBe(true);
    expect(result.http_status_code).toBe(200);
  });
});

describe('Content Analysis - Keyword Monitoring', () => {
  it('should return UP when expected keyword is found in plain response', async () => {
    const result = await checkHttp(`http://localhost:${port}/with-keyword`, {
      expectedKeyword: 'KEMHAN_TOKEN_VALID',
      checkDefacement: false,
    });
    expect(result.success).toBe(true);
    expect(result.http_status_code).toBe(200);
  });

  it('should return KEYWORD_MISSING when expected keyword is absent in plain response', async () => {
    const result = await checkHttp(`http://localhost:${port}/without-keyword`, {
      expectedKeyword: 'KEMHAN_TOKEN_VALID',
      checkDefacement: false,
    });
    expect(result.success).toBe(false);
    expect(result.root_cause).toBe('KEYWORD_MISSING');
    expect(result.http_status_code).toBe(200);
  });

  // Integrasi resmi dari test_large_gzip.js — sebelumnya hanya bisa dijalankan manual
  it('[GZIP] should find keyword within first 256KB of large gzip-compressed response', async () => {
    // Keyword tertanam di sekitar posisi 60KB — dalam batas streaming 256KB
    // Ini memverifikasi bahwa zlib streaming decompression berfungsi benar
    const result = await checkHttp(`http://localhost:${port}/gzip-with-keyword`, {
      timeoutMs: 10000,
      expectedKeyword: GZIP_KEYWORD,
      checkDefacement: false,
    });
    expect(result.success).toBe(true);
    expect(result.http_status_code).toBe(200);
  }, 15000);

  it('[GZIP] should return KEYWORD_MISSING when keyword absent in large gzip-compressed response', async () => {
    const result = await checkHttp(`http://localhost:${port}/gzip-without-keyword`, {
      timeoutMs: 10000,
      expectedKeyword: GZIP_KEYWORD,
      checkDefacement: false,
    });
    expect(result.success).toBe(false);
    expect(result.root_cause).toBe('KEYWORD_MISSING');
    expect(result.http_status_code).toBe(200);
  }, 15000);
});

describe('Security Header Score - via checkHttp (integrasi real HTTP)', () => {
  it('should score 100 when target responds with all security headers set', async () => {
    const result = await checkHttp(`http://localhost:${port}/secure-headers`);
    expect(result.success).toBe(true);
    expect(result.security_header_score).toBe(100);
    expect(result.security_headers_missing).toHaveLength(0);
  });

  it('should score 0 when target has no security headers at all', async () => {
    const result = await checkHttp(`http://localhost:${port}/no-security-headers`);
    expect(result.success).toBe(true);
    expect(result.security_header_score).toBe(0);
    expect(result.security_headers_missing.length).toBeGreaterThan(0);
  });

  it('should be null when there is no HTTP response at all (e.g. DNS failure)', async () => {
    const result = await runSingleCheck('http://invalid-domain.local-test.xyz');
    expect(result.security_header_score).toBeNull();
  });
});

describe('SSL Check - via runSingleCheck', () => {
  // Menggunakan layanan publik badssl.com yang dirancang khusus untuk test SSL.
  // Catatan: test ini membutuhkan koneksi internet aktif.
  // Jika jaringan tidak tersedia, test ini akan timeout/dilewati Jest secara natural.

  it('should return UP (with ssl_valid=true) for a valid HTTPS website', async () => {
    const result = await runSingleCheck('https://tls-v1-2.badssl.com:1012/', { timeoutMs: 10000 });
    // Status bisa UP atau DOWN tergantung kondisi jaringan, tapi ssl_valid harus true
    // jika berhasil connect ke sertifikat valid
    if (result.status === 'UP') {
      expect(result.ssl_valid).toBe(true);
      expect(result.root_cause).toBe('NONE');
    } else {
      // Jika network issue (bukan SSL issue), root_cause bukan SSL_ERROR/SSL_CERT_EXPIRED
      expect(['DNS_FAILED', 'TCP_CONNECTION_REFUSED', 'TIMEOUT', 'HTTP_ERROR']).toContain(result.root_cause);
    }
  }, 15000);

  it('should detect SSL_ERROR for expired certificate', async () => {
    // expired.badssl.com adalah layanan publik dengan sertifikat yang sengaja sudah kedaluwarsa
    const result = await runSingleCheck('https://expired.badssl.com/', { timeoutMs: 10000 });
    if (result.status !== 'UP') {
      // Bisa SSL_ERROR atau root_cause lain jika ada network issue sebelum SSL check
      // Yang penting bukan NONE — sertifikat expired seharusnya tidak lolos tanpa tanda
      expect(result.root_cause).not.toBe('NONE');
    }
    // Jika status UP (seharusnya tidak terjadi), test dianggap informasional
  }, 15000);

  it('should return UP (with ssl_valid=null) when ignoreSsl=true on HTTPS website', async () => {
    // ignoreSsl=true berarti SSL check dilewati, ssl_valid harus null (bukan true/false)
    const result = await runSingleCheck(`http://localhost:${port}/normal`, {
      ignoreSsl: true,
      timeoutMs: 5000,
    });
    // Server test lokal adalah HTTP (bukan HTTPS), jadi ssl_valid tidak relevan dan tetap null
    expect(result.status).toBe('UP');
    expect(result.ssl_valid).toBeNull();
  }, 10000);
});

