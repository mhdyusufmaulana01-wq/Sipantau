const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { db } = require('../db/client');
const { JWT_SECRET, requireAuth, requireAdmin } = require('../middleware/authGuard');

const router = express.Router();

// ============================================================
// RATE LIMITER: Batasi percobaan login untuk mencegah brute force
// Maksimal 10 percobaan dalam 15 menit dari IP yang sama
// ============================================================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Terlalu banyak percobaan login dari alamat ini. Silakan coba lagi dalam 15 menit.',
  },
  // Gunakan ipKeyGenerator (mendukung IPv6) yang disediakan oleh library
  keyGenerator: (req) => ipKeyGenerator(req),
});


router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username dan password wajib diisi' });
    }

    const user = db.getUserByUsername(username);
    if (!user) {
      // Gunakan pesan yang sama untuk mencegah user enumeration
      return res.status(401).json({ success: false, error: 'Username atau password salah' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Username atau password salah' });
    }

    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      tv: user.token_version || 0,
    };

    const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn });

    res.json({
      success: true,
      data: {
        token,
        user: payload,
      },
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// ============================================================
// PUT /api/auth/password — Ganti password akun sendiri (user login)
// ============================================================
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Password saat ini dan password baru wajib diisi' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password baru minimal 8 karakter' });
    }

    const user = db.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Password saat ini salah' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    db.updateUserPassword(user.id, newHash);

    // token_version baru saja naik di DB, jadi token yang sedang dipakai
    // request ini pun otomatis tidak valid lagi pada request berikutnya —
    // client wajib login ulang untuk dapat token baru.
    res.json({ success: true, message: 'Password berhasil diganti. Silakan login ulang.' });
  } catch (error) {
    console.error('[Auth] Change password error:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// ============================================================
// MANAJEMEN USER (Admin only)
// ============================================================

// GET /api/auth/users — Daftar semua user
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const users = db.getAllUsers();
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('[Auth] Error fetching users:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// POST /api/auth/users — Tambah user baru
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Username minimal 3 karakter' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password minimal 8 karakter' });
    }
    if (!['admin', 'viewer'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Role harus "admin" atau "viewer"' });
    }

    const existing = db.getUserByUsername(username.trim());
    if (existing) {
      return res.status(409).json({ success: false, error: 'Username sudah digunakan' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newId = db.createUser(username.trim(), passwordHash, role);
    res.status(201).json({ success: true, data: { id: newId, username: username.trim(), role } });
  } catch (error) {
    console.error('[Auth] Error creating user:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

// DELETE /api/auth/users/:id — Hapus user
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID tidak valid' });

    const target = db.getUserById(id);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ success: false, error: 'Tidak bisa menghapus akun sendiri' });
    }
    if (target.role === 'admin' && db.countAdmins() <= 1) {
      return res.status(400).json({ success: false, error: 'Tidak bisa menghapus admin terakhir' });
    }

    db.deleteUser(id);
    res.json({ success: true, message: 'User berhasil dihapus' });
  } catch (error) {
    console.error('[Auth] Error deleting user:', error.message);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server' });
  }
});

module.exports = router;
