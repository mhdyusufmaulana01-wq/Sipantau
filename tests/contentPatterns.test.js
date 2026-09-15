const { findDefacementPattern } = require('../src/engine/contentPatterns');

describe('contentPatterns - findDefacementPattern (false positive vs deteksi asli)', () => {
  it('TIDAK boleh flag artikel edukasi yang menyebut "slot gacor" sekali dalam kalimat peringatan', () => {
    const body = 'Masyarakat diimbau waspada terhadap link judi online, terutama yang menyatakan diri sebagai "slot gacor" agar tidak tertipu.'.toLowerCase();
    expect(findDefacementPattern(body)).toBeNull();
  });

  it('TIDAK boleh flag berita yang membahas modus penipuan "rtp live" satu kali', () => {
    const body = 'Polisi mengungkap modus penipuan berkedok rtp live yang menyasar korban di media sosial.'.toLowerCase();
    expect(findDefacementPattern(body)).toBeNull();
  });

  it('HARUS flag halaman spam yang menumpuk beberapa istilah judi berbeda sekaligus (keyword stuffing)', () => {
    const body = 'agen slot terpercaya, situs slot gacor hari ini, rtp live tertinggi se-indonesia'.toLowerCase();
    expect(findDefacementPattern(body)).not.toBeNull();
  });

  it('HARUS flag halaman yang mengulang istilah judi yang sama berkali-kali (keyword stuffing 1 istilah)', () => {
    const body = 'slot gacor '.repeat(5).toLowerCase();
    expect(findDefacementPattern(body)).toBe('slot gacor');
  });

  it('TIDAK boleh flag kalau istilah judi yang sama cuma disebut 1-3 kali (di bawah ambang repeat)', () => {
    const body = 'slot gacor '.repeat(3).toLowerCase();
    expect(findDefacementPattern(body)).toBeNull();
  });

  it('HARUS flag langsung kalau ada tanda tangan hacker, walau cuma sekali', () => {
    const body = 'situs ini telah hacked by anonymous crew'.toLowerCase();
    expect(findDefacementPattern(body)).toBe('hacked by');
  });

  it('HARUS flag langsung kalau jargon judi ada di tag <title> (title hijacking untuk SEO poisoning), walau cuma 1 istilah', () => {
    const body = '<html><head><title>Situs Slot Gacor Terpercaya 2026</title></head><body><p>Selamat datang</p></body></html>'.toLowerCase();
    const result = findDefacementPattern(body);
    expect(result).not.toBeNull();
    expect(result).toMatch(/title/i);
  });

  it('TIDAK boleh flag kalau title halaman normal, walau body-nya (di luar title) menyebut 1 istilah judi', () => {
    const body = '<html><head><title>Berita Kemhan - Waspada Judi Online</title></head><body><p>Awas modus rtp live yang menipu warga.</p></body></html>'.toLowerCase();
    expect(findDefacementPattern(body)).toBeNull();
  });
});
