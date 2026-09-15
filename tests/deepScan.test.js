const { discoverSubpages } = require('../src/engine/siteCrawler');
const { scanSiteForDefacement } = require('../src/engine/deepScan');
const {
  startServer, stopServer, port,
  startFallbackServer, stopFallbackServer, fallbackPort,
} = require('./deepScanServer');

beforeAll(async () => {
  await startServer();
  await startFallbackServer();
});

afterAll(async () => {
  await stopServer();
  await stopFallbackServer();
});

describe('siteCrawler - discoverSubpages', () => {
  it('should discover pages from sitemap.xml when available', async () => {
    const { pages, source } = await discoverSubpages(`http://localhost:${port}`, 20);
    expect(source).toBe('sitemap');
    expect(pages).toEqual(expect.arrayContaining([
      `http://localhost:${port}/page-clean-1`,
      `http://localhost:${port}/page-clean-2`,
      `http://localhost:${port}/sub/page-defaced`,
    ]));
  });

  it('should fall back to homepage links when sitemap.xml is absent, and exclude external-origin links', async () => {
    const { pages, source } = await discoverSubpages(`http://localhost:${fallbackPort}`, 20);
    expect(source).toBe('homepage-links');
    expect(pages).toEqual(expect.arrayContaining([
      `http://localhost:${fallbackPort}/layanan-clean`,
      `http://localhost:${fallbackPort}/arsip/berita-defaced`,
    ]));
    // Link ke domain luar (origin berbeda) harus DIBUANG
    expect(pages.find((p) => p.includes('situs-lain-di-luar'))).toBeUndefined();
  });

  it('should respect maxPages limit', async () => {
    const { pages } = await discoverSubpages(`http://localhost:${port}`, 2);
    expect(pages.length).toBeLessThanOrEqual(2);
  });
});

describe('deepScan - scanSiteForDefacement', () => {
  it('should flag only the defaced subpage, not the clean homepage or clean subpages', async () => {
    const result = await scanSiteForDefacement(`http://localhost:${port}`, 20);

    expect(result.source).toBe('sitemap');
    // homepage + 3 halaman sitemap = 4 halaman diperiksa
    expect(result.pagesScanned).toBe(4);
    expect(result.flaggedPages).toHaveLength(1);
    expect(result.flaggedPages[0].url).toBe(`http://localhost:${port}/sub/page-defaced`);
    expect(['slot gacor', 'hacked by']).toContain(result.flaggedPages[0].pattern);
  }, 15000);

  it('should flag defaced subpage found via homepage-link fallback discovery', async () => {
    const result = await scanSiteForDefacement(`http://localhost:${fallbackPort}`, 20);

    expect(result.source).toBe('homepage-links');
    expect(result.flaggedPages).toHaveLength(1);
    expect(result.flaggedPages[0].url).toBe(`http://localhost:${fallbackPort}/arsip/berita-defaced`);
  }, 15000);
});
