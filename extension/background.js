// background.js - Service Worker (ES Module)

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

let userId = null;
let userStatus = 'active';
let lastHeartbeat = null;

// Load state from storage
chrome.storage.local.get(['userId', 'userStatus', 'lastHeartbeat'], (result) => {
    userId = result.userId || null;
    userStatus = result.userStatus || 'active';
    lastHeartbeat = result.lastHeartbeat || null;
});

// Set up daily heartbeat
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

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'get_status') {
        chrome.storage.local.get(['userStatus', 'lastHeartbeat'], (result) => {
            sendResponse({
                status: result.userStatus || 'active',
                lastHeartbeat: result.lastHeartbeat || null
            });
        });
        return true;
    }

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

    if (message.type === 'start_guide') {
        // Send to active tab to start guided deletion
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

    if (message.type === 'delete_account') {
        // Handle account deletion request
        const { platform, user_id, recovery_key } = message.data;
        // In production, this would open the platform and start the guided process
        console.log(`Deleting ${platform} for user ${user_id}`);
        sendResponse({ status: 'processing' });
        return true;
    }
});

// When extension is installed
chrome.runtime.onInstalled.addListener(() => {
    console.log('ULegacy installed');
});