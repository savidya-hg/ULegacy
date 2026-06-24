// background.js - Service Worker (ES Module)

// Import API functions
async function callApi(endpoint, method = 'GET', body = null) {
    const API_BASE = 'http://localhost:8000';
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

// Load user ID from storage on startup
chrome.storage.local.get(['userId'], (result) => {
    userId = result.userId || null;
});

// Set up daily heartbeat
chrome.alarms.create('heartbeat', { periodInMinutes: 1440 }); // 24 hours

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'heartbeat' && userId) {
        // Check if user is active
        chrome.idle.queryState(60, async (state) => {
            if (state !== 'idle') {
                try {
                    await sendHeartbeat(userId);
                    const now = new Date().toISOString();
                    await chrome.storage.local.set({ 
                        lastHeartbeat: now,
                        userStatus: 'active'
                    });
                    console.log('Heartbeat sent');
                } catch (e) {
                    console.error('Heartbeat failed', e);
                }
            }
        });
    }
});

// Listen for manual reset from popup
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
        sendHeartbeat(userId).then(() => {
            const now = new Date().toISOString();
            chrome.storage.local.set({ lastHeartbeat: now, userStatus: 'active' });
            sendResponse({ status: 'ok' });
        }).catch((e) => {
            sendResponse({ status: 'error', message: e.message });
        });
        return true;
    }
});

// When extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
    console.log('ULegacy installed');
});