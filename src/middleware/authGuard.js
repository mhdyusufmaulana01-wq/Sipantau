const jwt = require('jsonwebtoken');
const { db } = require('../db/client');

// [SECURITY FIX] Hapus fallback hardcoded — gunakan hanya dari environment variable
// app.js sudah memvalidasi ini saat startup, tapi kita tambah guard di sini juga
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('[FATAL] JWT_SECRET tidak diset. Pastikan file .env sudah dikonfigurasi dengan benar.');
}


// Middleware to verify JWT token
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'No authorization header provided' });
  }

  const token = authHeader.split(' ')[1]; // Format: "Bearer <token>"
  if (!token) {
    return res.status(401).json({ success: false, error: 'Token missing' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }

    // [SECURITY FIX] Token revocation: tolak token yang token_version-nya
    // tidak cocok lagi dengan user di database (misal karena password baru
    // saja diganti). Tanpa ini, JWT lama tetap valid sampai expired walau
    // password sudah diganti.
    const user = db.getUserById(decoded.id);
    if (!user || (user.token_version || 0) !== (decoded.tv || 0)) {
      return res.status(403).json({ success: false, error: 'Sesi tidak valid. Silakan login ulang.' });
    }

    req.user = decoded;
    next();
  });
}

// Middleware to restrict access to Admins only
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, error: 'Admin access required' });
  }
}

module.exports = { requireAuth, requireAdmin, JWT_SECRET };
