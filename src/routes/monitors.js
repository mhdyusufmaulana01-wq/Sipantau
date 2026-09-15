const express = require('express');
const { db } = require('../db/client');
const { requireAuth, requireAdmin } = require('../middleware/authGuard');

const router = express.Router();

/**
 * Validasi data monitor dari request body.
 * @returns {string|null} Pesan error, atau null jika valid.
 */
function validateMonitorInput(body) {
  const { name, url, interval_seconds, timeout_ms, retry_count } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return 'Nama website wajib diisi';
  }
  if (name.trim().length > 200) {
    return 'Nama website maksimal 200 karakter';
  }
  if (!url || typeof url !== 'string') {
    return 'URL wajib diisi';
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'URL harus menggunakan protokol http atau https';
    }
  } catch {
    return 'Format URL tidak valid. Contoh: https://kemhan.go.id';
  }
  if (interval_seconds !== undefined) {
    const iv = Number(interval_seconds);
    if (isNaN(iv) || iv < 10 || iv > 86400) {
      return 'Interval harus antara 10 detik (10) hingga 1 hari (86400)';
    }
  }
  if (timeout_ms !== undefined) {
    const to = Number(timeout_ms);
    if (isNaN(to) || to < 1000 || to > 30000) {
      return 'Timeout harus antara 1000ms hingga 30000ms';
    }
  }
  if (retry_count !== undefined) {
    const rc = Number(retry_count);
    if (isNaN(rc) || rc < 0 || rc > 10) {
      return 'Jumlah retry harus antara 0 hingga 10';
    }
  }
  return null;
}

// GET /api/monitors/dashboard — Data dashboard publik
router.get('/dashboard', (req, res) => {
  try {
    const data = db.getDashboardData();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Monitors] Error fetching dashboard:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// GET /api/monitors — Daftar semua monitor
// [SECURITY FIX] Temuan #5: Tambah requireAdmin agar field sensitif (notes,
// expected_keyword) tidak bocor ke role viewer yang mungkin keamanannya lebih longgar.
// Viewer sudah punya endpoint publik /dashboard untuk kebutuhan tampilannya.
router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const monitors = db.getAllMonitors();
    res.json({ success: true, data: monitors });
  } catch (error) {
    console.error('[Monitors] Error fetching monitors:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// GET /api/monitors/:id — Detail satu monitor
// [SECURITY FIX] Temuan #5: Samakan dengan GET / — field sensitif (notes,
// expected_keyword) tidak boleh bocor ke role viewer lewat endpoint detail per-ID.
router.get('/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID tidak valid' });

    const monitor = db.getMonitorById(id);
    if (!monitor) {
      return res.status(404).json({ success: false, error: 'Monitor tidak ditemukan' });
    }
    res.json({ success: true, data: monitor });
  } catch (error) {
    console.error('[Monitors] Error fetching monitor detail:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// GET /api/monitors/:id/history — Riwayat pengecekan dengan pagination
router.get('/:id/history', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID tidak valid' });

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500); // max 500
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const history = db.getCheckHistory(id, limit, offset);
    res.json({ success: true, data: history, meta: { limit, offset, count: history.length } });
  } catch (error) {
    console.error('[Monitors] Error fetching history:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// POST /api/monitors — Tambah monitor baru (Admin only)
router.post('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const validationError = validateMonitorInput(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const newId = db.addMonitor(req.body);
    const newMonitor = db.getMonitorById(newId);
    res.status(201).json({ success: true, data: newMonitor });
  } catch (error) {
    console.error('[Monitors] Error adding monitor:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// PUT /api/monitors/:id — Edit monitor (Admin only)
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID tidak valid' });

    const existing = db.getMonitorById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Monitor tidak ditemukan' });
    }

    const validationError = validateMonitorInput({ ...existing, ...req.body });
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const updateData = { ...existing, ...req.body };
    db.updateMonitorDetails(id, updateData);

    const updatedMonitor = db.getMonitorById(id);
    res.json({ success: true, data: updatedMonitor });
  } catch (error) {
    console.error('[Monitors] Error updating monitor:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// DELETE /api/monitors/:id — Hapus monitor (Admin only)
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID tidak valid' });

    const existing = db.getMonitorById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Monitor tidak ditemukan' });
    }

    db.deleteMonitor(id);
    res.json({ success: true, message: 'Monitor berhasil dihapus' });
  } catch (error) {
    console.error('[Monitors] Error deleting monitor:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// ============================================================
// [FEAT] PATCH /api/monitors/:id/toggle-active — Pause / Resume cepat
// Tanpa perlu membuka modal edit lengkap.
// ============================================================
router.patch('/:id/toggle-active', requireAuth, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID tidak valid' });

    const existing = db.getMonitorById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Monitor tidak ditemukan' });
    }

    const newActiveState = existing.is_active === 1 ? 0 : 1;
    db.updateMonitorDetails(id, { ...existing, is_active: newActiveState });

    const updated = db.getMonitorById(id);
    const stateLabel = newActiveState === 1 ? 'diaktifkan (Resume)' : 'dijeda (Pause)';
    console.log(`[Monitors] ${existing.name} ${stateLabel}.`);
    res.json({ success: true, data: updated, message: `Monitor berhasil ${stateLabel}` });
  } catch (error) {
    console.error('[Monitors] Error toggling monitor active state:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// ============================================================
// [FEAT] GET /api/monitors/:id/export — Export riwayat pengecekan sebagai CSV
// Mendukung parameter query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// ============================================================
router.get('/:id/export', requireAuth, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID tidak valid' });

    const monitor = db.getMonitorById(id);
    if (!monitor) {
      return res.status(404).json({ success: false, error: 'Monitor tidak ditemukan' });
    }

    // Validasi parameter tanggal opsional
    const { from, to } = req.query;
    let whereClause = 'WHERE monitor_id = ?';
    const params = [id];

    if (from) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        return res.status(400).json({ success: false, error: 'Format parameter "from" harus YYYY-MM-DD' });
      }
      whereClause += ' AND checked_at >= ?';
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ success: false, error: 'Format parameter "to" harus YYYY-MM-DD' });
      }
      whereClause += ' AND checked_at <= ?';
      params.push(`${to} 23:59:59`);
    }

    const rows = db.db.prepare(
      `SELECT checked_at, status, root_cause, detail_message, response_time_ms, http_status_code, dns_ok, tcp_ok, ssl_valid, ssl_expiry_date, ssl_subject, ssl_issuer
       FROM check_results ${whereClause} ORDER BY checked_at DESC, id DESC LIMIT 10000`
    ).all(...params);

    // Helper format waktu SQLite (UTC) ke WIB (Asia/Jakarta)
    const formatWib = (dateStr) => {
      if (!dateStr) return '-';
      try {
        const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return dateStr;
        return new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(d).replace('T', ' ');
      } catch {
        return dateStr;
      }
    };

    // Helper format SSL Expiry Date ke format standar YYYY-MM-DD HH:mm:ss WIB
    const formatSslDate = (sslStr) => {
      if (!sslStr) return '-';
      try {
        const d = new Date(sslStr);
        if (isNaN(d.getTime())) return sslStr;
        return new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(d).replace('T', ' ');
      } catch {
        return sslStr;
      }
    };

    // Helper sanitasi & escaping nilai CSV
    const escapeCsv = (val) => {
      if (val === null || val === undefined || val === '') return '-';
      const str = String(val).trim();
      if (str === '') return '-';
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Header CSV
    const headers = [
      'Waktu Pengecekan (WIB)',
      'Status',
      'Akar Masalah',
      'Detail Error',
      'Response Time (ms)',
      'HTTP Status',
      'DNS Status',
      'TCP Status',
      'SSL Status',
      'SSL Kedaluwarsa (WIB)',
      'Domain SSL',
      'Penerbit SSL'
    ];
    const csvHeader = headers.join(',') + '\r\n';

    const csvRows = rows.map(r => {
      const rootCause = (!r.root_cause || r.root_cause === 'NONE') ? '-' : r.root_cause;
      const detailMsg = (!r.detail_message || r.detail_message.trim() === '') ? '-' : r.detail_message;
      const sslValid = r.ssl_valid === null ? 'N/A' : (r.ssl_valid ? 'Valid' : 'Invalid');

      return [
        escapeCsv(formatWib(r.checked_at)),
        escapeCsv(r.status),
        escapeCsv(rootCause),
        escapeCsv(detailMsg),
        r.response_time_ms !== null && r.response_time_ms !== undefined ? r.response_time_ms : '-',
        r.http_status_code || '-',
        r.dns_ok ? 'OK' : 'Gagal',
        r.tcp_ok ? 'OK' : 'Gagal',
        sslValid,
        escapeCsv(formatSslDate(r.ssl_expiry_date)),
        escapeCsv(r.ssl_subject || '-'),
        escapeCsv(r.ssl_issuer || '-')
      ].join(',');
    }).join('\r\n');

    const filename = `SIPANTAU_${monitor.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Berikan UTF-8 BOM + sep=, agar Microsoft Excel Windows otomatis membagi kolom ke sel A, B, C...
    res.send('\uFEFFsep=,\r\n' + csvHeader + csvRows);

  } catch (error) {
    console.error('[Monitors] Error exporting CSV:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// ============================================================
// [FEAT] GET /api/monitors/:id/defacement-scans — Riwayat deep-scan
// pemindaian subhalaman untuk indikasi defacement (Admin only)
// ============================================================
router.get('/:id/defacement-scans', requireAuth, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID tidak valid' });

    const monitor = db.getMonitorById(id);
    if (!monitor) {
      return res.status(404).json({ success: false, error: 'Monitor tidak ditemukan' });
    }

    const scans = db.getDefacementScans(id).map((s) => ({
      ...s,
      flagged_urls: JSON.parse(s.flagged_urls || '[]'),
    }));

    res.json({ success: true, data: scans });
  } catch (error) {
    console.error('[Monitors] Error fetching defacement scans:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

module.exports = router;

