let monitorsList = [];

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

document.addEventListener('DOMContentLoaded', () => {
    const user = getUser();
    if (!user || user.role !== 'admin') {
        window.location.href = '/login.html';
        return;
    }
    
    const authSection = document.getElementById('auth-section');
    if (authSection) {
        authSection.innerHTML = `
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
    }
    
    fetchAdminMonitors();
    
    document.getElementById('monitor-form').addEventListener('submit', saveMonitor);
});

async function fetchAdminMonitors() {
    const res = await apiRequest('/monitors');
    if (res.data && res.data.success) {
        monitorsList = res.data.data;
        
        // Urutkan: UP hijau duluan, lalu berdasarkan nama
        monitorsList.sort((a, b) => {
            if (a.status === 'UP' && b.status !== 'UP') return -1;
            if (a.status !== 'UP' && b.status === 'UP') return 1;
            return a.name.localeCompare(b.name);
        });

        renderTable();
    }
}

let adminSearchQuery = '';

function filterAdminMonitors(query) {
    adminSearchQuery = (query || '').toLowerCase().trim();
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('admin-tbody');
    tbody.innerHTML = '';
    
    const countEl = document.getElementById('admin-monitor-count');

    if (monitorsList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-gray-500">Tidak ada monitor.</td></tr>`;
        if (countEl) countEl.textContent = '0 website';
        return;
    }

    const filtered = monitorsList.filter(m => 
        m.name.toLowerCase().includes(adminSearchQuery) || 
        m.url.toLowerCase().includes(adminSearchQuery)
    );

    if (countEl) {
        countEl.textContent = adminSearchQuery 
            ? `Menampilkan ${filtered.length} dari ${monitorsList.length} website`
            : `Total: ${monitorsList.length} website dipantau`;
    }

    if (filtered.length === 0) {
        // [SECURITY FIX] Temuan #2: escapeHtml untuk adminSearchQuery (anti self-XSS)
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-gray-500">Tidak ada website yang cocok dengan pencarian "${escapeHtml(adminSearchQuery)}".</td></tr>`;
        return;
    }
    
    filtered.forEach(m => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-[#1f2631] transition-colors';
        
        let statusBadge = '<span class="text-gray-400">UNKNOWN</span>';
        if (m.status === 'UP') {
            statusBadge = '<span class="text-emerald-400 font-medium tracking-wide flex items-center justify-center gap-1.5"><div class="w-2 h-2 rounded-full bg-emerald-400"></div> UP</span>';
        } else if (m.status === 'DOWN') {
            statusBadge = '<span class="text-red-400 font-medium tracking-wide flex items-center justify-center gap-1.5"><div class="w-2 h-2 rounded-full bg-red-400"></div> DOWN</span>';
        } else if (m.is_active === 0) {
            statusBadge = '<span class="text-yellow-400 font-medium tracking-wide flex items-center justify-center gap-1.5"><div class="w-2 h-2 rounded-full bg-yellow-400"></div> PAUSED</span>';
        }

        // [FEAT] Tombol Pause/Resume — sesuai state is_active
        const pauseLabel  = m.is_active === 1 ? '⏸ Jeda' : '▶ Aktifkan';
        const pauseClass  = m.is_active === 1
            ? 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20'
            : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20';

        // [SECURITY FIX] Temuan #2: gunakan escapeHtml() untuk m.name dan m.url
        // di dalam innerHTML untuk mencegah Stored XSS.
        tr.innerHTML = `
            <td class="p-3 text-center">${statusBadge}</td>
            <td class="p-3 font-medium text-gray-200">${escapeHtml(m.name)}</td>
            <td class="p-3 text-gray-400 truncate max-w-xs" title="${escapeHtml(m.url)}">
                <a href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer" class="hover:text-emerald-400 transition-colors">${escapeHtml(m.url)}</a>
            </td>
            <td class="p-3 text-center text-gray-400">${escapeHtml(String(m.interval_seconds))}s</td>
            <td class="p-3 text-center">
                <div class="flex items-center justify-center flex-wrap gap-1.5">
                    <button onclick="viewHistory(${m.id})" class="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors"><i class="fa-solid fa-clock-rotate-left text-[10px]"></i> Riwayat</button>
                    <button onclick="viewDeepscanHistory(${m.id})" class="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors" title="Riwayat scan subdirektori untuk defacement"><i class="fa-solid fa-shield-halved text-[10px]"></i> Deep-Scan</button>
                    <button onclick="exportCsv(${m.id})" class="bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors"><i class="fa-solid fa-file-csv text-[10px]"></i> Ekspor</button>
                    <button onclick="toggleActive(${m.id})" class="${pauseClass} px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors">${pauseLabel}</button>
                    <button onclick="editMonitor(${m.id})" class="bg-gray-500/10 hover:bg-gray-500/20 text-gray-300 border border-gray-500/20 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors"><i class="fa-solid fa-pen text-[10px]"></i> Edit</button>
                    <button onclick="deleteMonitor(${m.id})" class="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors"><i class="fa-solid fa-trash text-[10px]"></i> Hapus</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openModal(monitor = null) {
    const modal = document.getElementById('monitor-modal');
    const form = document.getElementById('monitor-form');
    form.reset();
    
    if (monitor) {
        document.getElementById('modal-title').textContent = 'Edit Monitor';
        document.getElementById('monitor-id').value = monitor.id;
        document.getElementById('m-name').value = monitor.name;
        document.getElementById('m-url').value = monitor.url;
        document.getElementById('m-interval').value = monitor.interval_seconds;
        document.getElementById('m-timeout').value = monitor.timeout_ms;
        document.getElementById('m-retries').value = monitor.retry_count ?? 2;
        document.getElementById('m-active').checked = monitor.is_active === 1;
        
        document.getElementById('m-method').value = monitor.http_method || 'GET';
        document.getElementById('m-status-codes').value = monitor.accepted_status_codes || '200-299';
        document.getElementById('m-ignore-ssl').checked = monitor.ignore_ssl === 1;
        document.getElementById('m-category').value = monitor.category || '';
        document.getElementById('m-notes').value = monitor.notes || '';
        document.getElementById('m-expected-keyword').value = monitor.expected_keyword || '';
        document.getElementById('m-check-defacement').checked = monitor.check_defacement !== 0;
    } else {
        document.getElementById('modal-title').textContent = 'Tambah Monitor';
        document.getElementById('monitor-id').value = '';
        document.getElementById('m-retries').value = 2;
        
        document.getElementById('m-method').value = 'GET';
        document.getElementById('m-status-codes').value = '200-299';
        document.getElementById('m-ignore-ssl').checked = false;
        document.getElementById('m-category').value = '';
        document.getElementById('m-notes').value = '';
        document.getElementById('m-expected-keyword').value = '';
        document.getElementById('m-check-defacement').checked = true;
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeModal() {
    const modal = document.getElementById('monitor-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function saveMonitor(e) {
    e.preventDefault();
    
    const id = document.getElementById('monitor-id').value;
    const payload = {
        name: document.getElementById('m-name').value,
        url: document.getElementById('m-url').value,
        interval_seconds: parseInt(document.getElementById('m-interval').value),
        timeout_ms: parseInt(document.getElementById('m-timeout').value),
        retry_count: parseInt(document.getElementById('m-retries').value) || 2,
        is_active: document.getElementById('m-active').checked,
        
        http_method: document.getElementById('m-method').value,
        accepted_status_codes: document.getElementById('m-status-codes').value,
        ignore_ssl: document.getElementById('m-ignore-ssl').checked,
        category: document.getElementById('m-category').value,
        notes: document.getElementById('m-notes').value,
        expected_keyword: document.getElementById('m-expected-keyword').value.trim(),
        check_defacement: document.getElementById('m-check-defacement').checked ? 1 : 0
    };
    
    let res;
    if (id) {
        res = await apiRequest(`/monitors/${id}`, 'PUT', payload);
    } else {
        res = await apiRequest('/monitors', 'POST', payload);
    }
    
    if (res.data.success) {
        closeModal();
        fetchAdminMonitors();
    } else {
        alert(res.data.error || 'Gagal menyimpan monitor');
    }
}

function editMonitor(id) {
    const monitor = monitorsList.find(m => m.id === id);
    if (monitor) openModal(monitor);
}

async function deleteMonitor(id) {
    if (confirm('Yakin ingin menghapus monitor ini beserta seluruh riwayatnya?')) {
        const res = await apiRequest(`/monitors/${id}`, 'DELETE');
        if (res.data.success) {
            fetchAdminMonitors();
        } else {
            alert('Gagal menghapus');
        }
    }
}

/**
 * [FEAT] Toggle Pause / Resume monitor secara cepat tanpa buka modal edit
 */
async function toggleActive(id) {
    const monitor = monitorsList.find(m => m.id === id);
    if (!monitor) return;

    const action = monitor.is_active === 1 ? 'jeda (Pause)' : 'aktifkan kembali (Resume)';
    if (!confirm(`Yakin ingin me-${action} monitor "${monitor.name}"?`)) return;

    const res = await apiRequest(`/monitors/${id}/toggle-active`, 'PATCH');
    if (res.data && res.data.success) {
        fetchAdminMonitors(); // Refresh tabel
    } else {
        alert(res.data?.error || 'Gagal mengubah status monitor.');
    }
}

/**
 * [FEAT] Export riwayat pengecekan monitor sebagai file CSV
 * [SECURITY FIX] Ambil nama monitor dari monitorsList (bukan dari parameter string
 * yang disisipkan ke atribut onclick) agar nama yang mengandung karakter kutip (")
 * tidak bisa memutus atribut HTML dan menyuntikkan handler event (Stored XSS).
 */
async function exportCsv(id) {
    const monitor = monitorsList.find(m => m.id === id);
    const name = monitor ? monitor.name : `monitor_${id}`;

    // Gunakan window.open untuk memicu download file
    const url = `/api/monitors/${id}/export`;
    // Tambahkan token ke header tidak bisa via window.open, jadi kita fetch manual
    try {
        const token = getToken();
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const err = await response.json();
            alert('Gagal ekspor: ' + (err.error || 'Kesalahan server'));
            return;
        }

        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `SIPANTAU_${name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
    } catch (e) {
        alert('Gagal mengunduh file: ' + e.message);
    }
}

// History
async function viewHistory(id) {
    const modal = document.getElementById('history-modal');
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">Memuat...</td></tr>';
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    const res = await apiRequest(`/monitors/${id}/history?limit=30`);
    if (res.data.success) {
        tbody.innerHTML = '';
        if (res.data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-500">Belum ada riwayat pengecekan.</td></tr>';
            return;
        }
        
        res.data.data.forEach(h => {
            const isoStr = h.checked_at.replace(' ', 'T') + 'Z';
            const timeStr = new Date(isoStr).toLocaleString('id-ID');
            const statusColor = h.status === 'UP' ? 'text-emerald-400' : 'text-red-400';
            
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-700/30';
            tr.innerHTML = `
                <td class="p-3 text-gray-300">${timeStr}</td>
                <td class="p-3 font-semibold ${statusColor}">${escapeHtml(h.status)}</td>
                <td class="p-3 text-gray-400">${h.root_cause === 'NONE' ? '-' : escapeHtml(h.root_cause)}</td>
                <td class="p-3 text-gray-400">${h.http_status_code || '-'}</td>
                <td class="p-3 text-gray-400">${h.response_time_ms ? h.response_time_ms + 'ms' : '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    }
}

function closeHistoryModal() {
    const modal = document.getElementById('history-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

/**
 * [FEAT] Riwayat deep-scan defacement subdirektori
 */
async function viewDeepscanHistory(id) {
    const modal = document.getElementById('deepscan-modal');
    const tbody = document.getElementById('deepscan-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">Memuat...</td></tr>';

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const res = await apiRequest(`/monitors/${id}/defacement-scans`);
    if (res.data && res.data.success) {
        tbody.innerHTML = '';
        if (res.data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-500">Belum ada riwayat deep-scan. Job berjalan otomatis tiap 24 jam (5 menit setelah server dinyalakan).</td></tr>';
            return;
        }

        res.data.data.forEach(s => {
            const isoStr = s.scanned_at.replace(' ', 'T') + 'Z';
            const timeStr = new Date(isoStr).toLocaleString('id-ID');
            const isClean = s.pages_flagged === 0;
            const flaggedColor = isClean ? 'text-emerald-400' : 'text-red-400 font-semibold';

            const detailHtml = isClean
                ? '<span class="text-gray-500">Tidak ada indikasi defacement</span>'
                : s.flagged_urls.map(f => `<div class="text-red-300">${escapeHtml(f.url)} <span class="text-gray-500">(pola: "${escapeHtml(f.pattern)}")</span></div>`).join('');

            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-700/30';
            tr.innerHTML = `
                <td class="p-3 text-gray-300 align-top">${timeStr}</td>
                <td class="p-3 text-gray-400 text-center align-top">${escapeHtml(s.discovery_source)}</td>
                <td class="p-3 text-gray-400 text-center align-top">${s.pages_scanned}</td>
                <td class="p-3 text-center align-top ${flaggedColor}">${s.pages_flagged}</td>
                <td class="p-3 align-top">${detailHtml}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-400">Gagal memuat riwayat deep-scan.</td></tr>';
    }
}

function closeDeepscanModal() {
    const modal = document.getElementById('deepscan-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// --- Notification Settings Logic ---
async function openNotificationModal() {
    const modal = document.getElementById('notif-modal');
    const alertBox = document.getElementById('notif-alert');
    alertBox.classList.add('hidden');
    
    try {
        const res = await apiRequest('/notifications/settings');
        if (res.data && res.data.success) {
            const s = res.data.data;
            document.getElementById('notif-tg-enable').checked = s.telegram_enabled;
            document.getElementById('notif-tg-token').value = s.telegram_bot_token || '';
            document.getElementById('notif-tg-chatid').value = s.telegram_chat_id || '';
            document.getElementById('notif-webhook-enable').checked = s.webhook_enabled;
            document.getElementById('notif-webhook-url').value = s.webhook_url || '';
        }
    } catch (e) {
        console.error('Error fetching notification settings:', e);
    }
    
    modal.classList.remove('hidden');
}

function closeNotificationModal() {
    document.getElementById('notif-modal').classList.add('hidden');
}

async function saveNotificationSettings() {
    const payload = {
        telegram_enabled: document.getElementById('notif-tg-enable').checked,
        telegram_bot_token: document.getElementById('notif-tg-token').value.trim(),
        telegram_chat_id: document.getElementById('notif-tg-chatid').value.trim(),
        webhook_enabled: document.getElementById('notif-webhook-enable').checked,
        webhook_url: document.getElementById('notif-webhook-url').value.trim()
    };
    
    const alertBox = document.getElementById('notif-alert');
    alertBox.classList.add('hidden');
    
    try {
        const res = await apiRequest('/notifications/settings', 'POST', payload);
        
        if (res.data && res.data.success) {
            alertBox.className = 'p-3 rounded text-[13px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
            alertBox.textContent = 'Pengaturan notifikasi berhasil disimpan!';
            alertBox.classList.remove('hidden');
            setTimeout(() => {
                closeNotificationModal();
            }, 1200);
        } else {
            alertBox.className = 'p-3 rounded text-[13px] font-medium bg-red-500/10 text-red-400 border border-red-500/20';
            alertBox.textContent = (res.data && res.data.error) ? res.data.error : 'Gagal menyimpan pengaturan.';
            alertBox.classList.remove('hidden');
        }
    } catch (e) {
        alertBox.className = 'p-3 rounded text-[13px] font-medium bg-red-500/10 text-red-400 border border-red-500/20';
        alertBox.textContent = 'Terjadi kesalahan sistem.';
        alertBox.classList.remove('hidden');
    }
}

async function sendTestAlert() {
    const btn = document.getElementById('btn-test-notif');
    const alertBox = document.getElementById('notif-alert');
    alertBox.classList.add('hidden');
    
    const botToken = document.getElementById('notif-tg-token').value.trim();
    const chatId = document.getElementById('notif-tg-chatid').value.trim();
    const webhookUrl = document.getElementById('notif-webhook-url').value.trim();
    
    if (!botToken && !webhookUrl) {
        alertBox.className = 'p-3 rounded text-[13px] font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
        alertBox.textContent = 'Mohon isi Bot Token dan Chat ID Telegram terlebih dahulu.';
        alertBox.classList.remove('hidden');
        return;
    }
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i> Mengirim...';
    
    try {
        const res = await apiRequest('/notifications/test', 'POST', { botToken, chatId, webhookUrl });
        
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane text-xs"></i> Kirim Pesan Tes';
        
        if (res.data && res.data.success) {
            const results = res.data.results;
            let msg = '';
            let isSuccess = false;
            
            if (results.telegram) {
                if (results.telegram.success) {
                    msg += '✅ Telegram: ' + results.telegram.message + ' ';
                    isSuccess = true;
                } else {
                    msg += '❌ Telegram: ' + results.telegram.message + ' ';
                }
            }
            if (results.webhook) {
                if (results.webhook.success) {
                    msg += '✅ Webhook: ' + results.webhook.message;
                    isSuccess = true;
                } else {
                    msg += '❌ Webhook: ' + results.webhook.message;
                }
            }
            
            alertBox.className = `p-3 rounded text-[13px] font-medium ${isSuccess ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`;
            alertBox.textContent = msg;
            alertBox.classList.remove('hidden');
        } else {
            alertBox.className = 'p-3 rounded text-[13px] font-medium bg-red-500/10 text-red-400 border border-red-500/20';
            alertBox.textContent = (res.data && res.data.error) ? res.data.error : 'Gagal mengirim pesan tes.';
            alertBox.classList.remove('hidden');
        }
    } catch (e) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane text-xs"></i> Kirim Pesan Tes';
        alertBox.className = 'p-3 rounded text-[13px] font-medium bg-red-500/10 text-red-400 border border-red-500/20';
        alertBox.textContent = 'Gagal menghubungi server: ' + e.message;
        alertBox.classList.remove('hidden');
    }
}

// ============================================================
// [FEAT] Manajemen User (Admin only)
// ============================================================
let usersList = [];

function showUserAlert(message, type) {
    const alertBox = document.getElementById('user-alert');
    const colors = {
        error: 'bg-red-500/10 text-red-400 border-red-500/20',
        success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    };
    alertBox.className = `p-3 rounded text-[13px] font-medium border ${colors[type] || colors.error}`;
    alertBox.textContent = message;
    alertBox.classList.remove('hidden');
}

async function openUserModal() {
    const modal = document.getElementById('user-modal');
    document.getElementById('user-alert').classList.add('hidden');
    document.getElementById('new-user-form').reset();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    await fetchUsers();
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function fetchUsers() {
    const tbody = document.getElementById('user-tbody');
    tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-500">Memuat...</td></tr>';

    const res = await apiRequest('/auth/users');
    if (res.data && res.data.success) {
        usersList = res.data.data;
        renderUserTable();
    } else {
        tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-red-400">Gagal memuat daftar user.</td></tr>`;
    }
}

function renderUserTable() {
    const tbody = document.getElementById('user-tbody');
    const currentUser = getUser();
    tbody.innerHTML = '';

    if (usersList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-gray-500">Belum ada user.</td></tr>`;
        return;
    }

    usersList.forEach(u => {
        const tr = document.createElement('tr');
        const roleBadge = u.role === 'admin'
            ? '<span class="text-blue-400 text-[11px] font-semibold uppercase">Admin</span>'
            : '<span class="text-gray-400 text-[11px] font-semibold uppercase">Viewer</span>';
        const isSelf = currentUser && currentUser.id === u.id;

        tr.innerHTML = `
            <td class="p-2 text-gray-200">${escapeHtml(u.username)}${isSelf ? ' <span class="text-[10px] text-gray-500">(Anda)</span>' : ''}</td>
            <td class="p-2 text-center">${roleBadge}</td>
            <td class="p-2 text-center">
                ${isSelf ? '' : `<button onclick="removeUser(${u.id})" class="text-red-400 hover:text-red-300 transition-colors" title="Hapus User"><i class="fa-solid fa-trash text-[12px]"></i></button>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function submitNewUser(e) {
    e.preventDefault();
    document.getElementById('user-alert').classList.add('hidden');

    const payload = {
        username: document.getElementById('nu-username').value.trim(),
        password: document.getElementById('nu-password').value,
        role: document.getElementById('nu-role').value,
    };

    const res = await apiRequest('/auth/users', 'POST', payload);
    if (res.data && res.data.success) {
        document.getElementById('new-user-form').reset();
        showUserAlert(`User "${payload.username}" berhasil ditambahkan.`, 'success');
        await fetchUsers();
    } else {
        showUserAlert((res.data && res.data.error) ? res.data.error : 'Gagal menambah user.', 'error');
    }
}

async function removeUser(id) {
    const target = usersList.find(u => u.id === id);
    if (!target) return;
    if (!confirm(`Yakin ingin menghapus user "${target.username}"?`)) return;

    const res = await apiRequest(`/auth/users/${id}`, 'DELETE');
    if (res.data && res.data.success) {
        showUserAlert(`User "${target.username}" berhasil dihapus.`, 'success');
        await fetchUsers();
    } else {
        showUserAlert((res.data && res.data.error) ? res.data.error : 'Gagal menghapus user.', 'error');
    }
}
