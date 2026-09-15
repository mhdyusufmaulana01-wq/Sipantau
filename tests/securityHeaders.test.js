const { analyzeSecurityHeaders } = require('../src/engine/securityHeaders');

describe('securityHeaders - analyzeSecurityHeaders', () => {
  it('should give score 100 & grade A when all headers present', () => {
    const headers = {
      'strict-transport-security': 'max-age=31536000',
      'content-security-policy': "default-src 'self'",
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'geolocation=()',
    };
    const result = analyzeSecurityHeaders(headers);
    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.missing).toHaveLength(0);
  });

  it('should give score 0 & grade F when no security headers present at all', () => {
    const headers = { 'content-type': 'text/html' };
    const result = analyzeSecurityHeaders(headers);
    expect(result.score).toBe(0);
    expect(result.grade).toBe('F');
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('should correctly list which headers are missing', () => {
    const headers = {
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
    };
    const result = analyzeSecurityHeaders(headers);
    expect(result.missing).toEqual(expect.arrayContaining([
      'Content-Security-Policy (CSP)',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]));
    expect(result.present).toEqual(expect.arrayContaining([
      'Strict-Transport-Security (HSTS)',
      'X-Content-Type-Options',
    ]));
  });

  it('should handle empty/undefined headers object without throwing', () => {
    expect(() => analyzeSecurityHeaders(undefined)).not.toThrow();
    expect(analyzeSecurityHeaders(undefined).score).toBe(0);
    expect(analyzeSecurityHeaders({}).score).toBe(0);
  });
});
