const express = require('express');
const { db } = require('../db/client');
const { requireAuth, requireAdmin } = require('../middleware/authGuard');
const { sendTestNotification } = require('../services/notifier');

const router = express.Router();

/**
 * Validasi input pengaturan notifikasi untuk mencegah SSRF dan data tidak valid.
 * Digunakan di endpoint simpan settings DAN endpoint test notification.
 * @returns {string|null} Pesan error, atau null jika valid.
 */
function validateNotificationSettings(body) {
  // Normalisasi: endpoint /test menggunakan key berbeda (webhookUrl vs webhook_url)
  const webhook_url = body.webhook_url || body.webhookUrl;
  const telegram_chat_id = body.telegram_chat_id || body.chatId;

  // Validasi webhook URL jika diisi
  if (webhook_url && webhook_url.trim() !== '') {
    try {
      const parsed = new URL(webhook_url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return 'Webhook URL harus menggunakan protokol http atau https';
      }
      // [SECURITY FIX] Temuan #3: Perluas daftar blokir SSRF
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||                        // IPv6 loopback
        hostname === '0.0.0.0' ||                    // Wildcard bind address
        hostname === '169.254.169.254' ||            // Metadata endpoint cloud (AWS/GCP/Azure)
        hostname.startsWith('192.168.') ||           // RFC 1918 private: 192.168.0.0/16
        hostname.startsWith('10.') ||                // RFC 1918 private: 10.0.0.0/8
        hostname.endsWith('.local') ||               // mDNS / zeroconf local
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) // RFC 1918 private: 172.16.0.0/12
      ) {
        return 'Webhook URL tidak boleh mengarah ke alamat jaringan internal atau metadata server';
      }
    } catch {
      return 'Format Webhook URL tidak valid. Contoh: https://hooks.slack.com/...';
    }
  }

  // Validasi Telegram Chat ID (harus numerik jika diisi)
  if (telegram_chat_id && telegram_chat_id.trim() !== '') {
    if (!/^-?\d+$/.test(telegram_chat_id.trim())) {
      return 'Telegram Chat ID harus berupa angka (positif untuk user, negatif untuk grup)';
    }
  }

  return null;
}

// GET /api/notifications/settings - Get settings (Admin only)
router.get('/settings', requireAuth, requireAdmin, (req, res) => {
  try {
    const settings = db.getNotificationSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/notifications/settings - Save settings (Admin only)
router.post('/settings', requireAuth, requireAdmin, (req, res) => {
  try {
    // [SECURITY FIX] Validasi input sebelum disimpan
    const validationError = validateNotificationSettings(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const updated = db.saveNotificationSettings(req.body);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/notifications/test - Test notification (Admin only)
router.post('/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    // [SECURITY FIX] Temuan #3: Terapkan validasi SSRF yang sama seperti di endpoint /settings
    // agar tombol "Kirim Pesan Tes" tidak bisa digunakan sebagai bypass proteksi SSRF.
    const validationError = validateNotificationSettings(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const { botToken, chatId, webhookUrl } = req.body;
    const results = await sendTestNotification({ botToken, chatId, webhookUrl });
    res.json({ success: true, results });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

