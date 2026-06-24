import { encryptData, decryptData, hashKeyForServer } from '../utils/encryption.js';
import { sendHeartbeat, saveVault, getVault, verifyRecovery } from '../utils/api.js';

// ---------- State ----------
let currentRole = 'owner';
let userId = null;
let recoveryKey = null;
let vault = {};

// DOM refs
const ownerDash = document.getElementById('ownerDashboard');
const beneficiaryDash = document.getElementById('beneficiaryDashboard');
const roleOwnerBtn = document.getElementById('roleOwner');
const roleBeneficiaryBtn = document.getElementById('roleBeneficiary');

// Load state from storage
chrome.storage.local.get(['userId', 'recoveryKey', 'vault'], (result) => {
    userId = result.userId || null;
    recoveryKey = result.recoveryKey || null;
    if (result.vault) vault = result.vault;
    renderOwnerDashboard();
});

// Role switching
roleOwnerBtn.addEventListener('click', () => {
    currentRole = 'owner';
    roleOwnerBtn.classList.add('active');
    roleBeneficiaryBtn.classList.remove('active');
    ownerDash.classList.remove('hidden');
    beneficiaryDash.classList.add('hidden');
});

roleBeneficiaryBtn.addEventListener('click', () => {
    currentRole = 'beneficiary';
    roleBeneficiaryBtn.classList.add('active');
    roleOwnerBtn.classList.remove('active');
    ownerDash.classList.add('hidden');
    beneficiaryDash.classList.remove('hidden');
});

// ---------- Owner Functions ----------
function renderOwnerDashboard() {
    const list = document.getElementById('accountList');
    if (!vault.accounts) vault.accounts = [];
    list.innerHTML = '';
    vault.accounts.forEach((acc, index) => {
        const div = document.createElement('div');
        div.className = 'account-item';
        div.innerHTML = `
            <span>${acc.platform} (${acc.username})</span>
            <span class="status-badge status-active">Active</span>
            <button data-index="${index}" class="remove-account">Remove</button>
        `;
        list.appendChild(div);
    });
    // Remove handlers
    list.querySelectorAll('.remove-account').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            vault.accounts.splice(idx, 1);
            saveVaultLocal();
            renderOwnerDashboard();
        });
    });

    // Show recovery key
    document.getElementById('recoveryKeyDisplay').textContent = recoveryKey || 'Not set';
}

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
    // Generate a 32-character random key
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
        // Create user if not exists (simplified)
        const email = prompt('Enter your email to register:');
        if (!email) return;
        // In a real app, you'd call registration endpoint
        // For demo, we'll simulate
        userId = 'demo-user-' + Date.now();
        await chrome.storage.local.set({ userId });
        // Hash recovery key and send to server (simplified)
        const hash = await hashKeyForServer(recoveryKey || 'defaultkey');
        // Store user in backend (you'd have a registration endpoint)
        // We'll just assume user exists
    }
    try {
        await sendHeartbeat(userId);
        document.getElementById('statusMessage').textContent = '✅ Timer reset!';
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
    // Store locally
    await chrome.storage.local.set({ vault: vault });
    // Also send to server if user exists
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
    // In a real implementation, you'd have a user_id from the settlement email
    // For demo, we'll ask for user ID (or you could extract from token)
    const userIdFromEmail = prompt('Enter the User ID from the settlement email:');
    if (!userIdFromEmail) return;

    try {
        const result = await verifyRecovery(userIdFromEmail, key);
        if (result.settlement_token) {
            // Now fetch vault
            const vaultData = await getVault(userIdFromEmail);
            if (vaultData.encrypted_data) {
                const encObj = JSON.parse(vaultData.encrypted_data);
                const decrypted = await decryptData(encObj, key);
                // Display accounts
                const container = document.getElementById('settlementAccounts');
                container.innerHTML = '<h4>Accounts to Delete</h4>';
                decrypted.accounts.forEach((acc, idx) => {
                    const div = document.createElement('div');
                    div.className = 'account-item';
                    div.innerHTML = `
                        <span>${acc.platform} (${acc.username})</span>
                        <button class="delete-account-btn" data-idx="${idx}">Delete</button>
                    `;
                    container.appendChild(div);
                });
                // Attach delete handlers (simulated)
                container.querySelectorAll('.delete-account-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const idx = parseInt(e.target.dataset.idx);
                        const account = decrypted.accounts[idx];
                        // In real implementation, open platform and auto-fill
                        // For demo, just simulate
                        alert(`Simulating deletion of ${account.platform}...`);
                        // Call complete settlement
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

// ---------- Initialization ----------
// Check if we have a user ID from storage, else create one for demo
chrome.storage.local.get(['userId'], (result) => {
    if (!result.userId) {
        // For demo, generate a random user ID and store
        const newId = 'demo-' + Date.now();
        chrome.storage.local.set({ userId: newId });
        userId = newId;
    } else {
        userId = result.userId;
    }
});