let monitorsData = [];
let activeMonitorId = null;
let countdownInterval = null;

const REFRESH_INTERVAL = 60000; // 60 detik

// ============================================================
// KAMUS GANGGUAN: Penjelasan kode error dalam bahasa sederhana
// Satu-satunya sumber kebenaran (single source of truth) untuk
// seluruh 15 root_cause yang bisa dihasilkan engine SIPANTAU.
// ============================================================

/**
 * Sanitasi string untuk mencegah XSS saat disisipkan ke innerHTML.
 * @param {string} str - String mentah dari data server.
 * @returns {string} String yang aman untuk innerHTML.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

const ROOT_CAUSE_DICT = {
  // --- Lapisan DNS ---
  DNS_FAILED: {
    label: 'Domain Tidak Ditemukan',
    icon: '🔍',
    color: 'text-red-400',
    desc: 'Alamat domain tidak bisa ditemukan di internet. Kemungkinan domain kedaluwarsa, salah ketik URL, atau DNS server bermasalah.',
    action: 'Hubungi Tim Jaringan / Pengelola Domain'
  },
  // --- Lapisan TCP ---
  TCP_CONNECTION_REFUSED: {
    label: 'Server Menolak Koneksi',
    icon: '🚫',
    color: 'text-red-400',
    desc: 'Server ditemukan tapi aplikasi web (Nginx/Apache/IIS) tidak mau menerima koneksi. Mungkin service web server mati atau diblokir firewall.',
    action: 'Hubungi Sysadmin / Tim Server'
  },
  TCP_TIMEOUT: {
    label: 'Tidak Ada Respon (Timeout TCP)',
    icon: '⏱️',
    color: 'text-red-400',
    desc: 'Server benar-benar bisu — tidak ada respon sama sekali. Kemungkinan server mati total, kabel putus, atau terjadi serangan DDoS.',
    action: 'Hubungi Tim Infrastruktur & Data Center'
  },
  // --- Lapisan HTTP ---
  HTTP_4XX: {
    label: 'Error Klien (HTTP 4xx)',
    icon: '🚷',
    color: 'text-orange-400',
    desc: 'Server hidup tapi menolak permintaan karena kesalahan di sisi klien — misalnya 403 Forbidden (diblokir WAF) atau 404 Not Found (URL salah).',
    action: 'Hubungi Tim Keamanan / Pengelola Konten Web'
  },
  HTTP_5XX: {
    label: 'Error Server (HTTP 5xx)',
    icon: '💥',
    color: 'text-orange-400',
    desc: 'Website merespon, tapi dengan kode error server (500/502/503/504). Ada masalah pada kode program, database, atau server kelebihan beban.',
    action: 'Hubungi Tim Developer / Programmer'
  },
  TIMEOUT: {
    label: 'Halaman Terlalu Lambat (HTTP Timeout)',
    icon: '🐌',
    color: 'text-blue-400',
    desc: 'Koneksi berhasil tapi halaman tidak selesai dimuat dalam batas waktu yang ditentukan. Server kemungkinan sedang overload atau koneksi lambat.',
    action: 'Hubungi Tim Sysadmin & Developer'
  },
  HTTP_ERROR: {
    label: 'Kesalahan HTTP Tidak Terduga',
    icon: '⚠️',
    color: 'text-orange-400',
    desc: 'Terjadi kesalahan HTTP yang tidak terklasifikasi. Lihat pesan detail untuk informasi lebih lanjut.',
    action: 'Hubungi Tim Developer untuk investigasi log server'
  },
  TOO_MANY_REDIRECTS: {
    label: 'Redirect Tak Terbatas (Loop)',
    icon: '🔄',
    color: 'text-orange-400',
    desc: 'Server mengarahkan permintaan terlalu banyak kali (lebih dari 10 redirect). Biasanya akibat konfigurasi redirect yang saling melingkar di Nginx/Apache.',
    action: 'Hubungi Sysadmin — periksa konfigurasi redirect server'
  },
  // --- Lapisan SSL ---
  SSL_CERT_EXPIRED: {
    label: 'Sertifikat SSL Kedaluwarsa',
    icon: '🔓',
    color: 'text-yellow-400',
    desc: 'Gembok keamanan HTTPS sudah lewat masa berlakunya. Browser akan memblokir akses pengunjung dengan tampilan peringatan merah.',
    action: 'SEGERA hubungi Tim Keamanan — perpanjang sertifikat SSL'
  },
  SSL_ERROR: {
    label: 'Masalah Konfigurasi SSL',
    icon: '🔐',
    color: 'text-yellow-400',
    desc: 'Ada kesalahan konfigurasi sertifikat SSL — mungkin hostname tidak cocok atau sertifikat self-signed tidak diizinkan.',
    action: 'Hubungi Tim Sysadmin — periksa konfigurasi SSL'
  },
  SSL_TIMEOUT: {
    label: 'Timeout Handshake SSL',
    icon: '⏳',
    color: 'text-yellow-400',
    desc: 'Koneksi berhasil tapi proses negosiasi enkripsi SSL/TLS tidak selesai dalam batas waktu. Server kemungkinan kelebihan beban atau ada masalah konfigurasi TLS.',
    action: 'Hubungi Tim Sysadmin — periksa performa server & konfigurasi TLS'
  },
  // --- Fitur Keamanan Konten ---
  DEFACEMENT_DETECTED: {
    label: '🚨 INDIKASI PERETASAN / DEFACEMENT',
    icon: '🛡️',
    color: 'text-red-500',
    desc: 'PERINGATAN KEAMANAN: Situs berhasil diakses (HTTP 200), namun konten halaman terdeteksi mengandung kata kunci judi online atau pesan peretas. Ini indikasi serius bahwa website telah disusupi.',
    action: 'SEGERA hubungi Tim CSIRT / Keamanan Siber Kemhan — isolasi server & audit forensik'
  },
  KEYWORD_MISSING: {
    label: 'Kata Kunci Wajib Tidak Ditemukan',
    icon: '🔎',
    color: 'text-yellow-400',
    desc: 'Situs merespon tapi tidak menampilkan kata kunci yang diharapkan. Menandakan aplikasi mengalami blank page, halaman maintenance, atau konten tidak normal.',
    action: 'Hubungi Tim Developer Aplikasi — periksa log error dan buka URL secara manual'
  },
  // --- Lainnya ---
  INVALID_URL: {
    label: 'Format URL Tidak Valid',
    icon: '🔗',
    color: 'text-gray-400',
    desc: 'URL yang dikonfigurasi di monitor tidak dapat diproses karena formatnya salah (harus diawali https:// atau http://).',
    action: 'Periksa dan perbaiki URL di panel Admin'
  },
  UNKNOWN_ERROR: {
    label: 'Error Tidak Dikenal',
    icon: '❓',
    color: 'text-gray-400',
    desc: 'Terjadi kesalahan yang tidak dapat dikategorikan. Lihat pesan detail untuk informasi lebih lanjut dari engine.',
    action: 'Hubungi Tim IT untuk investigasi — cek log sistem monitoring'
  },
  NONE: {
    label: 'Normal',
    icon: '✅',
    color: 'text-emerald-400',
    desc: 'Tidak ada masalah yang terdeteksi pada pengecekan ini.',
    action: null
  }
};

/**
 * Mendapatkan info dari kamus berdasarkan kode error.
 * Jika tidak ada entri, kembalikan objek generik.
 */
function getRootCauseInfo(rootCause) {
  if (!rootCause || rootCause === 'NONE') return ROOT_CAUSE_DICT['NONE'];
  return ROOT_CAUSE_DICT[rootCause] || {
    label: rootCause,
    icon: '⚠️',
    color: 'text-orange-400',
    desc: 'Terjadi gangguan yang tidak terduga pada koneksi ke server target.',
    action: 'Hubungi Tim IT untuk investigasi lebih lanjut'
  };
}

document.addEventListener('DOMContentLoaded', () => {
    setupAuthUI();
    fetchDashboardData();
    startRefreshCountdown();
    
    setInterval(() => {
        fetchDashboardData();
        startRefreshCountdown();
    }, REFRESH_INTERVAL);
    
    document.getElementById('search-monitor').addEventListener('input', (e) => {
        renderSidebar(e.target.value.toLowerCase());
    });
});

/**
 * Mulai hitung mundur yang ditampilkan di navbar
 */
function startRefreshCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    let seconds = REFRESH_INTERVAL / 1000;
    updateCountdownUI(seconds);
    countdownInterval = setInterval(() => {
        seconds--;
        if (seconds < 0) seconds = 0;
        updateCountdownUI(seconds);
    }, 1000);
}

function updateCountdownUI(seconds) {
    const el = document.getElementById('refresh-countdown');
    if (el) {
        el.textContent = `${seconds}s`;
    }
}

function manualRefresh() {
    fetchDashboardData();
    startRefreshCountdown();
}


function setupAuthUI() {
    const authSection = document.getElementById('auth-section');
    const user = getUser();

    if (user) {
        if (user.role === 'admin') {
            authSection.innerHTML = `
                <a href="/admin.html" class="h-9 flex items-center gap-2 text-[13px] font-medium text-blue-300 hover:text-blue-200 border border-blue-500/30 hover:border-blue-400/60 bg-[#21262d] hover:bg-[#28303b] px-4 rounded-lg transition-all shadow-sm">
                    <i class="fa-solid fa-sliders text-blue-400 text-[13px]"></i>
                    <span>Kelola Monitor</span>
                </a>
                <div class="flex items-center gap-2 pl-2 border-l border-[#30363d]">
                    <div class="flex items-center gap-2 bg-[#0d1117] border border-[#30363d] px-3.5 py-1.5 rounded-lg text-[13px] text-gray-300 font-medium">
                        <i class="fa-regular fa-circle-user text-emerald-400 text-sm"></i>
                        <span>${escapeHtml(user.username)}</span>
                    </div>
                    <button onclick="openChangePasswordModal()" class="h-9 w-9 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-400 hover:text-white border border-[#30363d] flex items-center justify-center transition-all shadow-sm" title="Ganti Password">
                        <i class="fa-solid fa-key text-[13px]"></i>
                    </button>
                    <button onclick="logout()" class="h-9 w-9 rounded-lg bg-[#21262d] hover:bg-red-500/20 text-gray-400 hover:text-red-400 border border-[#30363d] hover:border-red-500/30 flex items-center justify-center transition-all shadow-sm" title="Logout">
                        <i class="fa-solid fa-arrow-right-from-bracket text-[13px]"></i>
                    </button>
                </div>
            `;
        } else {
            authSection.innerHTML = `
                <div class="flex items-center gap-2">
                    <div class="flex items-center gap-2 bg-[#0d1117] border border-[#30363d] px-3.5 py-1.5 rounded-lg text-[13px] text-gray-300 font-medium">
                        <i class="fa-regular fa-circle-user text-emerald-400 text-sm"></i>
                        <span>${escapeHtml(user.username)}</span>
                    </div>
                    <button onclick="openChangePasswordModal()" class="h-9 w-9 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-400 hover:text-white border border-[#30363d] flex items-center justify-center transition-all shadow-sm" title="Ganti Password">
                        <i class="fa-solid fa-key text-[13px]"></i>
                    </button>
                    <button onclick="logout()" class="h-9 w-9 rounded-lg bg-[#21262d] hover:bg-red-500/20 text-gray-400 hover:text-red-400 border border-[#30363d] hover:border-red-500/30 flex items-center justify-center transition-all shadow-sm" title="Logout">
                        <i class="fa-solid fa-arrow-right-from-bracket text-[13px]"></i>
                    </button>
                </div>
            `;
        }
    } else {
        authSection.innerHTML = `
            <a href="/login.html" class="h-9 flex items-center gap-2 text-[13px] font-medium text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/50 px-4 rounded-lg transition-all shadow-sm">
                <i class="fa-solid fa-right-to-bracket text-[13px]"></i>
                <span>Login</span>
            </a>
        `;
    }
}


async function fetchDashboardData() {
    const res = await apiRequest('/monitors/dashboard');
    
    if (res.status === 401 || res.status === 403) {
        document.getElementById('sidebar-list').innerHTML = `
            <div class="p-4 text-center">
                <p class="text-red-400 text-sm mb-2">Akses Ditolak</p>
                <a href="/login.html" class="text-emerald-400 text-sm underline">Silakan Login</a>
            </div>`;
        return;
    }
    
    if (res.data && res.data.success) {
        monitorsData = res.data.data;
        
        // Urutkan: UP hijau duluan, lalu persentase uptime tertinggi ke terendah
        monitorsData.sort((a, b) => {
            if (a.status === 'UP' && b.status !== 'UP') return -1;
            if (a.status !== 'UP' && b.status === 'UP') return 1;
            const upA = parseFloat(a.uptime_percent) || 0;
            const upB = parseFloat(b.uptime_percent) || 0;
            if (upB !== upA) return upB - upA;
            return a.name.localeCompare(b.name);
        });

        const search = document.getElementById('search-monitor').value.toLowerCase();
        renderSidebar(search);
        
        // If an active monitor is selected, refresh its details; otherwise select first
        if (activeMonitorId) {
            selectMonitor(activeMonitorId, false);
        } else if (monitorsData.length > 0) {
            selectMonitor(monitorsData[0].id, false);
        }
    } else {
        document.getElementById('sidebar-list').innerHTML = `
            <div class="p-4 text-center text-red-400 text-xs">
                Gagal memuat data: ${res.data?.error || 'Kesalahan server'}
            </div>`;
    }
}

function renderSidebar(searchQuery = '') {
    const sidebar = document.getElementById('sidebar-list');
    sidebar.innerHTML = '';
    
    const filtered = monitorsData.filter(m => m.name.toLowerCase().includes(searchQuery) || m.url.toLowerCase().includes(searchQuery));
    
    if (filtered.length === 0) {
        sidebar.innerHTML = `<div class="text-center py-4 text-gray-500 text-[13px]">Tidak ditemukan.</div>`;
        return;
    }
    
    filtered.forEach(m => {
        const div = document.createElement('div');
        const isActive = m.id === activeMonitorId;
        div.className = `p-3 rounded-md cursor-pointer transition-colors ${isActive ? 'active-monitor' : 'hover:bg-[#1f2631]'}`;
        div.onclick = () => selectMonitor(m.id, true);
        
        // 40 mini bars to synchronize 1:1 with the main panel's 40 checks
        const miniBarsCount = 40;
        let miniBarsHtml = '';
        const checksForMini = m.recent_checks.slice(-miniBarsCount);
        
        const emptyBars = miniBarsCount - checksForMini.length;
        for (let i = 0; i < emptyBars; i++) {
            miniBarsHtml += `<div class="flex-1 h-[14px] bg-[#30363d] rounded-sm opacity-25"></div>`;
        }
        
        checksForMini.forEach(c => {
            const color = c.status === 'UP' ? 'bg-emerald-500' : 'bg-red-500';
            miniBarsHtml += `<div class="flex-1 h-[14px] ${color} rounded-sm"></div>`;
        });
        
        const badgeColor = m.status === 'UP' ? 'text-emerald-400' : (m.status === 'DOWN' ? 'text-red-400' : 'text-gray-400');
        
        // [SECURITY FIX] Temuan #2: Gunakan escapeHtml() untuk data dinamis di innerHTML
        // agar tidak rentan Stored XSS jika nama monitor mengandung karakter HTML.
        div.innerHTML = `
            <div class="flex justify-between items-center mb-2.5">
                <span class="text-[13px] font-medium text-gray-200 truncate pr-2 tracking-tight">${escapeHtml(m.name)}</span>
                <span class="text-[11px] ${badgeColor} font-semibold shrink-0">${escapeHtml(m.uptime_percent)}%</span>
            </div>
            <div class="flex gap-[2px] items-end h-[14px] w-full overflow-hidden">
                ${miniBarsHtml}
            </div>
        `;
        
        sidebar.appendChild(div);
    });
}

function selectMonitor(id, forceScroll = false) {
    activeMonitorId = id;
    const search = document.getElementById('search-monitor').value.toLowerCase();
    renderSidebar(search);
    
    const monitor = monitorsData.find(m => m.id === id);
    if (!monitor) return;
    
    document.getElementById('detail-empty').classList.add('hidden');
    document.getElementById('detail-content').classList.remove('hidden');
    
    document.getElementById('d-name').textContent = monitor.name;
    document.getElementById('d-url').href = monitor.url;
    document.getElementById('d-url-text').textContent = monitor.url;
    
    const badge = document.getElementById('d-status-badge');
    badge.textContent = monitor.status;
    if (monitor.status === 'UP') {
        badge.className = 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide flex items-center justify-center gap-1.5 w-fit';
        badge.innerHTML = `<div class="w-2 h-2 rounded-full bg-emerald-400"></div> UP`;
    } else if (monitor.status === 'DOWN') {
        badge.className = 'text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide flex items-center justify-center gap-1.5 w-fit';
        badge.innerHTML = `<div class="w-2 h-2 rounded-full bg-red-400"></div> DOWN`;
    } else {
        badge.className = 'text-gray-400 bg-gray-800 border border-gray-700 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide flex items-center justify-center gap-1.5 w-fit';
        badge.innerHTML = `<div class="w-2 h-2 rounded-full bg-gray-400"></div> UNKNOWN`;
    }
    
    const bigBarsContainer = document.getElementById('d-big-bars');
    bigBarsContainer.innerHTML = '';
    
    // Exactly 40 bars on detail panel as well
    const maxBars = 40;
    const checks = monitor.recent_checks.slice(-maxBars);
    const emptyCount = maxBars - checks.length;
    
    for (let i = 0; i < emptyCount; i++) {
        bigBarsContainer.innerHTML += `<div class="bar flex-1 bg-[#30363d] h-full opacity-30 rounded-sm"></div>`;
    }
    
    let lastPing = 'N/A';
    let avgPing = 'N/A';
    let sslRemaining = 'N/A';
    let sslDateFormatted = '';
    let domainRemaining = 'N/A';
    let domainDateFormatted; // selalu ditimpa di bawah (kedua cabang kondisi domain), tidak perlu nilai awal
    
    if (checks.length > 0) {
        const lastCheck = checks[checks.length - 1];
        lastPing = lastCheck.response_time_ms ? `${lastCheck.response_time_ms} ms` : 'N/A';
        
        // Calculate average ping for successful checks
        const pings = checks.filter(c => c.status === 'UP' && c.response_time_ms).map(c => c.response_time_ms);
        if (pings.length > 0) {
            const sum = pings.reduce((a, b) => a + b, 0);
            avgPing = Math.round(sum / pings.length) + ' ms';
        }
    }

    // [BUG FIX] Pakai monitor.ssl_expiry_date (data SSL TERAKHIR yang benar-benar
    // tersedia, dari server) -- BUKAN lastCheck.ssl_expiry_date. Kalau cek paling
    // akhir kebetulan TCP_TIMEOUT/SSL_TIMEOUT, SSL check-nya tidak sempat jalan
    // sama sekali sehingga ssl_expiry_date cek itu kosong, padahal cek-cek
    // sebelumnya bisa saja punya data SSL valid yang seharusnya tetap ditampilkan.
    if (monitor.ssl_expiry_date) {
        const exp = new Date(monitor.ssl_expiry_date);
        const now = new Date();
        const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));

        if (diffDays > 0) {
            sslRemaining = `${diffDays} Hari`;
            document.getElementById('d-ssl').className = 'text-xl font-semibold text-emerald-400 tracking-tight';
        } else {
            sslRemaining = `Expired`;
            document.getElementById('d-ssl').className = 'text-xl font-semibold text-red-400 tracking-tight';
        }
        sslDateFormatted = exp.toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // [FEAT] Sisa masa aktif domain (WHOIS) -- domain_expiry_date sudah
    // level-monitor (per domain INDUK, lihat db/client.js getDashboardData()).
    if (monitor.domain_expiry_date) {
        const exp = new Date(monitor.domain_expiry_date);
        const now = new Date();
        const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));

        if (diffDays > 0) {
            domainRemaining = `${diffDays} Hari`;
            document.getElementById('d-domain').className = 'text-xl font-semibold text-emerald-400 tracking-tight';
        } else {
            domainRemaining = `Expired`;
            document.getElementById('d-domain').className = 'text-xl font-semibold text-red-400 tracking-tight';
        }
        domainDateFormatted = exp.toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' });
        domainDateFormatted += monitor.domain_name ? ` (${monitor.domain_name})` : '';
    } else {
        domainDateFormatted = monitor.domain_name ? `Belum ada data untuk ${monitor.domain_name}` : '';
    }

    checks.forEach(c => {
        const isUp = c.status === 'UP';
        const color = isUp ? 'bg-emerald-500' : 'bg-red-500';
        const height = isUp ? 'h-full' : 'h-4/5';
        
        const timeStr = formatDate(c.checked_at);
        // [SECURITY FIX] Temuan #2: escape root_cause dan detail_message sebelum dirender ke tooltip HTML
        const reason = c.root_cause !== 'NONE' ? `<div class="mt-1.5 pt-1.5 border-t border-[#30363d]"><span class="text-red-400 font-semibold">${escapeHtml(c.root_cause)}</span><br><span class="text-gray-400 text-[10px] whitespace-normal break-words max-w-[200px] block mt-0.5">${escapeHtml(c.detail_message || '')}</span></div>` : '';
        const pingStr = c.response_time_ms ? `<div class="mt-0.5 text-gray-400 font-medium">Ping: ${c.response_time_ms}ms</div>` : '';
        
        const tooltipHtml = `
            <div class="font-medium text-gray-300 mb-1">${timeStr}</div>
            <div class="${isUp ? 'text-emerald-400' : 'text-red-400'} font-bold">${c.status}</div>
            ${pingStr}
            ${reason}
        `;
        
        bigBarsContainer.innerHTML += `
            <div class="tooltip bar flex-1 ${color} ${height} rounded-sm">
                <div class="tooltip-text min-w-[150px]">${tooltipHtml}</div>
            </div>
        `;
    });
    
    document.getElementById('d-ping').textContent = lastPing;
    document.getElementById('d-avg-ping').textContent = avgPing;
    document.getElementById('d-uptime').textContent = `${monitor.uptime_percent}%`;
    document.getElementById('d-ssl').textContent = sslRemaining;
    document.getElementById('d-ssl-date').textContent = sslDateFormatted;
    document.getElementById('d-domain').textContent = domainRemaining;
    document.getElementById('d-domain-date').textContent = domainDateFormatted;
    renderSecurityHeaderTile(monitor);

    const eventsTbody = document.getElementById('d-events');
    eventsTbody.innerHTML = '';
    
    const events = [...checks].reverse().filter(c => c.status === 'DOWN' || c.root_cause !== 'NONE');
    
    if (events.length === 0) {
        eventsTbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-500">Tidak ada event/masalah tercatat.</td></tr>`;
    } else {
        events.forEach(c => {
            const info = getRootCauseInfo(c.root_cause);
            const statusColor = c.status === 'DOWN' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-orange-500/10 text-orange-400 border-orange-500/20';

            // [BUG FIX] Root cause disimpan sebagai data-attribute (bukan
            // markup tooltip di dalam baris). showEventTooltip() membaca
            // atribut ini lalu merender ke tooltip BERSAMA di body, supaya
            // tooltip tidak pernah kepotong container tabel yang overflow.
            eventsTbody.innerHTML += `
                <tr class="hover:bg-[#1f2631] transition-colors">
                    <td class="p-4 text-center">
                        <span class="${statusColor} border px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">${c.status}</span>
                    </td>
                    <td class="p-4 text-gray-300 whitespace-nowrap text-[12px]">${formatDate(c.checked_at)}</td>
                    <td class="p-4">
                        <div class="inline-block cursor-help"
                             data-root-cause="${escapeHtml(c.root_cause)}"
                             onmouseenter="showEventTooltip(event)"
                             onmouseleave="hideEventTooltip()">
                            <div class="flex items-center gap-1.5">
                                <span class="text-[13px]">${info.icon}</span>
                                <code class="text-[11px] ${info.color} font-mono bg-black/20 px-1.5 py-0.5 rounded border border-current/20">${escapeHtml(c.root_cause)}</code>
                            </div>
                        </div>
                    </td>
                    <!-- [SECURITY FIX] Temuan #2: escapeHtml() untuk detail_message di tabel event -->
                    <td class="p-4 text-gray-400 font-mono text-[11px] truncate max-w-xs" title="${escapeHtml(c.detail_message || '')}">${escapeHtml(c.detail_message || '-')}</td>
                </tr>
            `;
        });
    }
}

/**
 * [FEAT] Isi tile "Security Header" di panel detail: skor 0-100 -> huruf
 * (A/B/C/D/F), plus tooltip daftar header yang hilang.
 */
function renderSecurityHeaderTile(monitor) {
    const gradeEl = document.getElementById('d-secheaders-grade');
    const tooltipEl = document.getElementById('d-secheaders-tooltip');
    const score = monitor.security_header_score;

    if (score === null || score === undefined) {
        gradeEl.textContent = 'N/A';
        gradeEl.className = 'text-xl font-semibold text-gray-500 tracking-tight';
        tooltipEl.innerHTML = `<div class="text-gray-400">Belum ada data — monitor belum pernah berhasil menerima response HTTP.</div>`;
        return;
    }

    let grade, colorClass;
    if (score >= 90) { grade = 'A'; colorClass = 'text-emerald-400'; }
    else if (score >= 75) { grade = 'B'; colorClass = 'text-emerald-400'; }
    else if (score >= 50) { grade = 'C'; colorClass = 'text-yellow-400'; }
    else if (score >= 25) { grade = 'D'; colorClass = 'text-orange-400'; }
    else { grade = 'F'; colorClass = 'text-red-400'; }

    gradeEl.textContent = `${grade} (${score})`;
    gradeEl.className = `text-xl font-semibold ${colorClass} tracking-tight`;

    const missing = monitor.security_headers_missing || [];
    if (missing.length === 0) {
        tooltipEl.innerHTML = `<div class="text-emerald-400 font-medium">✅ Semua header keamanan lengkap</div>`;
    } else {
        const missingList = missing.map((h) => `<li>• ${escapeHtml(h)}</li>`).join('');
        tooltipEl.innerHTML = `
            <div class="font-medium text-gray-300 mb-1">Header yang belum ada:</div>
            <ul class="text-[11px] text-amber-300 space-y-0.5">${missingList}</ul>
        `;
    }
}

/**
 * [BUG FIX] Tooltip "Akar Masalah" di tabel Log Kejadian dulu terpotong
 * karena tabelnya dibungkus container `overflow-hidden`/`overflow-x-auto`
 * (untuk scroll tabel) — elemen `position: absolute` di dalamnya ikut
 * kepotong oleh overflow itu, apapun arah bukanya (atas/bawah).
 *
 * Solusinya: pakai SATU tooltip bersama yang ditempel langsung ke <body>
 * (di luar semua container overflow), diposisikan `position: fixed` pakai
 * koordinat asli baris yang di-hover. Karena `fixed` dihitung relatif ke
 * viewport (bukan container manapun), ia tidak akan pernah kepotong.
 */
function showEventTooltip(e) {
    const trigger = e.currentTarget;
    const rootCause = trigger.dataset.rootCause;
    const info = getRootCauseInfo(rootCause);
    const tooltip = document.getElementById('shared-event-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = `
        <div class="text-[12px] font-semibold text-white mb-1">${info.icon} ${info.label}</div>
        <div class="text-[11px] text-gray-400 leading-relaxed">${info.desc}</div>
        ${info.action ? `<div class="mt-1 text-[10px] text-amber-300 font-medium border-t border-gray-700 pt-1">📞 ${info.action}</div>` : ''}
        <div class="text-[9px] text-gray-600 mt-1.5">Klik "Panduan Error" di navbar untuk detail lengkap</div>
    `;

    tooltip.classList.remove('hidden');
    const tooltipHeight = tooltip.offsetHeight;
    const tooltipWidth = tooltip.offsetWidth;
    const rect = trigger.getBoundingClientRect();

    // Vertikal: default di ATAS trigger, balik ke BAWAH kalau ruang atas kurang.
    let top;
    if (rect.top >= tooltipHeight + 12) {
        top = rect.top - tooltipHeight - 8;
    } else {
        top = rect.bottom + 8;
    }

    // Horizontal: rata kiri dengan trigger, tapi jangan sampai keluar layar kanan.
    let left = rect.left;
    if (left + tooltipWidth > window.innerWidth - 12) {
        left = window.innerWidth - tooltipWidth - 12;
    }
    if (left < 12) left = 12;

    tooltip.style.top = `${Math.max(8, top)}px`;
    tooltip.style.left = `${left}px`;
}

function hideEventTooltip() {
    const tooltip = document.getElementById('shared-event-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

// Tutup tooltip kalau user scroll (baris yang di-hover bisa geser posisi,
// sementara tooltip-nya fixed di layar) -- capture:true agar tertangkap
// dari scroll container manapun, termasuk yang di dalam tabel.
window.addEventListener('scroll', hideEventTooltip, true);

function formatDate(sqliteDateStr) {
    if (!sqliteDateStr) return 'N/A';
    const isoStr = sqliteDateStr.replace(' ', 'T') + 'Z';
    const d = new Date(isoStr);
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute:'2-digit', second:'2-digit' });
}

// ============================================================
// KAMUS MODAL: Buka, Tutup, dan Filter
// ============================================================
function openKamusModal() {
    document.getElementById('kamus-modal').classList.remove('hidden');
    document.getElementById('kamus-search').value = '';
    filterKamus('');
    document.getElementById('kamus-search').focus();
    document.body.style.overflow = 'hidden';
}

function closeKamusModal() {
    document.getElementById('kamus-modal').classList.add('hidden');
    document.body.style.overflow = '';
}

function handleKamusBackdrop(event) {
    // Tutup modal hanya jika klik di luar panel (backdrop)
    if (event.target === document.getElementById('kamus-modal')) {
        closeKamusModal();
    }
}

function filterKamus(query) {
    const q = query.toLowerCase().trim();
    const items = document.querySelectorAll('#kamus-content .kamus-item');
    const sections = document.querySelectorAll('#kamus-content .kamus-section');

    items.forEach(item => {
        const codes = Array.from(item.querySelectorAll('.kamus-code')).map(el => el.textContent.toLowerCase()).join(' ');
        const desc = (item.querySelector('.kamus-desc')?.textContent || '').toLowerCase();
        const title = item.querySelector('span.text-white')?.textContent.toLowerCase() || '';
        const match = q === '' || codes.includes(q) || desc.includes(q) || title.includes(q);
        item.style.display = match ? '' : 'none';
    });

    // Sembunyikan section header jika semua item-nya tersembunyi
    sections.forEach(section => {
        const visibleItems = Array.from(section.querySelectorAll('.kamus-item')).some(el => el.style.display !== 'none');
        section.style.display = visibleItems ? '' : 'none';
    });
}

// Tutup modal dengan tombol Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeKamusModal();
});
