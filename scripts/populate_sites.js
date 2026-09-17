const { db } = require('../src/db/client');
const { checkWebsite } = require('../src/engine/index');

// Daftar resmi website Kemhan (diperbarui September 2026 dari daftarwebsitekemhan.txt)
const sitesToAdd = [
  // --- Website Utama ---
  { name: 'Kemhan Utama',         url: 'https://www.kemhan.go.id',                           interval: 60, timeout: 5000 },

  // --- Layanan & Sistem Informasi ---
  { name: 'VAPT Kemhan',          url: 'https://vapt.kemhan.go.id',                          interval: 60, timeout: 5000 },
  { name: 'PPID Kemhan',          url: 'https://ppid.kemhan.go.id',                          interval: 60, timeout: 5000 },
  { name: 'JDIH Kemhan',          url: 'https://jdih.kemhan.go.id',                          interval: 60, timeout: 5000 },
  { name: 'JDIH Backend Kemhan',  url: 'https://jdih-be.kemhan.go.id',                       interval: 60, timeout: 5000 },
  { name: 'Webmail Kemhan',       url: 'https://mail.kemhan.go.id',                          interval: 60, timeout: 5000 },
  { name: 'Surel Kemhan',         url: 'https://surel.kemhan.go.id',                         interval: 60, timeout: 5000 },
  { name: 'SIMWAS Kemhan',        url: 'https://simwas.kemhan.go.id',                        interval: 60, timeout: 5000 },
  { name: 'Caraka Kemhan',        url: 'https://caraka.kemhan.go.id',                        interval: 60, timeout: 5000 },
  { name: 'SIPHAN Kemhan',        url: 'https://siphan.kemhan.go.id',                        interval: 60, timeout: 5000 },
  { name: 'SIMPEG Kemhan',        url: 'https://simpeg.kemhan.go.id',                        interval: 60, timeout: 5000 },
  { name: 'HCDP Kemhan',          url: 'https://hcdp.kemhan.go.id',                          interval: 60, timeout: 5000 },
  { name: 'Dashboard Kemhan',     url: 'https://dashboard.kemhan.go.id/reset-pass',          interval: 60, timeout: 5000 },
  { name: 'EMS-CC Kemhan',        url: 'https://ems-cc.kemhan.go.id',                        interval: 60, timeout: 5000 },
  { name: 'CSIRT Kemhan',         url: 'https://csirt.kemhan.go.id',                         interval: 60, timeout: 5000 },

  // --- Data & Pengetahuan ---
  { name: 'Satu Data Kemhan',     url: 'https://satudata.kemhan.go.id',                      interval: 60, timeout: 5000 },
  { name: 'Open Data Kemhan',     url: 'https://opendata.kemhan.go.id',                      interval: 60, timeout: 5000 },
  { name: 'Pustaka Kemhan',       url: 'https://pustaka.kemhan.go.id',                       interval: 60, timeout: 5000 },

  // --- Pengadaan ---
  { name: 'SPSE INAPROC Kemhan',  url: 'https://spse.inaproc.id/kemhan',                     interval: 60, timeout: 5000 },
  { name: 'SIRUP LKPP',           url: 'https://sirup.lkpp.go.id',                           interval: 60, timeout: 5000 },

  // --- BPSDM & Pendidikan ---
  { name: 'BPSDM Kemhan',         url: 'https://bpsdm.kemhan.go.id',                         interval: 60, timeout: 5000 },
  { name: 'KMS BPSDM Kemhan',     url: 'https://kms-bpsdm.kemhan.go.id',                     interval: 60, timeout: 5000 },
  { name: 'BPSDMHAN PJJ Kemhan',  url: 'https://bpsdmhan-pjj.kemhan.go.id',                  interval: 60, timeout: 5000 },
  { name: 'Lithum BPSDM Kemhan',  url: 'https://lithum-bpsdm.kemhan.go.id',                  interval: 60, timeout: 5000 },
  { name: 'E-Journal Badiklat',   url: 'https://ejournal.badiklat.kemhan.go.id',              interval: 60, timeout: 5000 },
  { name: 'E-Learning Jemen',     url: 'http://jemen.elearning.badiklat.kemhan.go.id',        interval: 60, timeout: 5000 },
  { name: 'E-Learning Bahasa',    url: 'http://bahasa.elearning.badiklat.kemhan.go.id',       interval: 60, timeout: 5000 },

  // --- Satuan & Fungsi Khusus ---
  { name: 'Komcad Kemhan',        url: 'https://komcad.kemhan.go.id',                        interval: 60, timeout: 5000 },
  { name: 'Pothan Kemhan',        url: 'https://pothan.kemhan.go.id',                        interval: 60, timeout: 5000 },
  { name: 'ADMM 2023 Kemhan',     url: 'https://admm2023-indonesia.kemhan.go.id',             interval: 60, timeout: 5000 },
];

async function populateAndInitialCheck() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   SIPANTAU - Migrasi Daftar Website Kemhan         ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`\nTotal website yang akan diproses: ${sitesToAdd.length}`);
  console.log('─'.repeat(55));

  const existingMonitors = db.getAllMonitors();
  const existingUrls = new Set(existingMonitors.map(m => m.url.replace(/\/$/, '')));

  let added = 0;
  let skipped = 0;

  for (const site of sitesToAdd) {
    const normalizedUrl = site.url.replace(/\/$/, '');
    if (!existingUrls.has(normalizedUrl)) {
      const id = db.addMonitor({
        name: site.name,
        url: site.url,
        interval_seconds: site.interval,
        timeout_ms: site.timeout,
        retry_count: 2,
        retry_delay_ms: 1000,
        is_active: 1
      });
      console.log(`[+ Ditambahkan] ${site.name} (${site.url}) - ID: ${id}`);
      added++;
    } else {
      console.log(`[Ada] ${site.name} sudah terdaftar, dilewati.`);
      skipped++;
    }
  }

  console.log('\n' + '─'.repeat(55));
  console.log(`Ringkasan: ${added} ditambahkan, ${skipped} sudah ada.`);

  console.log('\n--- Melakukan Pengecekan Awal Agar Langsung Muncul Statusnya ---');
  const allCurrent = db.getAllMonitors();
  for (const m of allCurrent) {
    const history = db.getCheckHistory(m.id, 1);
    if (history.length === 0) {
      process.stdout.write(`Mengecek ${m.name}... `);
      const res = await checkWebsite(m);
      db.addCheckResult({
        monitor_id: m.id,
        ...res
      });
      db.updateMonitorStatus(m.id, res.status);
      console.log(`[${res.status}] (${res.root_cause})`);
    }
  }

  console.log('\n✔ Selesai! Seluruh website berhasil ditambahkan dan dicek.');
}

populateAndInitialCheck();
