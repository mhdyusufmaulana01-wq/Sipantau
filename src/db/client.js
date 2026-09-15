const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { extractRegistrableDomain } = require('../engine/domainCheck');

class DbClient {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  init() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    
    // Dynamically add new advanced columns if they don't exist
    try { this.db.exec("ALTER TABLE monitors ADD COLUMN http_method TEXT DEFAULT 'GET'"); } catch (e) {}
    try { this.db.exec("ALTER TABLE monitors ADD COLUMN ignore_ssl INTEGER DEFAULT 0"); } catch (e) {}
    try { this.db.exec("ALTER TABLE monitors ADD COLUMN accepted_status_codes TEXT DEFAULT '200-299'"); } catch (e) {}
    try { this.db.exec("ALTER TABLE monitors ADD COLUMN category TEXT DEFAULT ''"); } catch (e) {}
    try { this.db.exec("ALTER TABLE monitors ADD COLUMN notes TEXT DEFAULT ''"); } catch (e) {}
    // [FEAT] Kolom untuk downtime duration tracking
    try { this.db.exec('ALTER TABLE monitors ADD COLUMN downtime_started_at DATETIME'); } catch (e) {}
    // [FEAT] Kolom SSL detail untuk check_results
    try { this.db.exec("ALTER TABLE check_results ADD COLUMN ssl_subject TEXT DEFAULT ''"); } catch (e) {}
    try { this.db.exec("ALTER TABLE check_results ADD COLUMN ssl_issuer TEXT DEFAULT ''"); } catch (e) {}
    // [FEAT] Kolom untuk Keyword & Anti-Defacement Monitoring
    try { this.db.exec("ALTER TABLE monitors ADD COLUMN expected_keyword TEXT DEFAULT ''"); } catch (e) {}
    try { this.db.exec("ALTER TABLE monitors ADD COLUMN check_defacement INTEGER DEFAULT 1"); } catch (e) {}
    // [FEAT] token_version: dinaikkan setiap kali password user diganti, agar
    // JWT lama yang mungkin bocor otomatis tidak valid lagi (revocation).
    try { this.db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0'); } catch (e) {}
    // [FEAT] Peringatan dini SSL akan kedaluwarsa: lacak ambang batas (hari)
    // yang terakhir kali dinotifikasi & untuk tanggal expiry yang mana, agar
    // tidak mengirim notifikasi berulang-ulang untuk sertifikat yang sama.
    try { this.db.exec('ALTER TABLE monitors ADD COLUMN ssl_last_notified_days INTEGER'); } catch (e) {}
    try { this.db.exec('ALTER TABLE monitors ADD COLUMN ssl_notified_expiry_date DATETIME'); } catch (e) {}
    // [FEAT] Security Header Score: skor 0-100 & daftar header yang hilang,
    // dianalisis dari response HTTP yang sudah diambil tiap cek uptime.
    try { this.db.exec('ALTER TABLE check_results ADD COLUMN security_header_score INTEGER'); } catch (e) {}
    try { this.db.exec("ALTER TABLE check_results ADD COLUMN security_headers_missing TEXT DEFAULT '[]'"); } catch (e) {}

    // [FEAT] Peringatan dini domain akan expired. Per DOMAIN INDUK (bukan per
    // monitor) -- banyak subdomain (vapt.kemhan.go.id, mail.kemhan.go.id, dst.)
    // berbagi 1 domain induk (kemhan.go.id) yang sama-sama akan mati bareng
    // kalau domainnya lupa diperpanjang, jadi cukup dicek & dinotifikasi sekali.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS domain_registrations (
        domain TEXT PRIMARY KEY,
        expiry_date DATETIME,
        last_checked_at DATETIME,
        last_notified_days INTEGER,
        notified_expiry_date DATETIME
      )
    `);

    // [FEAT] Riwayat deep-scan defacement (pemindaian subhalaman situs).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS defacement_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER NOT NULL,
        scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        pages_scanned INTEGER DEFAULT 0,
        pages_flagged INTEGER DEFAULT 0,
        discovery_source TEXT DEFAULT 'none',
        flagged_urls TEXT DEFAULT '[]',
        FOREIGN KEY(monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
      )
    `);

    // Settings table for notifications (Telegram & Webhook)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
  }

  // --- Notification Settings ---
  getNotificationSettings() {
    const rows = this.db.prepare('SELECT key, value FROM system_settings').all();
    const settings = {
      telegram_enabled: false,
      telegram_bot_token: '',
      telegram_chat_id: '',
      webhook_enabled: false,
      webhook_url: ''
    };
    for (const r of rows) {
      if (r.key === 'telegram_enabled') settings.telegram_enabled = r.value === '1';
      else if (r.key === 'webhook_enabled') settings.webhook_enabled = r.value === '1';
      else settings[r.key] = r.value;
    }
    return settings;
  }

  saveNotificationSettings(settings) {
    const upsert = this.db.prepare(`
      INSERT INTO system_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    
    const trx = this.db.transaction(() => {
      if (settings.telegram_enabled !== undefined) {
        upsert.run('telegram_enabled', settings.telegram_enabled ? '1' : '0');
      }
      if (settings.telegram_bot_token !== undefined) {
        upsert.run('telegram_bot_token', settings.telegram_bot_token.trim());
      }
      if (settings.telegram_chat_id !== undefined) {
        upsert.run('telegram_chat_id', settings.telegram_chat_id.trim());
      }
      if (settings.webhook_enabled !== undefined) {
        upsert.run('webhook_enabled', settings.webhook_enabled ? '1' : '0');
      }
      if (settings.webhook_url !== undefined) {
        upsert.run('webhook_url', settings.webhook_url.trim());
      }
    });
    
    trx();
    return this.getNotificationSettings();
  }

  // --- Users ---
  getUserByUsername(username) {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  }

  getUserById(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  getAllUsers() {
    return this.db.prepare('SELECT id, username, role FROM users ORDER BY id ASC').all();
  }

  countAdmins() {
    return this.db.prepare("SELECT count(*) as c FROM users WHERE role = 'admin'").get().c;
  }

  createUser(username, passwordHash, role = 'viewer') {
    const stmt = this.db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
    return stmt.run(username, passwordHash, role).lastInsertRowid;
  }

  /**
   * [FEAT] Ganti password user & naikkan token_version agar semua JWT
   * lama milik user ini otomatis tidak valid lagi (paksa login ulang).
   */
  updateUserPassword(id, newPasswordHash) {
    this.db.prepare(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?'
    ).run(newPasswordHash, id);
  }

  deleteUser(id) {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  // --- Monitors ---
  getAllMonitors() {
    return this.db.prepare('SELECT * FROM monitors ORDER BY id DESC').all();
  }

  getAllActiveMonitors() {
    return this.db.prepare('SELECT * FROM monitors WHERE is_active = 1').all();
  }
  
  getMonitorsDueForCheck() {
    return this.db.prepare(`
      SELECT * FROM monitors 
      WHERE is_active = 1 
      AND (
        last_checked_at IS NULL 
        OR (CAST(strftime('%s', 'now') AS INTEGER) - CAST(strftime('%s', last_checked_at) AS INTEGER)) >= interval_seconds
      )
    `).all();
  }

  getMonitorById(id) {
    return this.db.prepare('SELECT * FROM monitors WHERE id = ?').get(id);
  }

  addMonitor(monitor) {
    const stmt = this.db.prepare(`
      INSERT INTO monitors (
        name, url, interval_seconds, timeout_ms, retry_count, retry_delay_ms, is_active,
        http_method, ignore_ssl, accepted_status_codes, category, notes, expected_keyword, check_defacement
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      monitor.name,
      monitor.url,
      monitor.interval_seconds ?? 60,
      monitor.timeout_ms ?? 5000,
      monitor.retry_count ?? 3,
      monitor.retry_delay_ms ?? 2000,
      monitor.is_active !== undefined ? (monitor.is_active ? 1 : 0) : 1,
      monitor.http_method || 'GET',
      monitor.ignore_ssl ? 1 : 0,
      monitor.accepted_status_codes || '200-299',
      monitor.category || '',
      monitor.notes || '',
      monitor.expected_keyword || '',
      monitor.check_defacement !== undefined ? (monitor.check_defacement ? 1 : 0) : 1
    );
    return info.lastInsertRowid;
  }

  updateMonitorDetails(id, monitor) {
    const stmt = this.db.prepare(`
      UPDATE monitors 
      SET name = ?, url = ?, interval_seconds = ?, timeout_ms = ?, retry_count = ?, retry_delay_ms = ?, is_active = ?,
          http_method = ?, ignore_ssl = ?, accepted_status_codes = ?, category = ?, notes = ?, expected_keyword = ?, check_defacement = ?
      WHERE id = ?
    `);
    stmt.run(
      monitor.name,
      monitor.url,
      monitor.interval_seconds,
      monitor.timeout_ms,
      monitor.retry_count,
      monitor.retry_delay_ms,
      monitor.is_active ? 1 : 0,
      monitor.http_method || 'GET',
      monitor.ignore_ssl ? 1 : 0,
      monitor.accepted_status_codes || '200-299',
      monitor.category || '',
      monitor.notes || '',
      monitor.expected_keyword || '',
      monitor.check_defacement !== undefined ? (monitor.check_defacement ? 1 : 0) : 1,
      id
    );
  }

  updateMonitorStatus(id, status) {
    const stmt = this.db.prepare(`
      UPDATE monitors 
      SET status = ?, last_checked_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(status, id);
  }

  /**
   * [FEAT] Catat kapan downtime dimulai (saat status berubah → DOWN)
   */
  setDowntimeStarted(id) {
    this.db.prepare(
      'UPDATE monitors SET downtime_started_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(id);
  }

  /**
   * [FEAT] Hapus downtime_started_at (saat status pulih → UP)
   * Mengembalikan nilai downtime_started_at sebelum dihapus untuk perhitungan durasi.
   */
  clearDowntimeStarted(id) {
    const row = this.db.prepare('SELECT downtime_started_at FROM monitors WHERE id = ?').get(id);
    this.db.prepare('UPDATE monitors SET downtime_started_at = NULL WHERE id = ?').run(id);
    return row ? row.downtime_started_at : null;
  }

  deleteMonitor(id) {
    // Due to ON DELETE CASCADE, check_results will be deleted automatically
    this.db.prepare('DELETE FROM monitors WHERE id = ?').run(id);
  }

  /**
   * [FEAT] Ambil tanggal expiry SSL dari hasil pengecekan TERBARU yang punya
   * data SSL (ssl_expiry_date tidak null). Dipakai job peringatan dini SSL.
   */
  getLatestSslExpiry(monitorId) {
    // Tie-break dengan id DESC: checked_at (CURRENT_TIMESTAMP SQLite) hanya
    // presisi per detik, jadi dua insert dalam detik yang sama bisa punya
    // checked_at identik — id DESC memastikan baris yang benar-benar terakhir
    // di-insert yang terpilih, bukan bergantung urutan internal SQLite.
    const row = this.db.prepare(
      `SELECT ssl_expiry_date FROM check_results
       WHERE monitor_id = ? AND ssl_expiry_date IS NOT NULL
       ORDER BY checked_at DESC, id DESC LIMIT 1`
    ).get(monitorId);
    return row ? row.ssl_expiry_date : null;
  }

  /**
   * [FEAT] Catat ambang batas (hari) & tanggal expiry yang baru saja
   * dinotifikasi, supaya siklus berikutnya tidak mengirim ulang notifikasi
   * yang sama untuk sertifikat yang sama.
   */
  markSslNotified(monitorId, thresholdDays, expiryDate) {
    this.db.prepare(
      'UPDATE monitors SET ssl_last_notified_days = ?, ssl_notified_expiry_date = ? WHERE id = ?'
    ).run(thresholdDays, expiryDate, monitorId);
  }

  /**
   * [PERF FIX] Hapus data check_results yang lebih dari N hari.
   * Dipanggil dari scheduler secara berkala untuk mencegah database bloat.
   * @param {number} retentionDays - Jumlah hari data yang disimpan (default: 90)
   */
  purgeOldCheckResults(retentionDays = 90) {
    const result = this.db.prepare(
      `DELETE FROM check_results WHERE checked_at < datetime('now', '-${Math.abs(parseInt(retentionDays, 10))} days')`
    ).run();
    return result.changes;
  }

  // --- Check Results ---
  addCheckResult(result) {
    const stmt = this.db.prepare(`
      INSERT INTO check_results (
        monitor_id, status, root_cause, detail_message,
        dns_ok, tcp_ok, http_status_code, response_time_ms,
        ssl_valid, ssl_expiry_date, ssl_subject, ssl_issuer,
        security_header_score, security_headers_missing
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      result.monitor_id,
      result.status,
      result.root_cause,
      result.detail_message,
      result.dns_ok ? 1 : 0,
      result.tcp_ok ? 1 : 0,
      result.http_status_code,
      result.response_time_ms,
      result.ssl_valid === null ? null : (result.ssl_valid ? 1 : 0),
      result.ssl_expiry_date,
      result.ssl_subject || '',   // [FEAT] Detail SSL: domain/CN sertifikat
      result.ssl_issuer  || '',   // [FEAT] Detail SSL: penerbit sertifikat
      result.security_header_score === null || result.security_header_score === undefined ? null : result.security_header_score,
      JSON.stringify(result.security_headers_missing || [])
    );
  }

  getCheckHistory(monitorId, limit = 50, offset = 0) {
    // [BUG FIX] Tie-break id DESC, konsisten dengan query check_results lainnya.
    return this.db.prepare(`
      SELECT * FROM check_results
      WHERE monitor_id = ?
      ORDER BY checked_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(monitorId, limit, offset);
  }

  getDashboardData() {
    const monitors = this.getAllMonitors();
    const data = [];
    for (const m of monitors) {
      // Ambil 90 data terbaru untuk chart bars.
      // [BUG FIX] Tie-break dengan id DESC -- checked_at (CURRENT_TIMESTAMP
      // SQLite) cuma presisi per detik, jadi 2+ cek dalam detik yang sama bisa
      // salah urutan tanpa ini (sama seperti bug yang diperbaiki di getLatestSslExpiry()).
      const recent = this.db.prepare(
        `SELECT status, root_cause, detail_message, response_time_ms, checked_at, ssl_expiry_date,
                security_header_score, security_headers_missing
         FROM check_results WHERE monitor_id = ? ORDER BY checked_at DESC, id DESC LIMIT 90`
      ).all(m.id);

      // Hitung uptime berdasarkan 30 hari terakhir (lebih relevan secara operasional)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      const total30d = this.db.prepare(
        "SELECT count(*) as c FROM check_results WHERE monitor_id = ? AND checked_at >= ?"
      ).get(m.id, thirtyDaysAgo).c;
      const ups30d = this.db.prepare(
        "SELECT count(*) as c FROM check_results WHERE monitor_id = ? AND status = 'UP' AND checked_at >= ?"
      ).get(m.id, thirtyDaysAgo).c;

      // Fallback ke all-time jika belum ada data 30 hari
      let uptimePercent;
      if (total30d > 0) {
        uptimePercent = ((ups30d / total30d) * 100).toFixed(2);
      } else {
        const totalAll = this.db.prepare('SELECT count(*) as c FROM check_results WHERE monitor_id = ?').get(m.id).c;
        const upsAll = this.db.prepare("SELECT count(*) as c FROM check_results WHERE monitor_id = ? AND status = 'UP'").get(m.id).c;
        uptimePercent = totalAll > 0 ? ((upsAll / totalAll) * 100).toFixed(2) : '0.00';
      }

      // [FEAT] Security Header Score terbaru (dari hasil cek paling akhir yang
      // sempat menerima response HTTP — bisa null kalau monitor selalu DOWN
      // di tahap DNS/TCP/timeout sebelum sempat terima header apapun).
      const latestWithHeaders = recent.find((r) => r.security_header_score !== null && r.security_header_score !== undefined);
      const securityHeaderScore = latestWithHeaders ? latestWithHeaders.security_header_score : null;
      const securityHeadersMissing = latestWithHeaders ? JSON.parse(latestWithHeaders.security_headers_missing || '[]') : [];

      // [FEAT] Domain expiry (WHOIS) untuk monitor ini -- dari domain INDUK-nya
      // (banyak monitor bisa berbagi 1 domain induk, lihat runDomainExpiryWarnings()).
      let domainName = null;
      let domainExpiryDate = null;
      try {
        domainName = extractRegistrableDomain(new URL(m.url).hostname);
        if (domainName) {
          const domainRecord = this.getDomainRegistration(domainName);
          domainExpiryDate = domainRecord ? domainRecord.expiry_date : null;
        }
      } catch (e) { /* URL tidak valid, biarkan null */ }

      data.push({
        ...m,
        uptime_percent: uptimePercent,
        uptime_window: total30d > 0 ? '30d' : 'all-time',
        security_header_score: securityHeaderScore,
        security_headers_missing: securityHeadersMissing,
        domain_name: domainName,
        domain_expiry_date: domainExpiryDate,
        // [BUG FIX] Sama seperti security_header_score: pakai hasil TERAKHIR
        // yang benar-benar punya data SSL (bukan cek paling akhir mentah-mentah),
        // supaya tile "Sisa Masa Aktif SSL" tidak jadi N/A kalau kebetulan cek
        // paling akhir itu TCP_TIMEOUT/SSL_TIMEOUT (SSL check gak sempat jalan).
        ssl_expiry_date: this.getLatestSslExpiry(m.id),
        recent_checks: recent.reverse(), // Balik: kiri = lama, kanan = terbaru
      });
    }
    return data;
  }

  // --- Peringatan Dini Domain Expiry ---

  getDomainRegistration(domain) {
    return this.db.prepare('SELECT * FROM domain_registrations WHERE domain = ?').get(domain);
  }

  upsertDomainExpiry(domain, expiryDate) {
    this.db.prepare(`
      INSERT INTO domain_registrations (domain, expiry_date, last_checked_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(domain) DO UPDATE SET expiry_date = excluded.expiry_date, last_checked_at = CURRENT_TIMESTAMP
    `).run(domain, expiryDate);
  }

  markDomainNotified(domain, thresholdDays, expiryDate) {
    this.db.prepare(
      'UPDATE domain_registrations SET last_notified_days = ?, notified_expiry_date = ? WHERE domain = ?'
    ).run(thresholdDays, expiryDate, domain);
  }

  // --- Deep-Scan Defacement (subhalaman) ---

  /**
   * [FEAT] Simpan hasil satu siklus deep-scan defacement untuk sebuah monitor.
   */
  saveDefacementScan(monitorId, { pagesScanned, pagesFlagged, discoverySource, flaggedUrls }) {
    const stmt = this.db.prepare(`
      INSERT INTO defacement_scans (monitor_id, pages_scanned, pages_flagged, discovery_source, flagged_urls)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      monitorId,
      pagesScanned,
      pagesFlagged,
      discoverySource,
      JSON.stringify(flaggedUrls || [])
    );
    return info.lastInsertRowid;
  }

  /**
   * [FEAT] Ambil riwayat deep-scan defacement terbaru untuk sebuah monitor.
   */
  getDefacementScans(monitorId, limit = 20) {
    return this.db.prepare(
      `SELECT * FROM defacement_scans WHERE monitor_id = ? ORDER BY scanned_at DESC LIMIT ?`
    ).all(monitorId, limit);
  }

  close() {
    this.db.close();
  }
}

// Ensure data directory exists
// [TEST] SIPANTAU_DB_PATH memungkinkan test (routes/auth) memakai database
// sementara terpisah, bukan data.db produksi. Tidak pernah diset di
// deployment normal, jadi tidak mengubah perilaku produksi sama sekali.
const defaultDbPath = process.env.SIPANTAU_DB_PATH || path.join(__dirname, '../../data.db');
if (!fs.existsSync(path.dirname(defaultDbPath))) {
    fs.mkdirSync(path.dirname(defaultDbPath), { recursive: true });
}

let _dbInstance = null;
function getDb() {
  if (!_dbInstance) {
    _dbInstance = new DbClient(defaultDbPath);
  }
  return _dbInstance;
}

module.exports = { DbClient, get db() { return getDb(); } };
