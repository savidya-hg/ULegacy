// popup.js - ES Module

// ---------- API Functions (inline, since imports aren't working) ----------
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
let vault = {};
let userStatus = 'active';
let lastHeartbeat = null;

// DOM refs
const roleSelect = document.getElementById('roleSelect');
const ownerDash = document.getElementById('ownerDashboard');
const beneficiaryDash = document.getElementById('beneficiaryDashboard');
const statusBadge = document.getElementById('statusBadge');
const lastCheckEl = document.getElementById('lastCheck');

// ---------- Load state from storage ----------
chrome.storage.local.get(['userId', 'recoveryKey', 'vault', 'userStatus', 'lastHeartbeat'], (result) => {
    userId = result.userId || null;
    recoveryKey = result.recoveryKey || null;
    if (result.vault) vault = result.vault;
    if (result.userStatus) userStatus = result.userStatus;
    if (result.lastHeartbeat) lastHeartbeat = result.lastHeartbeat;
    updateStatusUI();
    renderOwnerDashboard();
});

// ---------- Role switching (dropdown) ----------
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
        badgeClass = 'badge-inactive';
        label = 'Settled';
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
    vault.accounts.forEach((acc, index) => {
        const div = document.createElement('div');
        div.className = 'account-item';
        div.innerHTML = `
            <span class="platform">${acc.platform}</span>
            <span>${acc.username}</span>
            <span class="status-badge status-active">Active</span>
            <button data-index="${index}" class="remove-account" title="Remove">✕</button>
        `;
        list.appendChild(div);
    });
    list.querySelectorAll('.remove-account').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            vault.accounts.splice(idx, 1);
            saveVaultLocal();
            renderOwnerDashboard();
        });
    });

    document.getElementById('recoveryKeyDisplay').textContent = recoveryKey || 'Not set';
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

document.getElementById('addAccountBtn').addEventListener('click', () => {
    document.getElementById('addAccountForm').classList.remove('hidden');
});

document.getElementById('cancelAddBtn').addEventListener('click', () => {
    document.getElementById('addAccountForm').classList.add('hidden');
});

document.getElementById('saveAccountBtn').addEventListener('click', async () => {
    const platform = document.getElementById('platformSelect').value;
    const username = document.getElementById('usernameInput').value;
    const password = document.getElementById('passwordInput').value;
    if (!username || !password) {
        alert('Please fill in all fields');
        return;
    }
    if (!vault.accounts) vault.accounts = [];
    vault.accounts.push({ platform, username, password });
    await saveVaultLocal();
    renderOwnerDashboard();
    document.getElementById('addAccountForm').classList.add('hidden');
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
});

document.getElementById('saveBeneficiaryBtn').addEventListener('click', async () => {
    const email = document.getElementById('beneficiaryEmail').value;
    if (!email) return;
    vault.beneficiaryEmail = email;
    await saveVaultLocal();
    alert('Beneficiary saved');
});

document.getElementById('generateKeyBtn').addEventListener('click', async () => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    recoveryKey = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ recoveryKey });
    document.getElementById('recoveryKeyDisplay').textContent = recoveryKey;
    alert('New Recovery Key generated. Save it securely!');
    await saveVaultLocal();
});

document.getElementById('resetTimerBtn').addEventListener('click', async () => {
    if (!userId) {
        const email = prompt('Enter your email to register:');
        if (!email) return;
        userId = 'demo-user-' + Date.now();
        await chrome.storage.local.set({ userId });
    }
    try {
        await sendHeartbeat(userId);
        document.getElementById('statusMessage').textContent = '✅ Timer reset!';
        userStatus = 'active';
        lastHeartbeat = new Date().toISOString();
        await chrome.storage.local.set({ userStatus, lastHeartbeat });
        updateStatusUI();
    } catch (e) {
        document.getElementById('statusMessage').textContent = '❌ Error resetting timer';
    }
});

async function saveVaultLocal() {
    if (!recoveryKey) {
        alert('Please generate a Recovery Key first');
        return;
    }
    const encrypted = await encryptData(vault, recoveryKey);
    await chrome.storage.local.set({ vault: vault });
    if (userId) {
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
    if (!key) {
        alert('Enter the recovery key');
        return;
    }
    const userIdFromEmail = prompt('Enter the User ID from the settlement email:');
    if (!userIdFromEmail) return;

    try {
        const result = await verifyRecovery(userIdFromEmail, key);
        if (result.settlement_token) {
            const vaultData = await getVault(userIdFromEmail);
            if (vaultData.encrypted_data) {
                const encObj = JSON.parse(vaultData.encrypted_data);
                const decrypted = await decryptData(encObj, key);
                const container = document.getElementById('settlementAccounts');
                container.innerHTML = '<h4>Accounts to Delete</h4>';
                decrypted.accounts.forEach((acc, idx) => {
                    const div = document.createElement('div');
                    div.className = 'account-item';
                    div.innerHTML = `
                        <span class="platform">${acc.platform}</span>
                        <span>${acc.username}</span>
                        <button class="delete-account-btn" data-idx="${idx}">Delete</button>
                    `;
                    container.appendChild(div);
                });
                container.querySelectorAll('.delete-account-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const idx = parseInt(e.target.dataset.idx);
                        const account = decrypted.accounts[idx];
                        alert(`Simulating deletion of ${account.platform}...`);
                        await callApi('/api/settlement/complete', 'POST', { user_id: userIdFromEmail });
                        e.target.textContent = 'Deleted';
                        e.target.disabled = true;
                    });
                });
            }
        }
    } catch (e) {
        alert('Verification failed: ' + e.message);
    }
});

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