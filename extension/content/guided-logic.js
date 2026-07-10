// guided-logic.js - Guides beneficiary through account deletion
// CF1 Fix: Reads credentials from chrome.storage.session instead of prompt()
// PG3 Fix: Detects CAPTCHAs and pauses for manual completion

let currentStep = 0;
let guideSteps = [];
let isActive = false;
let storedCredentials = null;

// Platform-specific step definitions
const PLATFORM_STEPS = {
    facebook: [
        { type: 'navigate', url: '/settings', instruction: 'Opening Settings...' },
        { type: 'wait', selector: '[role="main"]', instruction: 'Waiting for settings to load...' },
        { type: 'click', selector: 'a[href*="privacy"]', text: 'Privacy', instruction: 'Click Privacy Settings' },
        { type: 'click', selector: 'a[href*="deactivation"]', text: 'Deactivation', instruction: 'Click Deactivation and Deletion' },
        { type: 'click', text: 'Delete Account', instruction: 'Select Delete Account' },
        { type: 'fill_password', instruction: 'Entering password...' },
        { type: 'captcha_check', instruction: 'Checking for security verification...' },
        { type: 'click', text: 'Delete Account', instruction: 'Click final Delete button to confirm' }
    ],
    google: [
        { type: 'navigate', url: '/account', instruction: 'Opening Google Account...' },
        { type: 'click', selector: 'a[href*="delete-account"]', text: 'Delete', instruction: 'Click Delete Account' },
        { type: 'wait', selector: 'input[type="password"]', instruction: 'Verify your identity...' },
        { type: 'fill_password', instruction: 'Entering password...' },
        { type: 'captcha_check', instruction: 'Checking for security verification...' },
        { type: 'click', text: 'Delete', instruction: 'Confirm deletion' }
    ],
    instagram: [
        { type: 'navigate', url: '/accounts/remove/request/permanent/', instruction: 'Opening Instagram deletion page...' },
        { type: 'wait', selector: 'select, input[type="password"]', instruction: 'Waiting for deletion form...' },
        { type: 'fill_password', instruction: 'Entering password...' },
        { type: 'captcha_check', instruction: 'Checking for security verification...' },
        { type: 'click', text: 'Delete', instruction: 'Click Delete' }
    ],
    tiktok: [
        { type: 'navigate', url: '/settings/account/delete', instruction: 'Opening TikTok deletion page...' },
        { type: 'wait', selector: 'button', instruction: 'Waiting for page to load...' },
        { type: 'captcha_check', instruction: 'Checking for security verification...' },
        { type: 'click', text: 'Delete', instruction: 'Click Delete Account' }
    ],
    twitter: [
        { type: 'navigate', url: '/settings/deactivate', instruction: 'Opening Twitter deactivation page...' },
        { type: 'wait', selector: 'input[type="password"]', instruction: 'Waiting for verification...' },
        { type: 'fill_password', instruction: 'Entering password...' },
        { type: 'captcha_check', instruction: 'Checking for security verification...' },
        { type: 'click', text: 'Deactivate', instruction: 'Confirm deactivation' }
    ]
};

// ---------- CAPTCHA Detection Selectors ----------
const CAPTCHA_SELECTORS = [
    'iframe[src*="captcha"]',
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'div[class*="captcha"]',
    'div[class*="Captcha"]',
    'div[id*="captcha"]',
    '#captcha',
    '.g-recaptcha',
    '.h-captcha',
    'div[data-sitekey]',
    'iframe[title*="reCAPTCHA"]',
    'iframe[title*="challenge"]'
];

// Listen for start message from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'start_guide' && message.platform) {
        startGuide(message.platform);
        sendResponse({ status: 'started' });
    }
});

// ---------- Init: Auto-start guide if in settlement mode ----------
function initGuide() {
    if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(['settlementMode', 'settlementPlatform', 'settlementCredentials'], (result) => {
            if (result.settlementMode && result.settlementPlatform && result.settlementCredentials) {
                storedCredentials = result.settlementCredentials;
                // Small delay to let the page load
                setTimeout(() => {
                    // Check if we're on the login page — if so, auto-fill first
                    if (isLoginPage()) {
                        autoFillLogin();
                    } else {
                        startGuide(result.settlementPlatform);
                    }
                }, 1500);
            }
        });
    }
}

function isLoginPage() {
    const url = window.location.href.toLowerCase();
    return url.includes('/login') || url.includes('/signin') || url.includes('/accounts/login');
}

// CF1 Fix: Auto-fill login credentials from session storage
function autoFillLogin() {
    if (!storedCredentials) return;

    showTooltip('Logging in automatically...', null);

    // Try to fill username/email
    const usernameSelectors = [
        'input[type="email"]',
        'input[type="text"][name="email"]',
        'input[name="username"]',
        'input[name="email"]',
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

    for (const selector of usernameSelectors) {
        const el = document.querySelector(selector);
        if (el) {
            fillInput(el, storedCredentials.username);
            usernameFilled = true;
            break;
        }
    }

    for (const selector of passwordSelectors) {
        const el = document.querySelector(selector);
        if (el) {
            fillInput(el, storedCredentials.password);
            passwordFilled = true;
            break;
        }
    }

    if (usernameFilled && passwordFilled) {
        showTooltip('Credentials entered. Click the login button or press Enter.', null);
        // Try to find and click the submit button
        setTimeout(() => {
            const submitBtn = document.querySelector(
                'button[type="submit"], input[type="submit"], button[name="login"]'
            ) || findByText('Log In') || findByText('Sign In') || findByText('Login') || findByText('Next');

            if (submitBtn) {
                submitBtn.click();
            }
        }, 500);
    } else if (usernameFilled) {
        // Some platforms (Google) have a two-step login — fill username first
        showTooltip('Email entered. Please proceed to the next step.', null);
        setTimeout(() => {
            const nextBtn = findByText('Next') || document.querySelector('button[type="submit"]');
            if (nextBtn) nextBtn.click();
        }, 500);
    }
}

function startGuide(platform) {
    if (isActive) {
        console.log('Guide already active');
        return;
    }

    const steps = PLATFORM_STEPS[platform];
    if (!steps) {
        console.error('No steps defined for platform:', platform);
        showTooltip('Platform not supported yet. Manual deletion required.', null);
        return;
    }

    guideSteps = steps;
    currentStep = 0;
    isActive = true;

    console.log('Starting guide for', platform);
    processStep();
}

function processStep() {
    if (currentStep >= guideSteps.length) {
        completeGuide();
        return;
    }

    const step = guideSteps[currentStep];
    console.log('Step', currentStep + 1, ':', step.type);

    switch (step.type) {
        case 'navigate':
            const url = new URL(window.location.href);
            const newUrl = url.origin + step.url;
            if (!window.location.pathname.startsWith(step.url)) {
                showTooltip(step.instruction, null);
                window.location.href = newUrl;
                // Page will reload — guide resumes via initGuide()
            } else {
                currentStep++;
                processStep();
            }
            break;

        case 'wait':
            showTooltip(step.instruction, null);
            waitForElement(step.selector, (el) => {
                currentStep++;
                processStep();
            }, 10000);
            break;

        case 'click':
            handleClickStep(step);
            break;

        // CF1 Fix: Fill password from stored credentials instead of prompt()
        case 'fill_password':
            const passwordField = document.querySelector('input[type="password"]');
            if (passwordField && storedCredentials) {
                fillInput(passwordField, storedCredentials.password);
                showTooltip('Password entered automatically.', () => {
                    currentStep++;
                    processStep();
                });
            } else if (passwordField) {
                // Fallback: password field exists but no stored credentials
                showTooltip('Please enter the account password manually, then click Next.', () => {
                    currentStep++;
                    processStep();
                });
            } else {
                // No password field found — skip
                currentStep++;
                processStep();
            }
            break;

        // PG3 Fix: Check for CAPTCHA and pause if detected
        case 'captcha_check':
            if (detectCaptcha()) {
                showTooltip('⚠️ Security check detected. Please complete the CAPTCHA, then click Next to continue.', () => {
                    currentStep++;
                    processStep();
                });
            } else {
                // No captcha — continue immediately
                currentStep++;
                processStep();
            }
            break;

        default:
            currentStep++;
            processStep();
    }
}

function handleClickStep(step) {
    // Try CSS selector first
    let el = step.selector ? document.querySelector(step.selector) : null;

    // Fallback: try finding by text content
    if (!el && step.text) {
        el = findByText(step.text);
    }

    if (el) {
        highlightElement(el);
        showTooltip(step.instruction, () => {
            el.click();
            currentStep++;
            // Wait a moment for page to update after click
            setTimeout(() => processStep(), 1000);
        });
    } else {
        // Element not found — ask user to do it manually
        showTooltip(`Cannot find the element. Please click "${step.text || 'the button'}" manually, then click Next.`, () => {
            currentStep++;
            setTimeout(() => processStep(), 1000);
        });
    }
}

// PG3 Fix: Detect CAPTCHA elements on the page
function detectCaptcha() {
    for (const selector of CAPTCHA_SELECTORS) {
        try {
            if (document.querySelector(selector)) {
                console.log('ULegacy: CAPTCHA detected via', selector);
                return true;
            }
        } catch (e) {}
    }
    return false;
}

// Fill an input field and dispatch proper events
function fillInput(el, value) {
    // Focus the element
    el.focus();
    // Set the value
    el.value = value;
    // Dispatch events to trigger framework validation (React, Angular, etc.)
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    // For React specifically
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

function waitForElement(selector, callback, timeout) {
    const start = Date.now();
    const check = () => {
        const el = document.querySelector(selector);
        if (el) {
            callback(el);
            return;
        }
        if (Date.now() - start > timeout) {
            console.warn('Timeout waiting for element:', selector);
            callback(null);
            return;
        }
        setTimeout(check, 200);
    };
    check();
}

function findByText(text) {
    if (!text) return null;
    const elements = document.querySelectorAll('button, a, div[role="button"], span, label');
    for (const el of elements) {
        if (el.textContent && el.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
            // Prefer smaller/more specific elements
            if (el.offsetParent !== null) { // Check if visible
                return el;
            }
        }
    }
    return null;
}

function highlightElement(el) {
    el.classList.add('ulegacy-guide-highlight');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showTooltip(instruction, onNext) {
    // Remove existing tooltip
    const existing = document.querySelector('.ulegacy-guide-tooltip');
    if (existing) existing.remove();

    const tooltip = document.createElement('div');
    tooltip.className = 'ulegacy-guide-tooltip';
    tooltip.innerHTML = `
        <div>
            <span class="step-number">${currentStep + 1}</span>
            <span class="step-text">${instruction}</span>
        </div>
        ${onNext ? '<button class="step-next">Next →</button>' : ''}
    `;
    document.body.appendChild(tooltip);

    if (onNext) {
        tooltip.querySelector('.step-next').addEventListener('click', () => {
            tooltip.remove();
            onNext();
        });
    }
}

function completeGuide() {
    isActive = false;

    // Get the platform from session storage
    chrome.storage.session.get(['settlementPlatform'], (result) => {
        const platform = result.settlementPlatform || 'unknown';

        showTooltip('✅ Account deletion completed! You can close this tab.', null);

        // Notify background.js that deletion is complete
        chrome.runtime.sendMessage({
            type: 'settlement_account_deleted',
            data: { platform: platform }
        });

        // Auto-remove tooltip after 5 seconds
        setTimeout(() => {
            const tooltip = document.querySelector('.ulegacy-guide-tooltip');
            if (tooltip) tooltip.remove();
        }, 5000);
    });
}

// ---------- Init ----------
console.log('ULegacy Guided Logic loaded');
initGuide();