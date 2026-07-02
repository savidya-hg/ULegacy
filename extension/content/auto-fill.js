// auto-fill.js - Auto-fills credentials when needed

// Listen for auto-fill requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'auto_fill') {
        const { username, password } = message.data;
        const result = fillCredentials(username, password);
        sendResponse(result);
    }
});

function fillCredentials(username, password) {
    // Try common selectors
    const usernameSelectors = [
        'input[type="email"]',
        'input[type="text"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[placeholder*="email"]',
        'input[placeholder*="username"]',
        'input[autocomplete="username"]'
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
            el.value = username;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            usernameFilled = true;
            highlightElement(el);
            break;
        }
    }

    // Try password
    for (const selector of passwordSelectors) {
        const el = document.querySelector(selector);
        if (el && !el.value) {
            el.value = password;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            passwordFilled = true;
            highlightElement(el);
            break;
        }
    }

    return { usernameFilled, passwordFilled };
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

console.log('ULegacy Auto-Fill loaded');