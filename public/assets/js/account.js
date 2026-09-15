// ============================================================
// [FEAT] Ganti Password — modal bersama, dipakai di index.html (viewer/admin)
// dan admin.html. Bergantung pada apiRequest()/logout() dari api.js yang
// wajib di-include SEBELUM file ini.
// ============================================================

function openChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    if (!modal) return;

    document.getElementById('cp-current').value = '';
    document.getElementById('cp-new').value = '';
    document.getElementById('cp-confirm').value = '';
    document.getElementById('cp-alert').classList.add('hidden');

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function showCpAlert(message, type) {
    const alertBox = document.getElementById('cp-alert');
    const colors = {
        error: 'bg-red-500/10 text-red-400 border-red-500/20',
        warn: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
        success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    };
    alertBox.className = `p-3 rounded text-[13px] font-medium border ${colors[type] || colors.error}`;
    alertBox.textContent = message;
    alertBox.classList.remove('hidden');
}

async function submitChangePassword(e) {
    e.preventDefault();

    const currentPassword = document.getElementById('cp-current').value;
    const newPassword = document.getElementById('cp-new').value;
    const confirmPassword = document.getElementById('cp-confirm').value;

    if (newPassword.length < 8) {
        showCpAlert('Password baru minimal 8 karakter.', 'warn');
        return;
    }
    if (newPassword !== confirmPassword) {
        showCpAlert('Konfirmasi password baru tidak cocok.', 'warn');
        return;
    }

    const submitBtn = document.getElementById('cp-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    const res = await apiRequest('/auth/password', 'PUT', { currentPassword, newPassword });

    if (submitBtn) submitBtn.disabled = false;

    if (res.data && res.data.success) {
        showCpAlert('Password berhasil diganti. Mengalihkan ke halaman login...', 'success');
        // Token lama otomatis tidak valid lagi di server (token_version berubah),
        // jadi sekalian bersihkan sesi lokal & minta login ulang.
        setTimeout(() => {
            logout();
        }, 1500);
    } else {
        showCpAlert((res.data && res.data.error) ? res.data.error : 'Gagal mengganti password.', 'error');
    }
}
