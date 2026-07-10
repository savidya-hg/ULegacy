// auto-fill.js - Auto-fills credentials during settlement
// CF1 Fix: Now properly wired up to read from chrome.storage.session
// and fill login forms when in settlement mode.

let isSettlementMode = false;

// ---------- Init: Check if we're in settlement mode ----------
function initAutoFill() {
    if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(['settlementMode', 'settlementCredentials'], (result) => {
            if (result.settlementMode && result.settlementCredentials) {
                isSettlementMode = true;
                console.log('ULegacy Auto-Fill: Settlement mode active');

                // Wait for the page to be ready, then try to auto-fill
                if (document.readyState === 'complete') {
                    attemptAutoFill(result.settlementCredentials);
                } else {
                    window.addEventListener('load', () => {
                        attemptAutoFill(result.settlementCredentials);
                    });
                }
            } else {
                console.log('ULegacy Auto-Fill: Not in settlement mode');
            }
        });
    }
}

function attemptAutoFill(credentials) {
    // Wait for inputs to be present before attempting auto-fill
    const check = () => {
        const usernameEl = document.querySelector('input[name="username"], input[type="email"], input[type="text"]');
        const passwordEl = document.querySelector('input[type="password"]');
        if (usernameEl && passwordEl) {
            const result = fillCredentials(credentials.username, credentials.password);
            console.log('ULegacy Auto-Fill result:', result);
        } else {
            // Keep checking every 200ms
            setTimeout(check, 200);
        }
    };
    check();
}

// Listen for auto-fill requests from other content scripts or background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'auto_fill') {
        const { username, password } = message.data;
        const result = fillCredentials(username, password);
        sendResponse(result);
    }
});

function fillCredentials(username, password) {
    // Try common selectors for username/email
    const usernameSelectors = [
        'input[type="email"]',
        'input[type="text"][name="email"]',
        'input[name="username"]',
        'input[name="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="username" i]',
        'input[autocomplete="username"]',
        'input[type="text"]'
    ];

    const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[autocomplete="current-password"]'
    ];

    let usernameFilled = false;
    let passwordFilled = false;

    // Try username
    for (const selector of usernameSelectors) {
        const el = document.querySelector(selector);
        if (el && !el.value) {
            fillInput(el, username);
            usernameFilled = true;
            highlightElement(el);
            break;
        }
    }

    // Try password
    for (const selector of passwordSelectors) {
        const el = document.querySelector(selector);
        if (el && !el.value) {
            fillInput(el, password);
            passwordFilled = true;
            highlightElement(el);
            break;
        }
    }

    return { usernameFilled, passwordFilled };
}

// Fill an input with proper event dispatching (React/Angular compatible)
function fillInput(el, value) {
    el.focus();
    // Use native setter for React compatibility
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, value);
    } else {
        el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function highlightElement(el) {
    el.style.border = '2px solid #28a745';
    el.style.boxShadow = '0 0 0 3px rgba(40, 167, 69, 0.25)';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
        el.style.border = '';
        el.style.boxShadow = '';
    }, 2000);
}

// ---------- Init ----------
console.log('ULegacy Auto-Fill loaded');
initAutoFill();