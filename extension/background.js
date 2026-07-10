// background.js - Service Worker (ES Module)
// Handles heartbeat scheduling, settlement tab management, and message routing.

const API_BASE = 'http://localhost:8000';

// ---------- API Helper ----------
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

// ---------- Platform Login URLs ----------
const PLATFORM_LOGIN_URLS = {
    facebook: 'https://www.facebook.com/login',
    google: 'https://accounts.google.com/signin',
    instagram: 'https://www.instagram.com/accounts/login/',
    tiktok: 'https://www.tiktok.com/login',
    twitter: 'https://twitter.com/i/flow/login'
};

// ---------- State ----------
let userId = null;
let userStatus = 'active';
let lastHeartbeat = null;

// Load state from storage
chrome.storage.local.get(['userId', 'userStatus', 'lastHeartbeat'], (result) => {
    userId = result.userId || null;
    userStatus = result.userStatus || 'active';
    lastHeartbeat = result.lastHeartbeat || null;
});

// ---------- Daily Heartbeat Alarm ----------
chrome.alarms.create('heartbeat', { periodInMinutes: 1440 }); // 24 hours

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'heartbeat' && userId) {
        chrome.idle.queryState(60, async (state) => {
            if (state !== 'idle') {
                try {
                    const result = await sendHeartbeat(userId);
                    const now = new Date().toISOString();
                    userStatus = result.user_status || 'active';
                    await chrome.storage.local.set({
                        lastHeartbeat: now,
                        userStatus: userStatus
                    });
                    console.log('Heartbeat sent');
                } catch (e) {
                    console.error('Heartbeat failed', e);
                }
            }
        });
    }
});

// ---------- Message Handlers ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // --- Get Status ---
    if (message.type === 'get_status') {
        chrome.storage.local.get(['userStatus', 'lastHeartbeat'], (result) => {
            sendResponse({
                status: result.userStatus || 'active',
                lastHeartbeat: result.lastHeartbeat || null
            });
        });
        return true;
    }

    // --- Reset Timer (I'm Alive) ---
    if (message.type === 'reset_timer' && userId) {
        sendHeartbeat(userId).then((result) => {
            const now = new Date().toISOString();
            chrome.storage.local.set({
                lastHeartbeat: now,
                userStatus: result.user_status || 'active'
            });
            sendResponse({ status: 'ok' });
        }).catch((e) => {
            sendResponse({ status: 'error', message: e.message });
        });
        return true;
    }

    // --- Open Settlement Tab (NEW — CF1 fix) ---
    // Called by the popup when the beneficiary clicks "Delete" on an account.
    // Opens a new tab to the platform's login page and stores credentials
    // in chrome.storage.session so content scripts can auto-fill them.
    if (message.type === 'open_settlement_tab') {
        const { platform, username, password } = message.data;
        const loginUrl = PLATFORM_LOGIN_URLS[platform];

        if (!loginUrl) {
            sendResponse({ status: 'error', message: `Unknown platform: ${platform}` });
            return true;
        }

        // Store credentials and settlement mode flag in session storage
        // (session storage is cleared when the browser closes — never persisted to disk)
        chrome.storage.session.set({
            settlementMode: true,
            settlementPlatform: platform,
            settlementCredentials: { username, password }
        }, () => {
            // Open a new tab to the platform login page
            chrome.tabs.create({ url: loginUrl }, (tab) => {
                console.log(`Settlement tab opened for ${platform}: tab ${tab.id}`);
                sendResponse({ status: 'ok', tabId: tab.id });
            });
        });
        return true;
    }

    // --- Settlement Account Deleted (from content script) ---
    // When the guided deletion completes, the content script notifies us.
    // We relay this back to any open popup.
    if (message.type === 'settlement_account_deleted') {
        const { platform } = message.data || {};
        console.log(`Account deleted: ${platform}`);

        // Clear settlement session data
        chrome.storage.session.set({
            settlementMode: false,
            settlementPlatform: null,
            settlementCredentials: null
        });

        // Broadcast to popup (it will update the dashboard)
        chrome.runtime.sendMessage({
            type: 'account_deletion_complete',
            platform: platform
        }).catch(() => {
            // Popup might not be open — that's fine
        });

        sendResponse({ status: 'ok' });
        return true;
    }

    // --- Start Guide (from popup, for active tab content script) ---
    if (message.type === 'start_guide') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'start_guide',
                    platform: message.platform
                });
            }
        });
        sendResponse({ status: 'started' });
        return true;
    }
});

// ---------- Extension Installed ----------
chrome.runtime.onInstalled.addListener(() => {
    console.log('ULegacy installed');
});