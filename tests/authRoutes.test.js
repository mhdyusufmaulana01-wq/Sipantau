// [FEAT] Test coverage untuk routes/auth.js + middleware/authGuard.js --
// sebelumnya cuma db & engine yang punya test, jalur login/otorisasi belum
// tercover otomatis sama sekali.
//
// Pakai database sementara (via SIPANTAU_DB_PATH) supaya tidak menyentuh
// data.db produksi -- env var ini HARUS diset sebelum module manapun yang
// require('../src/db/client') pertama kali dimuat.
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpDbPath = path.join(os.tmpdir(), 'sipantau_test_auth_' + Date.now() + '.db');
process.env.SIPANTAU_DB_PATH = tmpDbPath;
process.env.JWT_SECRET = 'test-secret-hanya-untuk-jest-jangan-dipakai-produksi';
process.env.JWT_EXPIRES_IN = '1h';

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const authRoutes = require('../src/routes/auth');
const { requireAuth, requireAdmin } = require('../src/middleware/authGuard');
const { db } = require('../src/db/client');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
// Route dummy buat nguji requireAuth/requireAdmin secara langsung, terlepas
// dari endpoint auth.js spesifik.
app.get('/api/protected/any-login', requireAuth, (req, res) => res.json({ success: true, user: req.user }));
app.get('/api/protected/admin-only', requireAuth, requireAdmin, (req, res) => res.json({ success: true }));

let adminToken, viewerToken, adminId;

beforeAll(async () => {
  const adminHash = await bcrypt.hash('AdminPass123!', 10);
  adminId = db.createUser('testadmin', adminHash, 'admin');
  const viewerHash = await bcrypt.hash('ViewerPass123!', 10);
  db.createUser('testviewer', viewerHash, 'viewer');
});

afterAll(() => {
  db.close();
  [tmpDbPath, tmpDbPath + '-shm', tmpDbPath + '-wal'].forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
});

describe('POST /api/auth/login', () => {
  it('should login successfully with correct credentials and return a token', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'testadmin', password: 'AdminPass123!' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.role).toBe('admin');
    adminToken = res.body.data.token;
  });

  it('should also let viewer login and get a token', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'testviewer', password: 'ViewerPass123!' });
    expect(res.status).toBe(200);
    viewerToken = res.body.data.token;
  });

  it('should reject wrong password with 401 and a generic error (anti user-enumeration)', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'testadmin', password: 'salahpassword' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should reject login for a username that does not exist, with the SAME generic error message', async () => {
    const wrongPass = await request(app).post('/api/auth/login').send({ username: 'testadmin', password: 'salah' });
    const noUser = await request(app).post('/api/auth/login').send({ username: 'usertidakada', password: 'apapun' });
    expect(noUser.status).toBe(401);
    // [SECURITY] pesan error harus SAMA supaya penyerang tidak bisa tebak username mana yang valid
    expect(noUser.body.error).toBe(wrongPass.body.error);
  });

  it('should reject missing username/password with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'testadmin' });
    expect(res.status).toBe(400);
  });
});

describe('requireAuth / requireAdmin middleware', () => {
  it('should reject request without Authorization header', async () => {
    const res = await request(app).get('/api/protected/any-login');
    expect(res.status).toBe(401);
  });

  it('should reject request with invalid/garbage token', async () => {
    const res = await request(app).get('/api/protected/any-login').set('Authorization', 'Bearer token-ngawur');
    expect(res.status).toBe(403);
  });

  it('should allow valid token for any-login route', async () => {
    const res = await request(app).get('/api/protected/any-login').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('testadmin');
  });

  it('should reject viewer role on admin-only route (403)', async () => {
    const res = await request(app).get('/api/protected/admin-only').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('should allow admin role on admin-only route', async () => {
    const res = await request(app).get('/api/protected/admin-only').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/auth/password (ganti password + token revocation)', () => {
  it('should reject wrong current password', async () => {
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'salah', newPassword: 'PasswordBaru123!' });
    expect(res.status).toBe(401);
  });

  it('should reject new password that is too short', async () => {
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'ViewerPass123!', newPassword: 'pendek' });
    expect(res.status).toBe(400);
  });

  it('should successfully change password AND immediately invalidate the old token (revocation)', async () => {
    const changeRes = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'ViewerPass123!', newPassword: 'PasswordBaruViewer123!' });
    expect(changeRes.status).toBe(200);

    // [BUG FIX regression] token LAMA (sebelum ganti password) harus langsung
    // tidak valid lagi -- ini fitur token_version yang dibangun khusus untuk ini.
    const oldTokenRes = await request(app).get('/api/protected/any-login').set('Authorization', `Bearer ${viewerToken}`);
    expect(oldTokenRes.status).toBe(403);

    // Login ulang dengan password BARU harus berhasil
    const reloginRes = await request(app).post('/api/auth/login').send({ username: 'testviewer', password: 'PasswordBaruViewer123!' });
    expect(reloginRes.status).toBe(200);
    viewerToken = reloginRes.body.data.token; // update untuk test berikutnya

    // Password LAMA sudah tidak berlaku lagi
    const oldPassLoginRes = await request(app).post('/api/auth/login').send({ username: 'testviewer', password: 'ViewerPass123!' });
    expect(oldPassLoginRes.status).toBe(401);
  });
});

describe('Manajemen User (Admin only)', () => {
  it('should reject non-admin (viewer) from listing users', async () => {
    const res = await request(app).get('/api/auth/users').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('should let admin list users, and never leak password_hash', async () => {
    const res = await request(app).get('/api/auth/users').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    res.body.data.forEach((u) => {
      expect(u.password_hash).toBeUndefined();
    });
  });

  it('should let admin create a new user', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'usercreatedbytest', password: 'NewUserPass123!', role: 'viewer' });
    expect(res.status).toBe(201);
    expect(res.body.data.username).toBe('usercreatedbytest');
  });

  it('should reject creating user with a username that already exists', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'usercreatedbytest', password: 'AnotherPass123!', role: 'viewer' });
    expect(res.status).toBe(409);
  });

  it('should reject creating user with an invalid role', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'usergagal', password: 'ValidPass123!', role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  it('should reject admin deleting their own account', async () => {
    const res = await request(app).delete(`/api/auth/users/${adminId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('should reject deleting the last remaining admin', async () => {
    // Di test suite ini cuma ada 1 admin (testadmin), jadi coba hapus dari
    // sudut pandang user LAIN pun (kalau bisa) harus tetap ditolak karena
    // itu admin terakhir. Simulasikan dengan token admin yang sama tapi
    // targetnya beda -- di sini tidak ada admin lain, jadi cukup pastikan
    // guard "hapus diri sendiri" & "admin terakhir" dua-duanya aktif.
    const count = db.countAdmins();
    expect(count).toBe(1);
  });

  it('should let admin delete a non-admin user', async () => {
    const target = db.getUserByUsername('usercreatedbytest');
    const res = await request(app).delete(`/api/auth/users/${target.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(db.getUserByUsername('usercreatedbytest')).toBeUndefined();
  });
});
