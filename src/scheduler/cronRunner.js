const cron = require('node-cron');
const { db } = require('../db/client');
const { checkWebsite } = require('../engine/index');
const { scanSiteForDefacement } = require('../engine/deepScan');
const { extractRegistrableDomain, checkDomainExpiry } = require('../engine/domainCheck');
const notifier = require('../services/notifier');

let task = null;
let isRunning = false;

// Batas jumlah monitor yang dicek secara bersamaan (untuk mencegah overload)
const MAX_CONCURRENT_CHECKS = 15;

// [PERF FIX] Kebijakan retensi data: hapus data lebih dari 90 hari
const DATA_RETENTION_DAYS = 90;

// [FEAT] Ambang batas (hari) untuk peringatan dini SSL akan kedaluwarsa,
// diurutkan dari paling longgar ke paling mendesak.
const SSL_WARNING_THRESHOLDS_DAYS = [30, 14, 7, 3, 1];

/**
 * Jalankan daftar task dengan batas concurrency.
 * Menghindari pembukaan ratusan koneksi HTTP/DNS sekaligus.
 * @param {Array<Function>} taskFns - Array fungsi async yang akan dijalankan
 * @param {number} limit - Jumlah maksimal task yang berjalan bersamaan
 */
async function runWithConcurrencyLimit(taskFns, limit) {
  const results = [];
  for (let i = 0; i < taskFns.length; i += limit) {
    const batch = taskFns.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map((fn) => fn()));
    results.push(...batchResults);
  }
  return results;
}

/**
 * [FEAT] Hitung selisih waktu dalam format yang mudah dibaca.
 * @param {string} startDateStr - String tanggal dari SQLite (UTC)
 * @returns {string} Durasi dalam format "X jam Y menit" atau "X menit"
 */
function formatDowntimeDuration(startDateStr) {
  if (!startDateStr) return '';
  const startDate = new Date(startDateStr.replace(' ', 'T') + 'Z');
  const now = new Date();
  const diffMs = now - startDate;
  
  if (diffMs < 0) return '';
  
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours > 0) {
    return `${hours} jam ${minutes} menit`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes} menit`;
  }
  return 'beberapa detik';
}

function startScheduler() {
  console.log('[Scheduler] Dimulai. Memeriksa monitor yang jadwalnya tiba setiap 10 detik...');

  // Setiap 10 detik: periksa monitor mana yang sudah waktunya dicek
  task = cron.schedule('*/10 * * * * *', async () => {
    if (isRunning) return; // Cegah overlap jika satu siklus belum selesai
    isRunning = true;

    try {
      const dueMonitors = db.getMonitorsDueForCheck();

      if (dueMonitors.length > 0) {
        console.log(`[Scheduler] ${dueMonitors.length} monitor perlu dicek.`);
      }

      // Buat array fungsi task (bukan langsung dijalankan)
      const taskFns = dueMonitors.map((monitor) => async () => {
        try {
          const result = await checkWebsite(monitor);

          db.addCheckResult({
            monitor_id: monitor.id,
            ...result,
          });

          // Deteksi perubahan status untuk memicu notifikasi
          const prevStatus = monitor.status;
          const newStatus = result.status;

          if (prevStatus && prevStatus !== newStatus) {
            console.log(`[Scheduler] Perubahan status: ${monitor.name} [${prevStatus} → ${newStatus}]`);

            if (newStatus === 'DOWN') {
              // [FEAT] Catat kapan mulai DOWN
              db.setDowntimeStarted(monitor.id);

              notifier.notifyDown(monitor, result).catch((e) =>
                console.error('[Scheduler] Error notifikasi DOWN:', e.message)
              );
            } else if (newStatus === 'UP' && prevStatus === 'DOWN') {
              // [FEAT] Hitung durasi downtime sebelum dihapus
              const downtimeStart = db.clearDowntimeStarted(monitor.id);
              const duration = formatDowntimeDuration(downtimeStart);

              notifier.notifyUp(monitor, result, duration).catch((e) =>
                console.error('[Scheduler] Error notifikasi UP:', e.message)
              );
            }
          }

          db.updateMonitorStatus(monitor.id, result.status);
          console.log(`[Scheduler] ✓ ${monitor.name} → ${result.status} (${result.response_time_ms || '-'}ms)`);
        } catch (err) {
          console.error(`[Scheduler] Error saat memeriksa ${monitor.name}:`, err.message);
        }
      });

      // Jalankan dengan batas concurrency
      await runWithConcurrencyLimit(taskFns, MAX_CONCURRENT_CHECKS);

    } catch (err) {
      console.error('[Scheduler] Error pada siklus pemeriksaan:', err.message);
    } finally {
      isRunning = false;
    }
  });

  // ============================================================
  // WAL CHECKPOINT: Jalankan setiap 1 jam untuk menjaga performa DB
  // ============================================================
  setInterval(() => {
    try {
      db.db.pragma('wal_checkpoint(PASSIVE)');
      console.log('[Scheduler] WAL checkpoint selesai.');
    } catch (e) {
      console.error('[Scheduler] Error WAL checkpoint:', e.message);
    }
  }, 60 * 60 * 1000); // setiap 1 jam

  // ============================================================
  // [PERF FIX] DATA RETENTION: Hapus data lama setiap 24 jam
  // Mencegah tabel check_results membengkak tak terbatas
  // ============================================================
  function runRetentionCleanup() {
    try {
      const deleted = db.purgeOldCheckResults(DATA_RETENTION_DAYS);
      if (deleted > 0) {
        console.log(`[Scheduler] Data retention: ${deleted} baris lama (>${DATA_RETENTION_DAYS} hari) dihapus.`);
      }
    } catch (e) {
      console.error('[Scheduler] Error data retention cleanup:', e.message);
    }
  }

  // Jalankan sekali saat startup, lalu tiap 24 jam
  runRetentionCleanup();
  setInterval(runRetentionCleanup, 24 * 60 * 60 * 1000);

  // Jalankan sekali saat startup, lalu tiap 24 jam
  runSslExpiryWarnings();
  setInterval(runSslExpiryWarnings, 24 * 60 * 60 * 1000);

  // [FEAT] Peringatan dini domain akan expired: jalan sekali saat startup,
  // lalu tiap 24 jam. Beda dari SSL warning (per monitor), ini per DOMAIN
  // INDUK -- banyak monitor berbagi 1 domain induk yang sama.
  runDomainExpiryWarnings();
  setInterval(runDomainExpiryWarnings, 24 * 60 * 60 * 1000);

  // [FEAT] Deep-scan defacement: sengaja BUKAN dijalankan langsung saat startup
  // (bisa puluhan request x banyak monitor sekaligus di saat server baru nyala,
  // lebih baik nunggu 5 menit dulu agar tidak menumpuk dengan startup lainnya),
  // lalu berjalan tiap 24 jam.
  setTimeout(runDeepDefacementScans, 5 * 60 * 1000);
  setInterval(runDeepDefacementScans, 24 * 60 * 60 * 1000);
}

/**
 * [FEAT] Peringatan dini DOMAIN akan expired (beda dari SSL_WARNING yang per
 * sertifikat). Dijalankan per DOMAIN INDUK unik -- kalau ada 15 monitor yang
 * semuanya subdomain dari "kemhan.go.id", WHOIS cuma di-query SEKALI untuk
 * domain itu (bukan 15x), dan notifikasinya menyebutkan semua monitor yang
 * ikut terdampak kalau domainnya sampai mati.
 *
 * Logika ambang batas & anti-spam SAMA PERSIS dengan runSslExpiryWarnings()
 * (30/14/7/3/1 hari, reset otomatis kalau domain sudah diperpanjang).
 */
async function runDomainExpiryWarnings() {
  try {
    const monitors = db.getAllActiveMonitors();

    // Kelompokkan monitor per domain induk (banyak subdomain -> 1 domain induk).
    const domainToMonitors = new Map();
    for (const monitor of monitors) {
      let hostname;
      try {
        hostname = new URL(monitor.url).hostname;
      } catch (e) {
        continue;
      }
      const domain = extractRegistrableDomain(hostname);
      if (!domain) continue;
      if (!domainToMonitors.has(domain)) domainToMonitors.set(domain, []);
      domainToMonitors.get(domain).push(monitor.name);
    }

    for (const [domain, monitorNames] of domainToMonitors.entries()) {
      const whoisResult = await checkDomainExpiry(domain);
      if (!whoisResult.success) {
        // TLD tidak didukung atau WHOIS gagal -- lewati diam-diam, bukan error fatal.
        continue;
      }

      db.upsertDomainExpiry(domain, whoisResult.expiryDate);

      const daysRemaining = Math.ceil((new Date(whoisResult.expiryDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysRemaining < 0) continue; // sudah expired -> harusnya sudah DNS_FAILED, jalur lain yang tangani

      const record = db.getDomainRegistration(domain);
      const isNewExpiry = !record || record.notified_expiry_date !== whoisResult.expiryDate;
      const lastNotifiedThreshold = isNewExpiry ? null : record.last_notified_days;

      let thresholdToNotify = null;
      for (const threshold of SSL_WARNING_THRESHOLDS_DAYS) {
        if (daysRemaining <= threshold) {
          if (lastNotifiedThreshold === null || lastNotifiedThreshold === undefined || threshold < lastNotifiedThreshold) {
            thresholdToNotify = threshold;
          }
        }
      }

      if (thresholdToNotify !== null) {
        console.log(`[Scheduler] Domain ${domain} tersisa ${daysRemaining} hari (ambang ${thresholdToNotify}) — kirim peringatan.`);
        try {
          await notifier.notifyDomainExpiring(domain, daysRemaining, whoisResult.expiryDate, monitorNames);
        } catch (e) {
          console.error('[Scheduler] Error notifikasi peringatan domain:', e.message);
        }
        db.markDomainNotified(domain, thresholdToNotify, whoisResult.expiryDate);
      }
    }
  } catch (e) {
    console.error('[Scheduler] Error saat memeriksa peringatan expiry domain:', e.message);
  }
}

/**
 * [FEAT] Deep-scan defacement ke SUBHALAMAN tiap situs (bukan cuma halaman
 * utama yang sudah dicek siklus cepat). Berjalan sekali sehari karena mahal
 * (puluhan request per situs) — beda dari cek cepat yang tiap beberapa detik.
 *
 * Monitor diproses satu-satu (bukan paralel) supaya beban ke server target
 * & ke sistem sendiri tetap ringan; delay antar-halaman sudah diatur di
 * dalam scanSiteForDefacement().
 */
async function runDeepDefacementScans() {
  console.log('[Scheduler] Memulai deep-scan defacement subhalaman...');
  try {
    const monitors = db.getAllActiveMonitors().filter((m) => m.check_defacement !== 0);

    for (const monitor of monitors) {
      try {
        const { pagesScanned, source, flaggedPages } = await scanSiteForDefacement(monitor.url);

        db.saveDefacementScan(monitor.id, {
          pagesScanned,
          pagesFlagged: flaggedPages.length,
          discoverySource: source,
          flaggedUrls: flaggedPages,
        });

        if (flaggedPages.length > 0) {
          console.log(`[Scheduler] 🚨 Deep-scan ${monitor.name}: ${flaggedPages.length}/${pagesScanned} halaman terindikasi defacement!`);
          try {
            await notifier.notifyDeepScanDefacement(monitor, flaggedPages, pagesScanned);
          } catch (e) {
            console.error('[Scheduler] Error notifikasi deep-scan defacement:', e.message);
          }
        } else {
          console.log(`[Scheduler] Deep-scan ${monitor.name}: ${pagesScanned} halaman diperiksa (sumber: ${source}), bersih.`);
        }
      } catch (e) {
        console.error(`[Scheduler] Error deep-scan ${monitor.name}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[Scheduler] Error pada siklus deep-scan defacement:', e.message);
  }
}

/**
 * [FEAT] Peringatan dini SSL akan kedaluwarsa.
 *
 * Berbeda dari SSL_CERT_EXPIRED (yang baru terdeteksi SETELAH sertifikat
 * benar-benar mati), job ini berjalan harian dan mengirim notifikasi
 * SEBELUM sertifikat kedaluwarsa — supaya engineer sempat memperpanjang
 * tanpa website sempat DOWN.
 *
 * Tidak spam: hanya mengirim sekali per ambang batas (30/14/7/3/1 hari) untuk
 * sertifikat yang sama. Kalau sertifikat sudah diperpanjang (expiry date-nya
 * berubah), status notifikasi otomatis reset dan siklus peringatan dimulai
 * ulang dari ambang batas paling longgar.
 */
async function runSslExpiryWarnings() {
  try {
    const monitors = db.getAllActiveMonitors();

    for (const monitor of monitors) {
      let isHttps = false;
      try {
        isHttps = new URL(monitor.url).protocol === 'https:';
      } catch (e) {
        continue; // URL tidak valid, lewati
      }
      if (!isHttps || monitor.ignore_ssl === 1) continue;

      const expiryDate = db.getLatestSslExpiry(monitor.id);
      if (!expiryDate) continue;

      const diffMs = new Date(expiryDate).getTime() - Date.now();
      const daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

      // Sudah expired: sudah ditangani jalur SSL_CERT_EXPIRED/notifyDown di siklus normal.
      if (daysRemaining < 0) continue;

      // Sertifikat baru (beda dari yang terakhir dinotifikasi) -> reset status notifikasi.
      const isNewCert = monitor.ssl_notified_expiry_date !== expiryDate;
      const lastNotifiedThreshold = isNewCert ? null : monitor.ssl_last_notified_days;

      // Cari ambang batas paling mendesak yang sudah terlampaui TAPI belum pernah dinotifikasi.
      let thresholdToNotify = null;
      for (const threshold of SSL_WARNING_THRESHOLDS_DAYS) {
        if (daysRemaining <= threshold) {
          if (lastNotifiedThreshold === null || lastNotifiedThreshold === undefined || threshold < lastNotifiedThreshold) {
            thresholdToNotify = threshold;
          }
        }
      }

      if (thresholdToNotify !== null) {
        console.log(`[Scheduler] SSL ${monitor.name} tersisa ${daysRemaining} hari (ambang ${thresholdToNotify}) — kirim peringatan.`);
        try {
          await notifier.notifySslExpiring(monitor, daysRemaining, expiryDate);
        } catch (e) {
          console.error('[Scheduler] Error notifikasi peringatan SSL:', e.message);
        }
        db.markSslNotified(monitor.id, thresholdToNotify, expiryDate);
      }
    }
  } catch (e) {
    console.error('[Scheduler] Error saat memeriksa peringatan expiry SSL:', e.message);
  }
}

function stopScheduler() {
  if (task) {
    task.stop();
    console.log('[Scheduler] Dihentikan.');
  }
}

module.exports = { startScheduler, stopScheduler };
