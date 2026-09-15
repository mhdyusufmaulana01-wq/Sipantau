// [BUG FIX] Regresi untuk bug: sertifikat SSL yang SUDAH kedaluwarsa beneran
// dulu tetap dilabeli status UP dengan root_cause generik 'SSL_ERROR',
// padahal seharusnya DOWN dengan root_cause spesifik 'SSL_CERT_EXPIRED'.
//
// Pakai mock (bukan koneksi TLS asli ke situs luar) supaya hasilnya
// deterministik -- tidak bergantung sertifikat expired sungguhan yang bisa
// berubah/hilang sewaktu-waktu di internet.

jest.mock('../src/engine/dnsCheck', () => jest.fn(async () => ({ success: true, address: '1.2.3.4' })));
jest.mock('../src/engine/tcpCheck', () => jest.fn(async () => ({ success: true })));
jest.mock('../src/engine/httpCheck', () => jest.fn(async () => ({
  success: true, http_status_code: 200, response_time_ms: 50,
  security_header_score: 50, security_headers_missing: [],
})));
jest.mock('../src/engine/sslCheck');

const checkSsl = require('../src/engine/sslCheck');
const { runSingleCheck } = require('../src/engine/index');

describe('[BUG FIX] Penanganan SSL_CERT_EXPIRED vs SSL_ERROR/SSL_TIMEOUT biasa', () => {
  it('HARUS status DOWN & root_cause SSL_CERT_EXPIRED kalau sertifikat sungguh kedaluwarsa', async () => {
    checkSsl.mockResolvedValue({
      success: false,
      root_cause: 'SSL_CERT_EXPIRED',
      detail_message: 'Sertifikat SSL sudah kedaluwarsa sejak 1 Januari 2024',
      ssl_valid: false,
      ssl_expiry_date: '2024-01-01T00:00:00.000Z',
    });

    const result = await runSingleCheck('https://contoh-expired.test');

    expect(result.status).toBe('DOWN');
    expect(result.root_cause).toBe('SSL_CERT_EXPIRED');
    expect(result.detail_message).toMatch(/kedaluwarsa/i);
  });

  it('HARUS status tetap UP (warning) & root_cause SSL_ERROR asli kalau cuma masalah konfigurasi (bukan expired)', async () => {
    checkSsl.mockResolvedValue({
      success: false,
      root_cause: 'SSL_ERROR',
      detail_message: 'Hostname mismatch',
      ssl_valid: false,
    });

    const result = await runSingleCheck('https://contoh-misconfig.test');

    expect(result.status).toBe('UP');
    expect(result.root_cause).toBe('SSL_ERROR');
    expect(result.detail_message).toBe('Hostname mismatch');
  });

  it('HARUS status tetap UP (warning) & root_cause SSL_TIMEOUT asli kalau pengecekan SSL cuma timeout', async () => {
    checkSsl.mockResolvedValue({
      success: false,
      root_cause: 'SSL_TIMEOUT',
      detail_message: 'SSL check timed out',
      ssl_valid: false,
    });

    const result = await runSingleCheck('https://contoh-timeout.test');

    expect(result.status).toBe('UP');
    expect(result.root_cause).toBe('SSL_TIMEOUT');
    expect(result.detail_message).toBe('SSL check timed out');
  });

  it('HARUS status UP & root_cause NONE kalau SSL sepenuhnya valid', async () => {
    checkSsl.mockResolvedValue({
      success: true,
      ssl_valid: true,
      ssl_expiry_date: '2027-01-01T00:00:00.000Z',
    });

    const result = await runSingleCheck('https://contoh-valid.test');

    expect(result.status).toBe('UP');
    expect(result.root_cause).toBe('NONE');
    expect(result.ssl_valid).toBe(true);
  });
});
