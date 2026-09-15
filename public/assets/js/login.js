document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('error-msg');
    
    errorMsg.classList.add('hidden');
    
    const response = await apiRequest('/auth/login', 'POST', { username, password });
    
    if (response.data.success) {
        localStorage.setItem('sipantau_token', response.data.data.token);
        localStorage.setItem('sipantau_user', JSON.stringify(response.data.data.user));

        
        // Redirect based on role
        if (response.data.data.user.role === 'admin') {
            window.location.href = '/admin.html';
        } else {
            window.location.href = '/';
        }
    } else {
        errorMsg.textContent = response.data.error || 'Login gagal';
        errorMsg.classList.remove('hidden');
    }
});
