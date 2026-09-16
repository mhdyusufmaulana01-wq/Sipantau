const { db } = require('../src/db/client');
const { checkWebsite } = require('../src/engine/index');

const sitesToAdd = [
  { name: 'Kemhan Utama', url: 'https://kemhan.go.id', interval: 60, timeout: 5000 },
  { name: 'JDIH Kemhan', url: 'https://jdih.kemhan.go.id', interval: 60, timeout: 5000 },
  { name: 'Webmail Kemhan', url: 'https://mail.kemhan.go.id', interval: 60, timeout: 5000 },
  { name: 'PPID Kemhan', url: 'https://ppid.kemhan.go.id', interval: 60, timeout: 5000 },
  { name: 'VAPT Kemhan', url: 'https://vapt.kemhan.go.id', interval: 60, timeout: 5000 },
  { name: 'KMS BPSDM Kemhan', url: 'https://kms-bpsdm.kemhan.go.id', interval: 60, timeout: 5000 },
  { name: 'CAT Ropeg Kemhan', url: 'https://cat.ropeg.kemhan.go.id', interval: 60, timeout: 4000 },
  { name: 'Perizinan Kemhan', url: 'https://perizinan.kemhan.go.id', interval: 60, timeout: 4000 },
  { name: 'Pothan Kemhan', url: 'https://pothan.kemhan.go.id', interval: 60, timeout: 4000 },
  { name: 'Pustaka Kemhan', url: 'https://pustaka.kemhan.go.id', interval: 60, timeout: 4000 },
  { name: 'Veteran Kemhan', url: 'https://veteran.kemhan.go.id', interval: 60, timeout: 4000 },
  { name: 'CLINT Kemhan', url: 'https://clint.kemhan.go.id', interval: 60, timeout: 3000 },
  { name: 'Otakah Kemhan', url: 'https://otakah.kemhan.go.id', interval: 60, timeout: 3000 },
  { name: 'Comcad Kemhan', url: 'https://comcad.kemhan.go.id', interval: 60, timeout: 3000 },
  { name: 'IPOC Kemhan', url: 'https://ipoc.kemhan.go.id', interval: 60, timeout: 3000 },
  { name: 'Balitbang Kemhan', url: 'https://balitbang.kemhan.go.id', interval: 60, timeout: 3000 },
  { name: 'Badiklat Kemhan', url: 'https://badiklat.kemhan.go.id', interval: 60, timeout: 3000 },
  { name: 'Strahan Kemhan', url: 'https://strahan.kemhan.go.id', interval: 60, timeout: 3000 },
  { name: 'Renhan Kemhan', url: 'https://renhan.kemhan.go.id', interval: 60, timeout: 3000 },
  { name: 'Baranahan Kemhan', url: 'https://baranahan.kemhan.go.id', interval: 60, timeout: 3000 },
  { name: 'Bainstrahan Kemhan', url: 'https://bainstrahan.kemhan.go.id', interval: 60, timeout: 3000 }
];

async function populateAndInitialCheck() {
  console.log('--- Menambahkan Website Kemhan ke Database ---');

  const existingMonitors = db.getAllMonitors();
  const existingUrls = new Set(existingMonitors.map(m => m.url.replace(/\/$/, '')));

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
      console.log(`[+ Added] ${site.name} (${site.url}) - ID: ${id}`);
    } else {
      console.log(`[Exists] ${site.name} sudah terdaftar.`);
    }
  }

  console.log('\n--- Melakukan Pengecekan Awal Agar Langsung Muncul Statusnya ---');
  // Check in small batches
  const allCurrent = db.getAllMonitors();
  for (const m of allCurrent) {
    // Only check if it has no status or is unknown
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

  console.log('\nSelesai! Seluruh website berhasil ditambahkan dan dicek.');
}

populateAndInitialCheck();
