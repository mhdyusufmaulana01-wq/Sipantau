// [FEAT] Regresi untuk proteksi akses di routes/monitors.js -- khususnya
// mengunci perbaikan bug: GET /:id (detail monitor) dulu cuma requireAuth,
// tidak requireAdmin, sehingga field sensitif (notes, expected_keyword) bisa
// bocor ke role viewer lewat endpoint detail per-ID walau endpoint daftar
// (GET /) sudah dilindungi requireAdmin. Lihat src/routes/monitors.js.
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpDbPath = path.join(os.tmpdir(), 'sipantau_test_monitors_' + Date.now() + '.db');
process.env.SIPANTAU_DB_PATH = tmpDbPath;
process.env.JWT_SECRET = 'test-secret-hanya-untuk-jest-jangan-dipakai-produksi';
process.env.JWT_EXPIRES_IN = '1h';

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const monitorsRoutes = require('../src/routes/monitors');
const { db } = require('../src/db/client');

const app = express();
app.use(express.json());
app.use('/api/monitors', monitorsRoutes);

let adminToken, viewerToken, monitorId;

beforeAll(async () => {
  const adminHash = await bcrypt.hash('AdminPass123!', 10);
  const adminUser = { id: db.createUser('monadmin', adminHash, 'admin'), username: 'monadmin', role: 'admin' };
  const viewerHash = await bcrypt.hash('ViewerPass123!', 10);
  const viewerUser = { id: db.createUser('monviewer', viewerHash, 'viewer'), username: 'monviewer', role: 'viewer' };

  adminToken = jwt.sign({ ...adminUser, tv: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  viewerToken = jwt.sign({ ...viewerUser, tv: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });

  monitorId = db.addMonitor({
    name: 'Monitor Test', url: 'https://example.com', interval_seconds: 60,
    notes: 'Catatan internal rahasia', expected_keyword: 'kata kunci rahasia',
  });
});

afterAll(() => {
  db.close();
  [tmpDbPath, tmpDbPath + '-shm', tmpDbPath + '-wal'].forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
});

describe('GET /api/monitors/dashboard - publik (tanpa auth)', () => {
  it('should be accessible without any token', async () => {
    const res = await request(app).get('/api/monitors/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/monitors - daftar monitor (Admin only)', () => {
  it('should reject request without token', async () => {
    const res = await request(app).get('/api/monitors');
    expect(res.status).toBe(401);
  });

  it('should reject viewer role (field sensitif seperti notes tidak boleh bocor ke viewer)', async () => {
    const res = await request(app).get('/api/monitors').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('should allow admin role', async () => {
    const res = await request(app).get('/api/monitors').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('[BUG FIX regression] GET /api/monitors/:id - detail monitor (Admin only)', () => {
  it('should reject viewer role, konsisten dengan GET / (list)', async () => {
    const res = await request(app).get(`/api/monitors/${monitorId}`).set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('should allow admin role and include sensitive fields', async () => {
    const res = await request(app).get(`/api/monitors/${monitorId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Catatan internal rahasia');
  });
});

describe('POST/PUT/DELETE /api/monitors - modifikasi (Admin only)', () => {
  it('should reject viewer trying to create a monitor', async () => {
    const res = await request(app)
      .post('/api/monitors')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Percobaan Viewer', url: 'https://example.com' });
    expect(res.status).toBe(403);
  });

  it('should reject invalid URL when admin creates a monitor', async () => {
    const res = await request(app)
      .post('/api/monitors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'URL Salah', url: 'bukan-url-valid' });
    expect(res.status).toBe(400);
  });

  it('should let admin create a valid monitor', async () => {
    const res = await request(app)
      .post('/api/monitors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Monitor Baru', url: 'https://contoh-baru.test' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Monitor Baru');
  });

  it('should reject viewer trying to delete a monitor', async () => {
    const res = await request(app).delete(`/api/monitors/${monitorId}`).set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });
});
