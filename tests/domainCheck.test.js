const { extractRegistrableDomain, checkDomainExpiry } = require('../src/engine/domainCheck');

describe('domainCheck - extractRegistrableDomain', () => {
  it('should extract parent domain from a .go.id subdomain', () => {
    expect(extractRegistrableDomain('vapt.kemhan.go.id')).toBe('kemhan.go.id');
    expect(extractRegistrableDomain('mail.kemhan.go.id')).toBe('kemhan.go.id');
    expect(extractRegistrableDomain('cat.ropeg.kemhan.go.id')).toBe('kemhan.go.id');
  });

  it('should keep the domain as-is when it is already the registrable domain', () => {
    expect(extractRegistrableDomain('kemhan.go.id')).toBe('kemhan.go.id');
  });

  it('should handle other Indonesian second-level suffixes (.co.id, .ac.id, dst.)', () => {
    expect(extractRegistrableDomain('www.example.co.id')).toBe('example.co.id');
    expect(extractRegistrableDomain('portal.kampus.ac.id')).toBe('kampus.ac.id');
  });

  it('should fall back to last 2 labels for generic TLDs', () => {
    expect(extractRegistrableDomain('sub.example.com')).toBe('example.com');
    expect(extractRegistrableDomain('example.com')).toBe('example.com');
  });

  it('should return null for invalid/empty hostname', () => {
    expect(extractRegistrableDomain('')).toBeNull();
    expect(extractRegistrableDomain(null)).toBeNull();
    expect(extractRegistrableDomain('localhost')).toBeNull();
  });
});

describe('domainCheck - checkDomainExpiry (integrasi WHOIS asli)', () => {
  // Catatan: test ini butuh koneksi internet ke whois.id (port 43).
  // Kalau jaringan tidak tersedia, test ini akan timeout secara alami.
  it('should retrieve a real, sane expiry date for kemhan.go.id', async () => {
    const result = await checkDomainExpiry('vapt.kemhan.go.id');

    expect(result.success).toBe(true);
    expect(result.domain).toBe('kemhan.go.id');
    expect(result.expiryDate).toBeTruthy();

    const expiry = new Date(result.expiryDate);
    const now = new Date();
    // kemhan.go.id domain pemerintah aktif -- expiry-nya harus di masa depan
    // yang masuk akal (bukan tahun 1970 atau sejenisnya kalau parsing gagal).
    expect(expiry.getTime()).toBeGreaterThan(now.getTime());
    expect(expiry.getFullYear()).toBeGreaterThan(now.getFullYear());
  }, 15000);

  it('should fail gracefully (not throw) for non-.id TLD (belum didukung)', async () => {
    const result = await checkDomainExpiry('www.example.com');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/belum didukung/i);
  });

  it('should fail gracefully for invalid hostname', async () => {
    const result = await checkDomainExpiry('');
    expect(result.success).toBe(false);
  });
});
