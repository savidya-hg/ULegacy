(() => {
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
        // Instagram's specific accounts center flow
        { type: 'navigate', url: 'https://www.instagram.com/accounts/edit/', instruction: 'Opening Instagram Settings...' },
        { type: 'wait', selector: 'body', instruction: 'Waiting for settings page to load...' },
        { type: 'navigate', url: 'https://accountscenter.instagram.com/?theme=dark&entry_point=app_settings', instruction: 'Opening Accounts Center...' },
        { type: 'wait', selector: 'body', instruction: 'Waiting for Accounts Center to load...' },
        { type: 'navigate', url: 'https://accountscenter.instagram.com/manage/', instruction: 'Opening Accounts Management...' },
        { type: 'wait', selector: 'body', instruction: 'Waiting for Management page to load...' },
        { type: 'click', text: 'Manage', instruction: 'Clicking the "Manage" button...' },
        { type: 'click', text: 'Deactivation or deletion | Deactivation & deletion', instruction: 'Selecting "Deactivation or deletion"...' },
        { type: 'click', text: 'delete profile | delete account', instruction: 'Selecting "Delete profile"...' },
        { type: 'click', text: 'Continue', instruction: 'Clicking Continue...' },
        { type: 'click', text: 'Continue', instruction: 'Clicking Continue again...' },
        { type: 'click', text: 'Privacy concerns', instruction: 'Selecting "Privacy concerns" as the reason...' },
        { type: 'click', text: 'Continue', instruction: 'Clicking Continue...' },
        { type: 'click', text: 'Continue', instruction: 'Clicking Continue again...' },
        { type: 'click', text: 'Continue', instruction: 'Clicking Continue in review info...' },
        // Step 15: The script stops and waits for the HUMAN to click Continue
        { type: 'manual_click_wait', text: 'Continue', instruction: 'Meta security requires manual input. Please click the "Continue" button manually.' },
        // Wait for the modal/password field to actually render in the DOM
        { type: 'wait', selector: 'input[type="password"], input[name*="password" i], input[autocomplete*="password" i]', instruction: 'Waiting for security confirmation modal...' },
        { type: 'fill_password', instruction: 'Entering password automatically...' },
        // Sometimes the button in the modal says 'Continue', sometimes 'Submit' or 'Confirm'
        { type: 'click', text: 'Continue|Submit|Confirm', instruction: 'Clicking Continue to confirm password...' },
        { type: 'captcha_check', instruction: 'Checking for security verification...' },
        { type: 'click', text: 'Delete profile | Delete account | Delete', instruction: 'Clicking the final Delete button to confirm' }
    ],
    tiktok: [
        { type: 'navigate', url: '/settings/account/delete', instruction: 'Opening TikTok deletion page...' },
        { type: 'wait', selector: 'button', instruction: 'Waiting for page to load...' },
        { type: 'captcha_check', instruction: 'Checking for security verification...' },
        { type: 'click', text: 'Delete', instruction: 'Click Delete Account' }
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
        chrome.storage.session.get(['settlementMode', 'settlementPlatform', 'settlementCredentials', 'settlementStep'], (result) => {
            if (result.settlementMode && result.settlementPlatform && result.settlementCredentials) {
                storedCredentials = result.settlementCredentials;
                currentStep = result.settlementStep || 0;
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

    showTooltip('Waiting for login form...', null);

    // Wait for the password field (if password field is loaded, username field is definitely loaded too)
    waitForElement('input[type="password"], input[name="password"]', (passwordField) => {
        if (!passwordField) {
            console.warn('ULegacy: Login form fields not found');
            showTooltip('Unable to find login form. Please log in manually.', null);
            return;
        }

        showTooltip('Logging in automatically...', null);

        // Try to fill username/email
        const usernameSelectors = [
            'input[name="username"]',
            'input[type="email"]',
            'input[type="text"][name="email"]',
            'input[name="email"]',
            'input[autocomplete="username"]',
            'input[type="text"]'
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

        // Fill password using the matched element
        fillInput(passwordField, storedCredentials.password);
        passwordFilled = true;

        if (usernameFilled && passwordFilled) {
            showTooltip('Credentials entered. Logging in...', null);
            // Try to find and click the submit button
            setTimeout(() => {
                const submitBtn = document.querySelector(
                    'button[type="submit"], input[type="submit"], button[name="login"]'
                ) || findByText('Log In') || findByText('Sign In') || findByText('Login') || findByText('Next');

                if (submitBtn) {
                    simulateReactClick(submitBtn);
                }
            }, 800);
        }
    }, 10000);
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
    // Keep the step loaded in initGuide, fallback to 0
    if (currentStep === undefined || currentStep === null || currentStep >= guideSteps.length) {
        currentStep = 0;
    }
    isActive = true;

    console.log('Starting/resuming guide for', platform, 'at step', currentStep);
    processStep();
}

function saveStepAndProcess() {
    if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.set({ settlementStep: currentStep }, () => {
            console.log('ULegacy Guide: step saved to session storage:', currentStep);
            processStep();
        });
    } else {
        processStep();
    }
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
            let targetUrl = step.url;
            if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                targetUrl = window.location.origin + targetUrl;
            }

            const currentUrl = window.location.href.toLowerCase();
            const targetUrlObj = new URL(targetUrl);
            const currentUrlObj = new URL(currentUrl);

            // Compare host and pathname (ignoring trailing slash)
            const hostMatches = currentUrlObj.host === targetUrlObj.host;
            const pathMatches = currentUrlObj.pathname.replace(/\/$/, '') === targetUrlObj.pathname.replace(/\/$/, '');

            if (hostMatches && pathMatches) {
                currentStep++;
                saveStepAndProcess();
            } else {
                showTooltip(step.instruction, null);
                window.location.href = targetUrl;
            }
            break;

        case 'wait':
            showTooltip(step.instruction, null);
            waitForElement(step.selector, (el) => {
                currentStep++;
                saveStepAndProcess();
            }, 10000);
            break;

        case 'manual_click_wait':
            showTooltip('Locating button...', null);
            waitForElement(null, (el) => {
                if (el) {
                    highlightElement(el);
                    // Crucial: We DO NOT provide a 'Next' button in the tooltip here. 
                    // We wait for the user to physically click the highlighted element.
                    showTooltip(step.instruction, null);
                    
                    // Add a one-time listener to the body to detect when they click it
                    const clickListener = (e) => {
                        // If they clicked the highlighted button (or something inside it)
                        if (el.contains(e.target) || e.target === el) {
                            document.removeEventListener('click', clickListener, true);
                            currentStep++;
                            saveStepAndProcess();
                        }
                    };
                    document.addEventListener('click', clickListener, true);
                } else {
                     showTooltip('Could not find the button. Please click Continue manually, then click Next.', () => {
                         currentStep++;
                         saveStepAndProcess();
                     });
                }
            }, 10000, step.text); // Pass the text to search for
            break;

        case 'click':
            handleClickStep(step);
            break;

        // CF1 Fix: Fill password from stored credentials instead of prompt()
        // Wait up to 5 seconds for the password field to exist in case of modals/transitions
        case 'fill_password':
            showTooltip('Waiting for password input...', null);
            waitForElement('input[type="password"], input[name="password"]', (passwordField) => {
                if (passwordField && storedCredentials) {
                    fillInput(passwordField, storedCredentials.password);
                    showTooltip('Password entered automatically.', () => {
                        currentStep++;
                        saveStepAndProcess();
                    });
                } else if (passwordField) {
                    // Fallback: password field exists but no stored credentials
                    showTooltip('Please enter the account password manually, then click Next.', () => {
                        currentStep++;
                        saveStepAndProcess();
                    });
                } else {
                    // Timeout or not found — skip
                    console.warn('ULegacy: Password field not found for filling');
                    currentStep++;
                    saveStepAndProcess();
                }
            }, 10000);
            break;

        // PG3 Fix: Check for CAPTCHA and pause if detected
        case 'captcha_check':
            if (detectCaptcha()) {
                showTooltip('⚠️ Security check detected. Please complete the CAPTCHA, then click Next to continue.', () => {
                    currentStep++;
                    saveStepAndProcess();
                });
            } else {
                // No captcha — continue immediately
                currentStep++;
                saveStepAndProcess();
            }
            break;

        default:
            currentStep++;
            saveStepAndProcess();
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
            simulateReactClick(el);
            currentStep++;
            // Wait a moment for page to update after click
            setTimeout(() => saveStepAndProcess(), 1000);
        });
    } else {
        // Element not found — ask user to do it manually
        showTooltip(`Cannot find the element. Please click "${step.text || 'the button'}" manually, then click Next.`, () => {
            currentStep++;
            setTimeout(() => saveStepAndProcess(), 1000);
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
        } catch (e) { }
    }
    return false;
}

// Fill an input field and dispatch proper events
function fillInput(el, value) {
    // Focus the element
    el.focus();
    // Use native setter for React/framework compatibility
    const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeSetter) {
        nativeSetter.call(el, value);
    } else {
        el.value = value;
    }
    // Dispatch events to trigger framework validation (React, Angular, etc.)
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function waitForElement(selector, callback, timeout, textToFind = null) {
    const start = Date.now();
    const check = () => {
        let el = null;
        if (selector) {
            el = document.querySelector(selector);
        } else if (textToFind) {
            el = findByText(textToFind);
        }
        if (el) {
            callback(el);
            return;
        }
        if (Date.now() - start > timeout) {
            console.warn('Timeout waiting for element:', selector || textToFind);
            callback(null);
            return;
        }
        setTimeout(check, 200);
    };
    check();
}

function simulateReactClick(element) {
    if (!element) return;
    try {
        element.focus();
    } catch (e) { }

    // 1. Get exact center coordinates to bypass Meta's basic anti-bot checks
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + (rect.width / 2);
    const clientY = rect.top + (rect.height / 2);

    // 2. Create options mimicking a real physical pointer device
    const eventOptions = {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 1,
        clientX: clientX,
        clientY: clientY,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
    };

    // 3. Fire the full sequence of React-expected events (Pointer + Mouse)
    const events = [
        new PointerEvent('pointerdown', eventOptions),
        new MouseEvent('mousedown', eventOptions),
        new PointerEvent('pointerup', eventOptions),
        new MouseEvent('mouseup', eventOptions),
        new MouseEvent('click', eventOptions)
    ];

    events.forEach(event => {
        try {
            element.dispatchEvent(event);
        } catch (e) {
            console.error('ULegacy: click dispatch failed:', e);
        }
    });
}

function findByText(text) {
    if (!text) return null;
    const targets = text.split('|').map(t => t.trim().toLowerCase());

    // Phase 1: Try interactive elements first (added [role="radio"])
    const interactiveElements = document.querySelectorAll(
        'button, a, div[role="button"], [role="link"], [role="menuitem"], [role="radio"], input[type="button"], input[type="submit"], input[type="radio"], input[type="checkbox"]'
    );
    for (const el of interactiveElements) {
        if (checkElementMatch(el, targets, true)) {
            return el;
        }
    }

    // Phase 2: Try other text-bearing elements
    const otherElements = document.querySelectorAll('span, label, div, p, li');
    for (const el of otherElements) {
        if (checkElementMatch(el, targets, false)) {
            // FIX: If we matched text inside a span/div, find the actual clickable parent container.
            // Otherwise, React ignores the click and the form validation fails.
            const clickableParent = el.closest('button, a, [role="button"], [role="radio"], label, li');
            return clickableParent || el;
        }
    }

    return null;
}

function checkElementMatch(el, targets, isInteractive) {
    let elText = '';
    if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) {
        if (el.id) {
            const label = document.querySelector(`label[for="${el.id}"]`);
            if (label) elText = label.textContent || '';
        }
    } else {
        elText = el.textContent || '';
    }

    elText = elText.trim().toLowerCase();
    if (!elText) return false;

    for (const target of targets) {
        if (isInteractive) {
            if (elText.includes(target)) {
                if (isElementVisible(el)) return true;
            }
        } else {
            // For non-interactive elements, we want a tighter match to avoid huge text blocks/containers
            if (elText === target || (elText.includes(target) && elText.length < target.length + 12)) {
                if (isElementVisible(el)) return true;
            }
        }
    }
    return false;
}

function isElementVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function highlightElement(el) {
    // DO NOT modify the element's classes or styles directly anymore to avoid React hydration crash (#418)
    // el.classList.add('ulegacy-guide-highlight');
    try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {}
}

function injectTooltipStyles() {
    if (document.getElementById('ulegacy-guide-styles')) return;
    const style = document.createElement('style');
    style.id = 'ulegacy-guide-styles';
    style.textContent = `
        .ulegacy-guide-highlight {
            outline: 4px solid #ff6b6b !important;
            outline-offset: 3px !important;
            background: rgba(255, 243, 205, 0.3) !important;
            border-radius: 4px !important;
            transition: outline 0.3s ease !important;
            position: relative !important;
            z-index: 2147483646 !important;
        }
        .ulegacy-guide-tooltip {
            position: fixed !important;
            top: 20px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            background: #1a1a2e !important;
            color: white !important;
            padding: 16px 24px !important;
            border-radius: 12px !important;
            z-index: 2147483647 !important;
            font-size: 14px !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
            max-width: 450px !important;
            text-align: center !important;
            border: 1px solid rgba(255,255,255,0.2) !important;
        }
        .ulegacy-guide-tooltip .step-number {
            display: inline-block;
            background: #4a00e0;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            line-height: 24px;
            font-size: 12px;
            font-weight: 700;
            margin-right: 8px;
            text-align: center;
        }
        .ulegacy-guide-tooltip .step-text {
            font-weight: 400;
        }
        .ulegacy-guide-tooltip .step-next {
            display: inline-block;
            margin-top: 12px;
            background: #4a00e0;
            border: none;
            color: white;
            padding: 6px 20px;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            font-weight: 500;
            transition: background 0.2s;
        }
        .ulegacy-guide-tooltip .step-next:hover {
            background: #3a00b0;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function showTooltip(instruction, onNext) {
    // Remove existing tooltip
    const existing = document.querySelector('.ulegacy-guide-tooltip');
    if (existing) existing.remove();

    // Ensure CSS styles are injected
    injectTooltipStyles();

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
})();