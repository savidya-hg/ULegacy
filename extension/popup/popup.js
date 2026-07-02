// popup.js - ES Module

// ---------- API Functions ----------
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

async function registerUser(email, recoveryKey, beneficiaryEmail) {
    return callApi('/api/users/register', 'POST', {
        email,
        recovery_key: recoveryKey,
        beneficiary_email: beneficiaryEmail
    });
}

// ---------- Encryption Functions ----------
async function deriveKey(recoveryKey, salt = 'ulegacy_salt') {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(recoveryKey),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: encoder.encode(salt),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptData(data, recoveryKey) {
    const encoder = new TextEncoder();
    const key = await deriveKey(recoveryKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encoder.encode(JSON.stringify(data))
    );
    return {
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encrypted))
    };
}

async function decryptData(encryptedObj, recoveryKey) {
    const key = await deriveKey(recoveryKey);
    const iv = new Uint8Array(encryptedObj.iv);
    const data = new Uint8Array(encryptedObj.data);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
}

async function hashKeyForServer(recoveryKey) {
    const encoder = new TextEncoder();
    const data = encoder.encode(recoveryKey + 'ulegacy_salt');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- State ----------
let currentRole = 'owner';
let userId = null;
let recoveryKey = null;
let vault = { accounts: [] };
let userStatus = 'active';
let lastHeartbeat = null;
let isRegistered = false;

// DOM refs
const roleSelect = document.getElementById('roleSelect');
const ownerDash = document.getElementById('ownerDashboard');
const beneficiaryDash = document.getElementById('beneficiaryDashboard');
const statusBadge = document.getElementById('statusBadge');
const lastCheckEl = document.getElementById('lastCheck');
const statusMessage = document.getElementById('statusMessage');
const connectionStatus = document.getElementById('connectionStatus');

// ---------- Load state from storage ----------
chrome.storage.local.get([
    'userId', 'recoveryKey', 'vault', 'userStatus',
    'lastHeartbeat', 'isRegistered'
], async (result) => {
    userId = result.userId || null;
    recoveryKey = result.recoveryKey || null;
    if (result.vault) vault = result.vault;
    if (result.userStatus) userStatus = result.userStatus;
    if (result.lastHeartbeat) lastHeartbeat = result.lastHeartbeat;
    if (result.isRegistered) isRegistered = result.isRegistered;

    updateStatusUI();
    renderOwnerDashboard();

    // Check connection to backend
    await checkConnection();
});

// ---------- Check Connection ----------
async function checkConnection() {
    try {
        const response = await fetch(`${API_BASE}/`);
        if (response.ok) {
            connectionStatus.style.color = '#28a745';
        } else {
            connectionStatus.style.color = '#dc3545';
        }
    } catch (e) {
        connectionStatus.style.color = '#dc3545';
    }
}

// ---------- Role switching ----------
roleSelect.addEventListener('change', () => {
    currentRole = roleSelect.value;
    if (currentRole === 'owner') {
        ownerDash.classList.remove('hidden');
        beneficiaryDash.classList.add('hidden');
    } else {
        ownerDash.classList.add('hidden');
        beneficiaryDash.classList.remove('hidden');
    }
});

// ---------- Status UI ----------
function updateStatusUI() {
    let badgeClass = 'badge-active';
    let label = 'Active';
    if (userStatus === 'inactive') {
        badgeClass = 'badge-inactive';
        label = 'Inactive';
    } else if (userStatus === 'grace_period') {
        badgeClass = 'badge-grace';
        label = 'Grace Period';
    } else if (userStatus === 'deceased' || userStatus === 'settled') {
        badgeClass = 'badge-settled';
        label = userStatus === 'settled' ? 'Settled' : 'Deceased';
    }
    statusBadge.className = `badge ${badgeClass}`;
    statusBadge.textContent = `● ${label}`;

    if (lastHeartbeat) {
        const date = new Date(lastHeartbeat);
        lastCheckEl.textContent = `Last check: ${date.toLocaleString()}`;
    } else {
        lastCheckEl.textContent = 'Last check: never';
    }
}

// ---------- Owner Functions ----------
function renderOwnerDashboard() {
    const list = document.getElementById('accountList');
    if (!vault.accounts) vault.accounts = [];
    list.innerHTML = '';

    if (vault.accounts.length === 0) {
        list.innerHTML = '<div class="account-item" style="color:#6c757d;font-size:12px;border-left-color:#e9ecf2;">No accounts added yet</div>';
    }

    vault.accounts.forEach((acc, index) => {
        const div = document.createElement('div');
        div.className = 'account-item';
        div.innerHTML = `
            <span class="platform">${acc.platform}</span>
            <span class="username">${acc.username}</span>
            <span class="status-badge status-active">Active</span>
            <button data-index="${index}" class="remove-account" title="Remove">✕</button>
        `;
        list.appendChild(div);
    });

    document.getElementById('accountCount').textContent = vault.accounts.length;

    list.querySelectorAll('.remove-account').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const idx = parseInt(e.target.dataset.index);
            vault.accounts.splice(idx, 1);
            await saveVaultLocal();
            renderOwnerDashboard();
        });
    });

    document.getElementById('recoveryKeyDisplay').textContent = recoveryKey || 'Not set';

    // Show beneficiary email if saved
    if (vault.beneficiaryEmail) {
        document.getElementById('beneficiaryEmail').value = vault.beneficiaryEmail;
    }
}

// Copy key
document.getElementById('copyKeyBtn').addEventListener('click', () => {
    if (recoveryKey) {
        navigator.clipboard.writeText(recoveryKey).then(() => {
            const btn = document.getElementById('copyKeyBtn');
            btn.textContent = '✅';
            setTimeout(() => btn.textContent = '📋', 1500);
        });
    }
});

// Add Account
document.getElementById('addAccountBtn').addEventListener('click', () => {
    document.getElementById('addAccountForm').classList.toggle('hidden');
});

document.getElementById('cancelAddBtn').addEventListener('click', () => {
    document.getElementById('addAccountForm').classList.add('hidden');
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
});

document.getElementById('saveAccountBtn').addEventListener('click', async () => {
    const platform = document.getElementById('platformSelect').value;
    const username = document.getElementById('usernameInput').value;
    const password = document.getElementById('passwordInput').value;

    if (!username || !password) {
        showStatus('Please fill in all fields', 'error');
        return;
    }

    if (!recoveryKey) {
        showStatus('Please generate a Recovery Key first', 'error');
        return;
    }

    if (!vault.accounts) vault.accounts = [];
    vault.accounts.push({ platform, username, password });
    await saveVaultLocal();
    renderOwnerDashboard();
    document.getElementById('addAccountForm').classList.add('hidden');
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
    showStatus('Account added successfully', 'success');
});

// Save Beneficiary
document.getElementById('saveBeneficiaryBtn').addEventListener('click', async () => {
    const email = document.getElementById('beneficiaryEmail').value;
    if (!email) {
        showStatus('Please enter an email', 'error');
        return;
    }
    if (!email.includes('@')) {
        showStatus('Please enter a valid email', 'error');
        return;
    }
    vault.beneficiaryEmail = email;
    await saveVaultLocal();
    showStatus('Beneficiary saved', 'success');
});

// Generate Recovery Key
document.getElementById('generateKeyBtn').addEventListener('click', async () => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    recoveryKey = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ recoveryKey });
    document.getElementById('recoveryKeyDisplay').textContent = recoveryKey;
    showStatus('New Recovery Key generated! Save it securely.', 'success');
    await saveVaultLocal();
});

// Reset Timer (I'm Alive)
document.getElementById('resetTimerBtn').addEventListener('click', async () => {
    if (!userId) {
        await registerUserWithBackend();
        if (!userId) return;
    }

    try {
        const result = await sendHeartbeat(userId);
        const now = new Date().toISOString();
        userStatus = result.user_status || 'active';
        lastHeartbeat = now;
        await chrome.storage.local.set({ userStatus, lastHeartbeat });
        updateStatusUI();
        showStatus('✅ Timer reset successfully!', 'success');
    } catch (e) {
        showStatus('❌ Error resetting timer: ' + e.message, 'error');
    }
});

// Test Trigger (30-day simulation)
document.getElementById('testTriggerBtn').addEventListener('click', async () => {
    if (!userId) {
        await registerUserWithBackend();
        if (!userId) return;
    }

    try {
        // Simulate 30-day inactivity by updating last_heartbeat to 31 days ago
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 31);
        const response = await fetch(`${API_BASE}/api/admin/simulate-inactivity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, date: oldDate.toISOString() })
        });
        if (response.ok) {
            showStatus('🧪 Test triggered! Check grace period status.', 'success');
            // Refresh status
            chrome.storage.local.get(['userStatus'], (result) => {
                if (result.userStatus) {
                    userStatus = result.userStatus;
                    updateStatusUI();
                }
            });
        } else {
            showStatus('❌ Test failed: ' + await response.text(), 'error');
        }
    } catch (e) {
        showStatus('❌ Test failed: ' + e.message, 'error');
    }
});

// ---------- Register User ----------
async function registerUserWithBackend() {
    const email = prompt('Enter your email to register:');
    if (!email) return false;

    if (!recoveryKey) {
        showStatus('Please generate a Recovery Key first', 'error');
        return false;
    }

    try {
        const beneficiaryEmail = vault.beneficiaryEmail || null;
        const result = await registerUser(email, recoveryKey, beneficiaryEmail);
        userId = result.id;
        isRegistered = true;
        await chrome.storage.local.set({ userId, isRegistered });
        showStatus('✅ Registered successfully!', 'success');
        return true;
    } catch (e) {
        showStatus('❌ Registration failed: ' + e.message, 'error');
        return false;
    }
}

// ---------- Save Vault ----------
async function saveVaultLocal() {
    if (!recoveryKey) {
        showStatus('Please generate a Recovery Key first', 'error');
        return;
    }

    const encrypted = await encryptData(vault, recoveryKey);
    await chrome.storage.local.set({ vault: vault });

    if (userId && isRegistered) {
        const encryptedStr = JSON.stringify(encrypted);
        const metadata = { accounts: vault.accounts.map(a => ({ platform: a.platform })) };
        try {
            await saveVault(userId, encryptedStr, metadata);
            console.log('Vault synced to server');
        } catch (e) {
            console.error('Failed to sync vault', e);
        }
    }
}

// ---------- Beneficiary Functions ----------
document.getElementById('beneficiaryVerifyBtn').addEventListener('click', async () => {
    const key = document.getElementById('beneficiaryKeyInput').value;
    const userIdInput = document.getElementById('beneficiaryUserIdInput').value;

    if (!key || !userIdInput) {
        showStatus('Please enter both Recovery Key and User ID', 'error');
        return;
    }

    try {
        const result = await verifyRecovery(userIdInput, key);
        if (result.settlement_token) {
            const vaultData = await getVault(userIdInput);
            if (vaultData.encrypted_data) {
                const encObj = JSON.parse(vaultData.encrypted_data);
                const decrypted = await decryptData(encObj, key);

                const container = document.getElementById('settlementAccounts');
                container.innerHTML = '<h4 style="font-size:13px;margin-bottom:8px;">📋 Accounts to Delete</h4>';

                if (!decrypted.accounts || decrypted.accounts.length === 0) {
                    container.innerHTML += '<p style="color:#6c757d;font-size:12px;">No accounts found</p>';
                    return;
                }

                decrypted.accounts.forEach((acc, idx) => {
                    const div = document.createElement('div');
                    div.className = 'account-item';
                    div.innerHTML = `
                        <span class="platform">${acc.platform}</span>
                        <span class="username">${acc.username}</span>
                        <button class="delete-account-btn" data-idx="${idx}" data-platform="${acc.platform}">Delete</button>
                    `;
                    container.appendChild(div);
                });

                container.querySelectorAll('.delete-account-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const idx = parseInt(e.target.dataset.idx);
                        const platform = e.target.dataset.platform;
                        const account = decrypted.accounts[idx];

                        if (confirm(`Are you sure you want to delete ${platform} account (${account.username})? This cannot be undone.`)) {
                            // Start guided deletion
                            chrome.runtime.sendMessage({
                                type: 'start_guide',
                                platform: platform
                            });

                            showStatus(`🗑️ Deleting ${platform}... Follow the guided steps.`, 'success');

                            // In production: mark as deleted after completion
                            // For demo: we'll just update UI
                            e.target.textContent = 'Deleted';
                            e.target.disabled = true;
                            e.target.style.background = '#6c757d';
                        }
                    });
                });

                showStatus('✅ Settlement loaded successfully', 'success');
            }
        }
    } catch (e) {
        showStatus('❌ Verification failed: ' + e.message, 'error');
    }
});

// ---------- Helpers ----------
function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message';
    if (type === 'success') statusMessage.classList.add('success');
    if (type === 'error') statusMessage.classList.add('error');
    setTimeout(() => {
        statusMessage.textContent = '';
        statusMessage.className = 'status-message';
    }, 5000);
}

// ---------- Init ----------
chrome.storage.local.get(['userId'], (result) => {
    if (!result.userId) {
        const newId = 'demo-' + Date.now();
        chrome.storage.local.set({ userId: newId });
        userId = newId;
    } else {
        userId = result.userId;
    }
});