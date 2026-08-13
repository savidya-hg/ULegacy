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
    instagram: 'https://www.instagram.com/accounts/login/',
    tiktok: 'https://www.tiktok.com/login'
};

// ---------- State ----------
let userId = null;
let userStatus = 'active';
let lastHeartbeat = null;
let heartbeatInFlight = false; // Prevent concurrent sends

// Load state from storage and check if a heartbeat is due (service worker startup)
chrome.storage.local.get(['userId', 'userStatus', 'lastHeartbeat'], (result) => {
    userId = result.userId || null;
    userStatus = result.userStatus || 'active';
    lastHeartbeat = result.lastHeartbeat || null;

    // Service worker just started (browser opened / extension reloaded)
    // Check if we owe a heartbeat
    if (userId) {
        maybeSendHeartbeat('startup');
    }
});

// Keep in-memory state synced when popup or other contexts update storage
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.userId) userId = changes.userId.newValue || null;
    if (changes.userStatus) userStatus = changes.userStatus.newValue || 'active';
    if (changes.lastHeartbeat) {
        lastHeartbeat = changes.lastHeartbeat.newValue || null;
        // Storage was updated (e.g. popup synced from server) — check if we owe a heartbeat
        if (userId) maybeSendHeartbeat('storage_sync');
    }
});

// ---------- Passive Activity Monitoring ----------
// The dead man's switch should ONLY trigger if there is genuinely zero browser
// usage for 30 days. We detect activity passively from multiple signals and
// send a throttled heartbeat (at most once per 23 hours).

// 1. Idle state listener — fires when the user returns from being idle/locked
//    setDetectionInterval(300) = consider "idle" after 5 minutes of inactivity
chrome.idle.setDetectionInterval(300);

chrome.idle.onStateChanged.addListener((newState) => {
    if (newState === 'active' && userId) {
        maybeSendHeartbeat('idle_active');
    }
});

// 2. Tab activation — user switched tabs (proves they're using the browser)
chrome.tabs.onActivated.addListener(() => {
    if (userId) {
        maybeSendHeartbeat('tab_activated');
    }
});

// 3. Navigation — user loaded a page
chrome.webNavigation.onCompleted.addListener(() => {
    if (userId) {
        maybeSendHeartbeat('navigation');
    }
}, { url: [{ schemes: ['http', 'https'] }] });

// 4. Backup alarm — fires every 24 hours in case the above signals miss
//    (e.g. browser left open but minimized with no tab switches)
chrome.alarms.create('heartbeat', { periodInMinutes: 1440 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'heartbeat' && userId) {
        // On alarm, check if user is active right now before sending
        chrome.idle.queryState(300, async (state) => {
            if (state === 'active') {
                await maybeSendHeartbeat('alarm');
            }
        });
    }
});

// ---------- Throttled Heartbeat Sender ----------
// Only sends if the last heartbeat was more than 23 hours ago.
// This prevents flooding the server when multiple signals fire rapidly.
const HEARTBEAT_INTERVAL_MS = 23 * 60 * 60 * 1000; // 23 hours

async function maybeSendHeartbeat(source = 'unknown') {
    if (!userId || heartbeatInFlight) return;

    // Check throttle: skip if we sent a heartbeat recently
    const now = new Date();
    if (lastHeartbeat) {
        const elapsed = now - new Date(lastHeartbeat);
        if (elapsed < HEARTBEAT_INTERVAL_MS) return;
    }

    heartbeatInFlight = true;
    try {
        const result = await sendHeartbeat(userId);
        const nowIso = now.toISOString();
        userStatus = result.user_status || 'active';
        lastHeartbeat = nowIso;
        await chrome.storage.local.set({
            lastHeartbeat: nowIso,
            userStatus: userStatus
        });
        console.log(`Heartbeat sent (source: ${source})`);
    } catch (e) {
        console.error(`Heartbeat failed (source: ${source}):`, e);
    } finally {
        heartbeatInFlight = false;
    }
}

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
    // Opens a new floating popup window to the platform's login page and stores credentials
    // in chrome.storage.session so content scripts can auto-fill them.
    if (message.type === 'open_settlement_tab') {
        const { platform, username, password } = message.data;
        const loginUrl = PLATFORM_LOGIN_URLS[platform];

        if (!loginUrl) {
            sendResponse({ status: 'error', message: `Unknown platform: ${platform}` });
            return true;
        }

        // Store credentials and settlement mode flag in session storage
        // Clear settlementDeletionDone from any previous deletion so the new
        // settlement starts fresh (auto-fill, privacy-shield, guide all active).
        chrome.storage.session.set({
            settlementMode: true,
            settlementPlatform: platform,
            settlementCredentials: { username, password },
            settlementStep: 0,
            settlementDeletionDone: false
        }, () => {
            // Open a floating popup window to the platform login page
            chrome.windows.create({
                url: loginUrl,
                type: 'popup',
                width: 1280,
                height: 720,
                focused: true
            }, (win) => {
                const tab = win.tabs ? win.tabs[0] : null;
                console.log(`Settlement window opened for ${platform}: win ${win.id}`);
                sendResponse({ status: 'ok', tabId: tab?.id, windowId: win.id });
            });
        });
        return true;
    }

    // --- Settlement Account Deleted (from content script) ---
    // When the guided deletion completes, the content script notifies us.
    // We close the temporary window and relay this back to any open popup.
    if (message.type === 'settlement_account_deleted') {
        const { platform } = message.data || {};
        console.log(`Account deleted: ${platform}`);

        // Clear settlement session data
        chrome.storage.session.set({
            settlementMode: false,
            settlementPlatform: null,
            settlementCredentials: null,
            settlementStep: 0,
            settlementDeletionDone: false
        });

        // Close the temporary popup window
        if (sender.tab && sender.tab.windowId) {
            chrome.windows.remove(sender.tab.windowId, () => {
                console.log(`Closed settlement window for ${platform}`);
            });
        }

        // Relay to popup so it updates the dashboard
        chrome.runtime.sendMessage({
            type: 'account_deletion_complete',
            platform: platform
        }).catch(() => {});

        sendResponse({ status: 'ok' });
        return true;
    }

    // --- Close Current Tab (backup for window.close()) ---
    // Content scripts can't always close their own tab; this lets them
    // ask the background to do it.
    if (message.type === 'close_current_tab') {
        if (sender.tab && sender.tab.windowId) {
            chrome.windows.remove(sender.tab.windowId, () => {
                console.log('Closed settlement window via close_current_tab');
            });
        }
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
    // Grant content scripts access to session storage.
    // Without this, content scripts cannot read settlementMode/credentials
    // and autofill silently fails.
    chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
    });
    console.log('ULegacy installed');
});

// Also set on every service worker startup (in case the worker restarts
// without triggering onInstalled, e.g. after a browser restart)
chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
}).catch(() => {});