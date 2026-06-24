import { sendHeartbeat } from './utils/api.js';

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
    if (message.type === 'reset_timer' && userId) {
        sendHeartbeat(userId).then(() => {
            sendResponse({ status: 'ok' });
        }).catch((e) => {
            sendResponse({ status: 'error', message: e.message });
        });
        return true; // async response
    }
});

// When extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
    console.log('ULegacy installed');
});