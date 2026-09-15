const API_URL = '/api';

function getToken() {
    return localStorage.getItem('sipantau_token');
}

function getUser() {
    const userStr = localStorage.getItem('sipantau_user');
    return userStr ? JSON.parse(userStr) : null;
}

function logout() {
    localStorage.removeItem('sipantau_token');
    localStorage.removeItem('sipantau_user');
    window.location.href = '/';
}

async function apiRequest(endpoint, method = 'GET', body = null) {
    const headers = {
        'Content-Type': 'application/json'
    };
    
    const token = getToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
        method,
        headers,
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${API_URL}${endpoint}`, options);
        const data = await response.json();
        
        if (response.status === 401 || response.status === 403) {
            // Only force redirect to login if we are explicitly on the admin page
            if (window.location.pathname.includes('admin')) {
                 logout();
                 window.location.href = '/login.html';
            }
        }
        
        return { status: response.status, data };
    } catch (error) {
        console.error('API Error:', error);
        return { status: 500, data: { success: false, error: 'Network error' } };
    }
}
