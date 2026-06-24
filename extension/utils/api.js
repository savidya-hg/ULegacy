const API_BASE = 'http://localhost:8000';

async function callApi(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'API error');
    }
    return response.json();
}

// Specific endpoints
async function sendHeartbeat(userId) {
    return callApi('/api/heartbeat', 'POST', { user_id: userId });
}

async function saveVault(userId, encryptedData, metadata) {
    return callApi('/api/vault/save', 'POST', {
        user_id: userId,
        encrypted_data: encryptedData,
        platform_metadata: metadata
    });
}

async function getVault(userId) {
    return callApi(`/api/vault/${userId}`);
}

async function verifyRecovery(userId, recoveryKey) {
    return callApi('/api/settlement/verify', 'POST', {
        user_id: userId,
        recovery_key: recoveryKey
    });
}