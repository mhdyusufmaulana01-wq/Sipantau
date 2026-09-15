CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer'
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    FOREIGN KEY(monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);
