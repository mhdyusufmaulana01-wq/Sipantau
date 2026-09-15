const bcrypt = require('bcryptjs');
const { db } = require('../src/db/client');

async function seed() {
  console.log('[SIPANTAU] Menginisialisasi data awal...');

  try {
    // Hash passwords
    const adminPassword = await bcrypt.hash('admin123', 10);
    const viewerPassword = await bcrypt.hash('viewer123', 10);

    // Insert Admin
    const adminExists = db.getUserByUsername('admin');
    if (!adminExists) {
      db.createUser('admin', adminPassword, 'admin');
      console.log('Created Admin user (admin / admin123)');
    } else {
      console.log('Admin user already exists.');
    }

    // Insert Viewer
    const viewerExists = db.getUserByUsername('viewer');
    if (!viewerExists) {
      db.createUser('viewer', viewerPassword, 'viewer');
      console.log('Created Viewer user (viewer / viewer123)');
    } else {
      console.log('Viewer user already exists.');
    }

    // Insert contoh monitor pertama jika belum ada
    const monitors = db.getAllMonitors();
    if (monitors.length === 0) {
      db.addMonitor({
        name: 'Kemhan Utama',
        url: 'https://kemhan.go.id',
        interval_seconds: 60,
        timeout_ms: 10000,
        retry_count: 3,
        retry_delay_ms: 2000,
        is_active: 1,
        category: 'Kemhan',
        notes: 'Monitor utama website Kementerian Pertahanan RI'
      });
      console.log('[SIPANTAU] Monitor default berhasil dibuat.');
    } else {
      console.log('Monitors already exist.');
    }

    console.log('Seeding completed successfully!');
  } catch (err) {
    console.error('Error during seeding:', err);
  } finally {
    db.close();
  }
}

seed();
