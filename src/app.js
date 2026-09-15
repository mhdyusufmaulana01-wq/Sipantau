// Load environment variables PERTAMA sebelum apapun
require('dotenv').config();

// ============================================================
// VALIDASI: Pastikan variabel lingkungan kritis sudah diset
// ============================================================
if (!process.env.JWT_SECRET) {
  console.error('[FATAL] Variabel lingkungan JWT_SECRET TIDAK DISET!');
  console.error('[FATAL] Salin .env.example ke .env dan isi JWT_SECRET dengan string acak yang panjang.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const { rateLimit } = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const monitorRoutes = require('./routes/monitors');
const notificationRoutes = require('./routes/settings');
const { startScheduler } = require('./scheduler/cronRunner');
const { db } = require('./db/client');

const app = express();
const port = process.env.PORT || 3000;

// ============================================================
// TRUST PROXY: Aktifkan HANYA jika aplikasi berjalan di belakang
// reverse proxy (Nginx/Apache/Load Balancer) — lihat deploy/nginx.conf.example.
// Tanpa proxy di depan, JANGAN diaktifkan: mempercayai header
// X-Forwarded-For tanpa proxy sungguhan berarti client bisa
// memalsukan IP asal sendiri dan membypass rate limiter login/API.
// Isi TRUST_PROXY di .env dengan jumlah hop proxy (biasanya 1).
// ============================================================
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isFinite(hops) && hops > 0 ? hops : 1);
  console.log(`[API] trust proxy diaktifkan (hop: ${app.get('trust proxy')})`);
}

// ============================================================
// CORS: Hanya izinkan origin yang ditentukan di .env
// ============================================================
const corsOptions = {
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));

// [SECURITY FIX] Batasi ukuran request body untuk mencegah Out-of-Memory attack
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ============================================================
// GLOBAL RATE LIMITER: Lindungi semua endpoint API dari abuse
// [SECURITY FIX] 200 request per menit per IP untuk endpoint /api/*
// ============================================================
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 menit
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Terlalu banyak permintaan. Silakan coba lagi dalam 1 menit.',
  },
  skip: (req) => req.path === '/api/health', // Health check tidak perlu rate limit
});
app.use('/api/', globalApiLimiter);

// ============================================================
// Routes
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/monitors', monitorRoutes);
app.use('/api/notifications', notificationRoutes);

// ============================================================
// Health check endpoint — sekarang benar-benar memeriksa DB
// [PERF FIX] Health check kini mengembalikan jumlah monitor dan status DB
// ============================================================
app.get('/api/health', (req, res) => {
  try {
    const monitorCount = db.db.prepare('SELECT count(*) as c FROM monitors').get().c;
    const activeCount  = db.db.prepare('SELECT count(*) as c FROM monitors WHERE is_active = 1').get().c;
    res.json({
      success: true,
      message: 'SIPANTAU Monitoring API is running',
      db: 'OK',
      monitors: { total: monitorCount, active: activeCount },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[Health] Database check failed:', e.message);
    res.status(503).json({ success: false, message: 'Database error', error: e.message });
  }
});

// ============================================================
// GLOBAL ERROR HANDLER: Tangkap semua error yang tidak tertangani
// ============================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[API] Unhandled error:', err.message || err);
  res.status(500).json({ success: false, error: 'Terjadi kesalahan internal pada server.' });
});

// ============================================================
// Start server
// ============================================================
const server = app.listen(port, () => {
  console.log(`[API] Server berjalan di port ${port}`);
  console.log(`[API] CORS diizinkan dari: ${process.env.ALLOWED_ORIGIN || 'http://localhost:3000'}`);

  // [PERF FIX] WAL CHECKPOINT PENUH saat startup untuk memastikan WAL tidak bloat
  try {
    db.db.pragma('wal_checkpoint(FULL)');
    console.log('[DB] WAL checkpoint FULL berhasil dijalankan saat startup.');
  } catch (e) {
    console.error('[DB] Gagal WAL checkpoint startup:', e.message);
  }

  startScheduler();
});

// ============================================================
// GRACEFUL SHUTDOWN: Tutup DB dengan benar sebelum exit
// ============================================================
function gracefulShutdown(signal) {
  console.log(`\n[Shutdown] Menerima sinyal ${signal}. Menutup server...`);
  server.close(() => {
    console.log('[Shutdown] HTTP server ditutup.');
    try {
      // Checkpoint WAL dan tutup koneksi database
      db.db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      console.log('[Shutdown] Database ditutup dengan aman.');
    } catch (e) {
      console.error('[Shutdown] Error saat menutup database:', e.message);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;
