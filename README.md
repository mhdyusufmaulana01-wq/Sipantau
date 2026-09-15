# 🛡️ SIPANTAU — Sistem Informasi Pemantauan & Analisis Network Terpadu

Sistem pemantauan uptime website dan infrastruktur digital secara real-time, dengan pengecekan bertingkat (DNS → TCP → HTTP → SSL) dan notifikasi otomatis via Telegram.

---

## ✨ Fitur Utama

- **Pemeriksaan 4 lapis**: DNS → TCP → HTTP → SSL untuk deteksi masalah yang presisi
- **Anti false-positive**: Retry logic sebelum divonis DOWN
- **Content Inspection**: Pengecekan defacement dan spesifik keyword (mendukung *streaming decompress* Gzip/Brotli/Deflate)
  > [!NOTE]
  > **Keterbatasan (Known Limitation):** Pengecekan defacement dan kewajiban *keyword* dibatasi maksimum memindai **256KB pertama** dari *response* teks yang telah terdekompresi demi optimasi memori. *Keyword* yang diposisikan di akhir dari *response* HTML berukuran sangat besar (melewati limit tersebut) **tidak akan terdeteksi**.
- **Deep-Scan Defacement Subdirektori**: Selain cek cepat di halaman utama tiap beberapa detik, sistem juga menjalankan pemindaian **harian** ke subhalaman situs (ditemukan lewat `sitemap.xml`, atau fallback ke link di homepage) — karena defacer pada umumnya menanam konten di subdirektori tersembunyi, bukan mengganti halaman utama yang cepat ketahuan. Notifikasi darurat terpisah dikirim kalau ditemukan indikasi di subhalaman manapun.
  > [!NOTE]
  > **Keterbatasan:** Hanya menemukan halaman yang terdaftar di sitemap atau tertaut dari homepage. Halaman "yatim" yang sengaja disembunyikan (tidak ada di sitemap, tidak ditautkan) tidak akan terdeteksi — mendeteksinya butuh directory brute-forcing yang di luar cakupan sistem ini (lihat Batasan Masalah).
- **Deteksi Jargon Judi Anti-False-Positive**: Kata kunci tanda tangan hacker ("hacked by", dll.) divonis langsung dari 1 kecocokan, tapi jargon spam judi ("slot gacor", "rtp live", dll.) baru divonis kalau ada ≥2 istilah berbeda muncul bersamaan atau 1 istilah diulang ≥4 kali — agar artikel resmi yang membahas/memperingatkan soal judi online (menyebut istilah itu sekali) tidak ikut ter-flag sebagai defacement.
- **Security Header Score**: Tiap cek uptime sekaligus menganalisis header keamanan (`Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) dari response yang sudah diambil — TANPA request tambahan ke server target — lalu ditampilkan sebagai skor 0-100 & nilai huruf (A-F) di panel detail monitor.
- **Deteksi Title-Hijacking**: Jargon spam judi yang muncul di tag `<title>` halaman (teknik SEO poisoning paling umum) langsung divonis defacement dari 1 kecocokan — beda perlakuan dari jargon yang sama kalau muncul di isi body (butuh korobasi, lihat poin di atas), karena title halaman sendiri berisi jargon judi adalah sinyal yang jauh lebih tegas dibanding sekadar disebut dalam kalimat.
- **Peringatan Dini Domain Akan Kedaluwarsa**: Selain SSL, sistem juga memantau **masa registrasi domain** lewat WHOIS (`whois.id`, khusus TLD `.id`) — penyebab downtime yang sering luput karena lupa perpanjang domain, yang membuat SEMUA subdomain di bawahnya mati bersamaan. Dicek per domain induk (bukan per monitor) supaya hemat query — banyak monitor bisa berbagi 1 domain induk yang sama, dan notifikasinya menyebutkan semua monitor yang akan ikut terdampak.
  > [!NOTE]
  > **Keterbatasan:** Hanya mendukung TLD `.id` (termasuk `.go.id`, `.co.id`, dst.) karena pakai server WHOIS `whois.id` secara langsung. Domain dengan TLD lain (`.com`, `.org`, dst.) memerlukan referral chain IANA yang lebih kompleks dan di luar cakupan sistem ini.
  >
  > Tile "Sisa Masa Aktif Domain" muncul di panel detail monitor begitu job harian pertama selesai jalan (5 menit setelah server dinyalakan) — sebelum itu tampil N/A karena belum ada data WHOIS tersimpan.
- **Dashboard real-time**: Visualisasi status, bar chart riwayat, dan persentase uptime 30 hari
- **Notifikasi Telegram & Webhook**: Alert otomatis saat DOWN & saat pulih
- **Peringatan Dini SSL**: Notifikasi bertingkat (30/14/7/3/1 hari) SEBELUM sertifikat SSL kedaluwarsa — bukan setelahnya — agar engineer sempat memperpanjang sebelum website ter-blokir browser
- **Role-based access**: Tampilan berbeda untuk Admin dan Viewer
- **Konfigurasi fleksibel**: HTTP method, custom status codes, ignore SSL per monitor

---

## 🚀 Setup & Instalasi

### 1. Persiapan

Pastikan sudah terinstall: **Node.js v18+**

```bash
# Clone / download proyek ini
cd projek-uptime-kemhan

# Install semua dependency
npm install
```

### 2. Konfigurasi Environment

```bash
# Salin file contoh ke .env
copy .env.example .env
```

Buka file `.env` dan **ganti** nilai `JWT_SECRET` dengan string acak yang panjang:

```bash
# Generate JWT secret yang aman (jalankan di terminal):
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Isi file `.env`:
```
PORT=3000
JWT_SECRET=<tempel hasil generate di sini>
JWT_EXPIRES_IN=8h
ALLOWED_ORIGIN=http://localhost:3000
```

### 3. Buat akun admin pertama

```bash
npm run seed
```

Ini akan membuat dua akun:
- **admin** / `admin123` (ganti password setelah login pertama!)
- **viewer** / `viewer123`

### 4. Jalankan Aplikasi

```bash
# Mode production
npm start

# Mode development (auto-restart saat kode diubah)
npm run dev
```

Buka browser: **http://localhost:3000**

---

## 📁 Struktur Folder

```
├── src/
│   ├── engine/          # Checking engine (DNS, TCP, HTTP, SSL)
│   ├── scheduler/       # Cron job untuk check berkala
│   ├── db/              # Database SQLite (schema + client)
│   ├── routes/          # API endpoints
│   ├── middleware/       # Auth guard (JWT)
│   ├── services/        # Notifier (Telegram, Webhook)
│   └── app.js           # Entry point aplikasi
├── public/              # Frontend statis
│   ├── index.html       # Dashboard viewer
│   ├── admin.html       # Panel admin
│   ├── login.html       # Halaman login
│   └── assets/js/       # JavaScript frontend
├── tests/               # Unit test engine
├── scripts/             # Script maintenance (seed, populate, tiering)
│   ├── seed.js          # Script buat akun awal
│   ├── populate_sites.js       # Script tambah daftar website Kemhan
│   └── apply_tiered_intervals.js # Script terapkan interval per tingkat urgensi
├── .env.example         # Template konfigurasi (WAJIB disalin ke .env)
└── .gitignore           # File yang tidak boleh masuk Git
```

---

## 🔐 Keamanan

> **PENTING untuk deployment production:**

- Ganti `JWT_SECRET` di `.env` dengan string acak (minimal 64 karakter)
- Ganti password default `admin123` dan `viewer123` setelah pertama login
- Set `ALLOWED_ORIGIN` ke domain server yang sebenarnya
- File `.env` dan `data.db` **jangan pernah** dicommit ke Git
- **Jangan** expose Node.js langsung ke internet. Jalankan di belakang reverse
  proxy (Nginx) untuk terminasi HTTPS — lihat contoh konfigurasi di
  [`deploy/nginx.conf.example`](deploy/nginx.conf.example). Set `TRUST_PROXY=1`
  di `.env` HANYA jika memang berjalan di belakang proxy tersebut, agar rate
  limiter login/API menghitung IP pengguna asli, bukan IP proxy.

---

## 📡 API Endpoints

| Method | Endpoint | Akses | Fungsi |
|--------|----------|-------|--------|
| POST | `/api/auth/login` | Publik | Login |
| PUT | `/api/auth/password` | Auth | Ganti password akun sendiri |
| GET | `/api/auth/users` | Admin | Daftar semua user |
| POST | `/api/auth/users` | Admin | Tambah user baru |
| DELETE | `/api/auth/users/:id` | Admin | Hapus user |
| GET | `/api/monitors/dashboard` | Publik | Data dashboard |
| GET | `/api/monitors` | Admin | Daftar semua monitor |
| GET | `/api/monitors/:id` | Admin | Detail monitor |
| GET | `/api/monitors/:id/history` | Auth | Riwayat pengecekan |
| GET | `/api/monitors/:id/defacement-scans` | Admin | Riwayat deep-scan subdirektori |
| POST | `/api/monitors` | Admin | Tambah monitor |
| PUT | `/api/monitors/:id` | Admin | Edit monitor |
| DELETE | `/api/monitors/:id` | Admin | Hapus monitor |
| GET | `/api/notifications/settings` | Admin | Lihat pengaturan notif |
| POST | `/api/notifications/settings` | Admin | Simpan pengaturan notif |
| POST | `/api/notifications/test` | Admin | Kirim pesan tes |

---

## 🧪 Menjalankan Test

```bash
npm test
```

Mencakup: engine (DNS/TCP/HTTP/SSL/defacement/domain), database, **serta routes & middleware auth** (login, ganti password + token revocation, manajemen user, proteksi akses admin-only) — total 85 test.

## 🔍 Linting

```bash
npm run lint
```

Mengecek gaya penulisan kode (ESLint) — terpisah dari `npm test` yang mengecek perilaku/fungsi.

---

## ⚙️ Menambahkan Website Kemhan

Cara cepat menambahkan semua website Kemhan sekaligus:

```bash
# Pastikan server TIDAK sedang berjalan
node scripts/populate_sites.js

# Opsional: terapkan interval berdasarkan tingkat urgensi
node scripts/apply_tiered_intervals.js
```

---

## 📞 Kontak & Support

**Pusdatin Kementerian Pertahanan RI**
