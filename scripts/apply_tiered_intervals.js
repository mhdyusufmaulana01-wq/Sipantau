const { db } = require('../src/db/client');

// [FIX] Temuan #4: Hapus 'www.kemhan.go.id' yang sudah tidak ada di database monitor
const tier1Sites = [
  'https://kemhan.go.id',
  'https://mail.kemhan.go.id',
  'https://ppid.kemhan.go.id'
];

const tier2Sites = [
  'https://jdih.kemhan.go.id',
  'https://vapt.kemhan.go.id',
  'https://kms-bpsdm.kemhan.go.id'
];

/**
 * Ekstrak hostname dari URL, atau kembalikan null jika URL tidak valid.
 * @param {string} urlStr
 * @returns {string|null}
 */
function getHostname(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function applyTieredIntervals() {
  console.log('--- Menerapkan Pembagian Interval Berdasarkan Tingkat Urgensi ---');
  
  const monitors = db.getAllMonitors();
  
  // [FIX] Temuan #4: Gunakan exact hostname match (via URL parser) bukan startsWith()
  // agar 'https://kemhan.go.id.situs-palsu.com' tidak ikut masuk Tier 1.
  const tier1Hostnames = tier1Sites.map(getHostname).filter(Boolean);
  const tier2Hostnames = tier2Sites.map(getHostname).filter(Boolean);

  for (const m of monitors) {
    const monitorHostname = getHostname(m.url);
    let newInterval = 300; // Default Tier 3 (5 menit)
    let tierName = 'Tier 3 (5 Menit)';

    if (monitorHostname && tier1Hostnames.includes(monitorHostname)) {
      newInterval = 60; // Tier 1 (1 menit)
      tierName = 'Tier 1 (1 Menit - Kritis)';
    } else if (monitorHostname && tier2Hostnames.includes(monitorHostname)) {
      newInterval = 120; // Tier 2 (2 menit - Penting)
      tierName = 'Tier 2 (2 Menit - Operasional)';
    }

    // Update interval in DB
    db.updateMonitorDetails(m.id, {
      ...m,
      interval_seconds: newInterval
    });

    console.log(`[${tierName}] ${m.name} -> ${newInterval} detik`);
  }

  console.log('\nBerhasil memperbarui konfigurasi seluruh website!');
}

applyTieredIntervals();
