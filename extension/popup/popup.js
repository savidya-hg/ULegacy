// popup.js - ES Module
// Main popup controller for both Owner and Beneficiary dashboards.

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

async function verifyRecovery(userId, recoveryKeyHash) {
    return callApi('/api/settlement/verify', 'POST', {
        user_id: userId,
        recovery_key_hash: recoveryKeyHash
    });
}

async function registerUser(email, recoveryKeyHash, beneficiaryEmail) {
    return callApi('/api/users/register', 'POST', {
        email,
        recovery_key_hash: recoveryKeyHash,
        beneficiary_email: beneficiaryEmail
    });
}

async function completeSettlementApi(userId) {
    return callApi('/api/settlement/complete', 'POST', { user_id: userId });
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

// ---------- CF4 Fix: Client-Side Key Hashing ----------
// SHA-256 hash the recovery key before sending to the server.
// The raw key NEVER leaves the browser — only this hash is transmitted.
async function hashKeyForServer(recoveryKey) {
    const encoder = new TextEncoder();
    const data = encoder.encode(recoveryKey);
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
let ownerEmail = null;
let beneficiarySession = null; // Stores { userId, recoveryKey, decryptedVault }
let settlementUserId = null; // For beneficiary: the owner's user ID

// DOM refs
const roleSelect = document.getElementById('roleSelect');
const ownerDash = document.getElementById('ownerDashboard');
const beneficiaryDash = document.getElementById('beneficiaryDashboard');
const statusBadge = document.getElementById('statusBadge');
const lastCheckEl = document.getElementById('lastCheck');
const statusMessage = document.getElementById('statusMessage');
const connectionStatus = document.getElementById('connectionStatus');

// ---------- Load state from storage (single init point) ----------
chrome.storage.local.get([
    'userId', 'recoveryKey', 'encryptedVault', 'userStatus',
    'lastHeartbeat', 'isRegistered', 'beneficiaryEmail', 'ownerEmail'
], async (result) => {
    userId = result.userId || null;
    recoveryKey = result.recoveryKey || null;
    if (result.userStatus) userStatus = result.userStatus;
    if (result.lastHeartbeat) lastHeartbeat = result.lastHeartbeat;
    if (result.isRegistered) isRegistered = result.isRegistered;
    ownerEmail = result.ownerEmail || null;

    // Decrypt vault from local storage if we have the key
    if (result.encryptedVault && recoveryKey) {
        try {
            vault = await decryptData(result.encryptedVault, recoveryKey);
        } catch (e) {
            console.warn('Failed to decrypt local vault, starting fresh:', e);
            vault = { accounts: [] };
        }
    }

    // Restore beneficiary email into vault if it was saved separately
    if (result.beneficiaryEmail) {
        vault.beneficiaryEmail = result.beneficiaryEmail;
    }

    updateStatusUI();
    updateRegistrationUI();
    renderOwnerDashboard();

    // Check if there is an active beneficiary session in progress (session-only, in-memory)
    if (chrome.storage.session) {
        chrome.storage.session.get(['beneficiarySession'], (sessionRes) => {
            if (sessionRes.beneficiarySession) {
                beneficiarySession = sessionRes.beneficiarySession;
                settlementUserId = beneficiarySession.userId;
                
                // Populate inputs
                document.getElementById('beneficiaryKeyInput').value = beneficiarySession.recoveryKey;
                document.getElementById('beneficiaryUserIdInput').value = beneficiarySession.userId;

                // Auto-switch UI to beneficiary role
                roleSelect.value = 'beneficiary';
                currentRole = 'beneficiary';
                ownerDash.classList.add('hidden');
                beneficiaryDash.classList.remove('hidden');

                // Render dashboard directly
                renderSettlementDashboard(beneficiarySession.decryptedVault, beneficiarySession.recoveryKey);
            }
        });
    }

    // Check connection to backend and sync real status from server
    await checkConnection();
    await syncStatusFromServer();
});

// ---------- Listen for account deletion completions from background ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'account_deletion_complete') {
        const platform = message.platform;
        
        // 1. Update visual UI buttons
        const buttons = document.querySelectorAll(`.delete-account-btn[data-platform="${platform}"]`);
        buttons.forEach(btn => {
            btn.textContent = 'Deleted ✓';
            btn.disabled = true;
            btn.style.background = '#6c757d';
        });

        // 2. Update memory and storage state
        if (beneficiarySession && beneficiarySession.decryptedVault) {
            const acc = beneficiarySession.decryptedVault.accounts.find(a => a.platform === platform);
            if (acc) {
                acc.deleted = true;
                chrome.storage.session.set({ beneficiarySession });
            }
        }

        showStatus(`${platform} account deleted successfully!`, 'success');
        checkAllAccountsDeleted();
    }
});

// ---------- Check Connection & Sync Status ----------
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

// Fetch real status from server — the single source of truth.
// This keeps the popup UI in sync with the database and also writes
// the server's last_heartbeat back to local storage so the background.js
// throttle uses the correct timestamp.
async function syncStatusFromServer() {
    if (!userId || !isRegistered) return;
    try {
        const serverUser = await callApi(`/api/users/${userId}`);
        if (serverUser) {
            userStatus = serverUser.status;
            lastHeartbeat = serverUser.last_heartbeat;
            await chrome.storage.local.set({
                userStatus: userStatus,
                lastHeartbeat: lastHeartbeat
            });
            updateStatusUI();
        }
    } catch (e) {
        console.warn('Could not sync status from server:', e.message);
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
    let label = '● Active';
    if (userStatus === 'inactive') {
        badgeClass = 'badge-inactive';
        label = '● Inactive';
    } else if (userStatus === 'grace_period') {
        badgeClass = 'badge-grace';
        label = '⚠ Grace Period';
    } else if (userStatus === 'deceased' || userStatus === 'settling') {
        badgeClass = 'badge-settled';
        label = '◉ Settlement';
    } else if (userStatus === 'settled') {
        badgeClass = 'badge-settled';
        label = '✓ Settled';
    }
    statusBadge.className = `badge ${badgeClass}`;
    statusBadge.textContent = label;

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
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #28a745;">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            `;
            setTimeout(() => btn.innerHTML = originalHTML, 1500);
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
    // Save beneficiary email separately (unencrypted — it's not sensitive)
    await chrome.storage.local.set({ beneficiaryEmail: email });
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

// Force Reset Timer (manual override — bypasses passive monitoring throttle)
document.getElementById('resetTimerBtn').addEventListener('click', async () => {
    if (!userId || !isRegistered) {
        showStatus('Please register the owner first using the registration box.', 'error');
        return;
    }

    try {
        const result = await sendHeartbeat(userId);
        const now = new Date().toISOString();
        userStatus = result.user_status || 'active';
        lastHeartbeat = now;
        await chrome.storage.local.set({ userStatus, lastHeartbeat });
        updateStatusUI();
        showStatus('Timer force-reset! Passive monitoring will handle future heartbeats.', 'success');
    } catch (e) {
        showStatus('Error resetting timer: ' + e.message, 'error');
    }
});

// Test Trigger (30-day simulation)
document.getElementById('testTriggerBtn').addEventListener('click', async () => {
    if (!userId || !isRegistered) {
        showStatus('Please register the owner first using the registration box.', 'error');
        return;
    }

    try {
        // Simulate 30-day inactivity
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 31);
        const response = await fetch(`${API_BASE}/api/admin/simulate-inactivity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, date: oldDate.toISOString() })
        });
        if (response.ok) {
            // Now trigger the check
            const checkResponse = await fetch(`${API_BASE}/api/admin/check-inactive`);
            if (checkResponse.ok) {
                const checkResult = await checkResponse.json();
                userStatus = 'grace_period';
                await chrome.storage.local.set({ userStatus });
                updateStatusUI();
                showStatus('Test triggered! Status: Grace Period. Check your email.', 'success');
            }
        } else {
            showStatus('Test failed: ' + await response.text(), 'error');
        }
    } catch (e) {
        showStatus('Test failed: ' + e.message, 'error');
    }
});

// Test Trigger: Final Settlement (skip grace period entirely)
document.getElementById('testSettlementBtn').addEventListener('click', async () => {
    if (!userId || !isRegistered) {
        showStatus('Please register the owner first using the registration box.', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/admin/simulate-settlement`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        if (response.ok) {
            const result = await response.json();
            userStatus = 'deceased';
            await chrome.storage.local.set({ userStatus });
            updateStatusUI();
            showStatus('Final settlement triggered! Switch to Beneficiary mode to test.', 'success');
        } else {
            showStatus('Test failed: ' + await response.text(), 'error');
        }
    } catch (e) {
        showStatus('Test failed: ' + e.message, 'error');
    }
});

// ---------- Register User ----------
document.getElementById('registerOwnerBtn').addEventListener('click', async () => {
    const email = document.getElementById('ownerEmailInput').value;
    if (!email) {
        showStatus('Please enter an email address', 'error');
        return;
    }
    if (!email.includes('@')) {
        showStatus('Please enter a valid email address', 'error');
        return;
    }

    if (!recoveryKey) {
        showStatus('Please generate a Recovery Key first', 'error');
        return;
    }

    try {
        // Hash the recovery key client-side before sending
        const keyHash = await hashKeyForServer(recoveryKey);
        const beneficiaryEmail = vault.beneficiaryEmail || null;
        const result = await registerUser(email, keyHash, beneficiaryEmail);
        
        userId = result.id;
        isRegistered = true;
        ownerEmail = email;

        await chrome.storage.local.set({ userId, isRegistered, ownerEmail });
        updateRegistrationUI();
        showStatus('Registered successfully!', 'success');

        // Sync local vault to server after registration completes
        await saveVaultLocal();
    } catch (e) {
        showStatus('Registration failed: ' + e.message, 'error');
    }
});

function updateRegistrationUI() {
    const regFormRow = document.getElementById('registrationFormRow');
    const regStatusText = document.getElementById('registrationStatusText');
    const regEmailDisplay = document.getElementById('registeredEmailDisplay');

    if (isRegistered && ownerEmail) {
        if (regFormRow) regFormRow.classList.add('hidden');
        if (regStatusText) regStatusText.classList.remove('hidden');
        if (regEmailDisplay) regEmailDisplay.textContent = ownerEmail;
    } else {
        if (regFormRow) regFormRow.classList.remove('hidden');
        if (regStatusText) regStatusText.classList.add('hidden');
    }
}

// ---------- Save Vault (encrypted in local storage + server sync) ----------
async function saveVaultLocal() {
    if (!recoveryKey) {
        showStatus('Please generate a Recovery Key first', 'error');
        return;
    }

    // Encrypt vault before storing locally (Zero-Knowledge: never store plaintext)
    const encrypted = await encryptData(vault, recoveryKey);
    await chrome.storage.local.set({ encryptedVault: encrypted });

    // Also sync encrypted vault to server if registered
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
        // CF4 Fix: Hash the recovery key before sending for verification
        const keyHash = await hashKeyForServer(key);
        const result = await verifyRecovery(userIdInput, keyHash);

        if (result.settlement_token) {
            settlementUserId = userIdInput;
            const vaultData = await getVault(userIdInput);

            if (vaultData.encrypted_data) {
                // Decrypt using the raw key (never sent to server)
                const encObj = JSON.parse(vaultData.encrypted_data);
                const decrypted = await decryptData(encObj, key);

                // Save beneficiary session in memory-only storage
                beneficiarySession = {
                    userId: userIdInput,
                    recoveryKey: key,
                    decryptedVault: decrypted
                };
                
                chrome.storage.session.set({ beneficiarySession }, () => {
                    renderSettlementDashboard(decrypted, key);
                    showStatus('Settlement loaded successfully', 'success');
                });
            }
        }
    } catch (e) {
        showStatus('Verification failed: ' + e.message, 'error');
    }
});

// ---------- CF1 Fix: Settlement Dashboard with New-Tab Deletion ----------
function renderSettlementDashboard(decrypted, recoveryKeyForVault) {
    const container = document.getElementById('settlementAccounts');
    container.innerHTML = `
        <h4 style="font-size:13px;margin-bottom:8px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px; color: #dc3545;">
                <line x1="8" y1="6" x2="21" y2="6"/>
                <line x1="8" y1="12" x2="21" y2="12"/>
                <line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/>
                <line x1="3" y1="12" x2="3.01" y2="12"/>
                <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
            <span style="vertical-align:middle;">Accounts to Delete</span>
        </h4>
    `;

    if (!decrypted.accounts || decrypted.accounts.length === 0) {
        container.innerHTML += '<p style="color:#6c757d;font-size:12px;">No accounts found</p>';
        return;
    }

    decrypted.accounts.forEach((acc, idx) => {
        const div = document.createElement('div');
        div.className = 'account-item';
        
        const isDeleted = acc.deleted === true;
        div.innerHTML = `
            <span class="platform">${acc.platform}</span>
            <span class="username">${acc.username}</span>
            <button class="delete-account-btn" data-idx="${idx}" data-platform="${acc.platform}" ${isDeleted ? 'disabled style="background: #6c757d;"' : ''}>
                ${isDeleted ? 'Deleted ✓' : 'Delete'}
            </button>
        `;
        container.appendChild(div);
    });

    // CF1 Fix: "Delete" opens a NEW TAB with auto-filled credentials
    container.querySelectorAll('.delete-account-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const idx = parseInt(e.target.dataset.idx);
            const platform = e.target.dataset.platform;
            const account = decrypted.accounts[idx];

            if (confirm(`Are you sure you want to delete the ${platform} account (${account.username})? This cannot be undone.`)) {
                // Send credentials to background.js → opens new tab → auto-fills
                chrome.runtime.sendMessage({
                    type: 'open_settlement_tab',
                    data: {
                        platform: platform,
                        username: account.username,
                        password: account.password
                    }
                }, (response) => {
                    if (response && response.status === 'ok') {
                        showStatus(`Opening ${platform}... Follow the guided steps in the new tab.`, 'success');
                        e.target.textContent = 'In Progress...';
                        e.target.disabled = true;
                        e.target.style.background = '#f0ad4e';
                    } else {
                        showStatus(`Failed to open ${platform}: ${response?.message || 'Unknown error'}`, 'error');
                    }
                });
            }
        });
    });

    // CF3 Fix: Add "Complete Settlement" button
    const completeBtn = document.createElement('button');
    completeBtn.id = 'completeSettlementBtn';
    completeBtn.className = 'btn btn-danger btn-full';
    completeBtn.style.marginTop = '12px';
    completeBtn.textContent = 'Complete Settlement';
    completeBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure all accounts have been deleted? This will finalize the settlement and clear all data.')) {
            return;
        }

        try {
            // Call backend to complete settlement (deletes vault, clears tokens)
            await completeSettlementApi(settlementUserId);

            // CF3 Fix: Clear only the necessary local data
            await chrome.storage.local.remove([
                'encryptedVault',
                'recoveryKey',
                'beneficiaryEmail',
                'encryptedVault'
            ]);
            await chrome.storage.local.set({ userStatus: 'settled' });

            // Clear session storage
            if (chrome.storage.session) {
                await chrome.storage.session.clear();
            }

            // Update UI
            userStatus = 'settled';
            updateStatusUI();
            container.innerHTML = `
                <div style="text-align:center; padding: 20px;">
                    <div style="font-size: 32px; margin-bottom: 8px;">✓</div>
                    <p style="font-size: 14px; font-weight: 600; color: #28a745;">Settlement Complete</p>
                    <p style="font-size: 12px; color: #6c757d;">All accounts have been processed and data has been securely cleared.</p>
                </div>
            `;
            showStatus('Settlement completed. All data cleared.', 'success');
        } catch (e) {
            showStatus('Failed to complete settlement: ' + e.message, 'error');
        }
    });
    container.appendChild(completeBtn);
}

// Check if all accounts have been deleted (enables the Complete button)
function checkAllAccountsDeleted() {
    const buttons = document.querySelectorAll('.delete-account-btn');
    const allDone = Array.from(buttons).every(btn => btn.disabled);
    const completeBtn = document.getElementById('completeSettlementBtn');
    if (completeBtn && allDone) {
        completeBtn.style.animation = 'pulse 1s ease-in-out infinite';
    }
}

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