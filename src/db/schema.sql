-- [BUG FIX] File ini sebelumnya ketinggalan jauh dari skema sebenarnya --
-- banyak kolom (http_method, notes, token_version, security_header_score,
-- dst.) cuma ditambahkan lewat ALTER TABLE di db/client.js init(), tidak
-- pernah tercermin di sini. Untuk instalasi BARU, kolom-kolom itu sekarang
-- langsung didefinisikan di CREATE TABLE (lebih cepat & schema.sql jadi
-- dokumentasi yang akurat). Statement ALTER TABLE di db/client.js TETAP
-- dipertahankan (dibungkus try/catch, jadi aman/idempoten) supaya database
-- LAMA yang sudah ada datanya (dibuat sebelum kolom ini ditambahkan) tetap
-- otomatis ter-upgrade skemanya saat aplikasi start.

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    -- [FEAT] Dinaikkan tiap kali password diganti, agar JWT lama yang mungkin
    -- bocor otomatis tidak valid lagi (token revocation).
    token_version INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    interval_seconds INTEGER DEFAULT 60,
    timeout_ms INTEGER DEFAULT 5000,
    retry_count INTEGER DEFAULT 3,
    retry_delay_ms INTEGER DEFAULT 2000,
    is_active BOOLEAN DEFAULT 1,
    status TEXT DEFAULT 'UNKNOWN',
    last_checked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Opsi lanjutan konfigurasi pengecekan
    http_method TEXT DEFAULT 'GET',
    ignore_ssl INTEGER DEFAULT 0,
    accepted_status_codes TEXT DEFAULT '200-299',
    category TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    -- [FEAT] Downtime duration tracking
    downtime_started_at DATETIME,
    -- [FEAT] Keyword & Anti-Defacement Monitoring
    expected_keyword TEXT DEFAULT '',
    check_defacement INTEGER DEFAULT 1,
    -- [FEAT] Peringatan dini SSL akan kedaluwarsa: lacak ambang batas (hari)
    -- yang terakhir dinotifikasi & untuk tanggal expiry yang mana, supaya
    -- tidak mengirim notifikasi berulang untuk sertifikat yang sama.
    ssl_last_notified_days INTEGER,
    ssl_notified_expiry_date DATETIME
);

CREATE TABLE IF NOT EXISTS check_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL,
    status TEXT,
    root_cause TEXT,
    detail_message TEXT,
    dns_ok BOOLEAN,
    tcp_ok BOOLEAN,
    http_status_code INTEGER,
    response_time_ms INTEGER,
    ssl_valid BOOLEAN,
    ssl_expiry_date DATETIME,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- [FEAT] Detail sertifikat SSL
    ssl_subject TEXT DEFAULT '',
    ssl_issuer TEXT DEFAULT '',
    -- [FEAT] Security Header Score: skor 0-100 & daftar header yang hilang
    -- (JSON array), dianalisis dari response HTTP yang sudah diambil tiap
    -- cek uptime -- bukan request terpisah.
    security_header_score INTEGER,
    security_headers_missing TEXT DEFAULT '[]',
    FOREIGN KEY(monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);

-- Pengaturan notifikasi (Telegram & Webhook), key-value generik.
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- [FEAT] Peringatan dini domain akan expired. Per DOMAIN INDUK (bukan per
-- monitor) -- banyak subdomain (vapt.kemhan.go.id, mail.kemhan.go.id, dst.)
-- berbagi 1 domain induk (kemhan.go.id) yang sama-sama akan mati bareng
-- kalau domainnya lupa diperpanjang, jadi cukup dicek & dinotifikasi sekali.
CREATE TABLE IF NOT EXISTS domain_registrations (
    domain TEXT PRIMARY KEY,
    expiry_date DATETIME,
    last_checked_at DATETIME,
    last_notified_days INTEGER,
    notified_expiry_date DATETIME
);

-- [FEAT] Riwayat deep-scan defacement (pemindaian subhalaman situs, berkala
-- tiap 24 jam -- terpisah dari cek cepat yang hanya menyentuh halaman utama).
CREATE TABLE IF NOT EXISTS defacement_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL,
    scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    pages_scanned INTEGER DEFAULT 0,
    pages_flagged INTEGER DEFAULT 0,
    discovery_source TEXT DEFAULT 'none',
    flagged_urls TEXT DEFAULT '[]',
    FOREIGN KEY(monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);
