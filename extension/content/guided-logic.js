(() => {
    // guided-logic.js - Guides beneficiary through account deletion
    // CF1 Fix: Reads credentials from chrome.storage.session
    // PG3 Fix: Detects CAPTCHAs and pauses for manual completion
    // UPDATED: Aligned FB and IG to the new Accounts Center flow with logout/close logic

    let currentStep = 0;
    let guideSteps = [];
    let isActive = false;
    let storedCredentials = null;

    // Platform-specific step definitions
    const PLATFORM_STEPS = {
        facebook: [
            { type: 'navigate', url: 'https://accountscenter.facebook.com/manage/', instruction: 'Opening Accounts Management...' },
            { type: 'wait', selector: 'div[role="main"], div[role="button"], a[role="link"], main', timeout: 15000, instruction: 'Waiting for Accounts Center to load...' },
            { type: 'click', text: 'Manage', instruction: 'Clicking the "Manage" button...' },
            { type: 'click', text: 'Deactivation or deletion | Deactivation & deletion', instruction: 'Selecting "Deactivation or deletion"...' },
            { type: 'click', text: 'delete profile | delete account', instruction: 'Selecting "Delete profile"...' },
            { type: 'click', text: 'Continue', instruction: 'Clicking Continue...' },
            { type: 'click', text: 'Privacy concerns', instruction: 'Selecting "Privacy concerns" as the reason...' },
            { type: 'click', text: 'Continue', instruction: 'Clicking Continue...' },
            { type: 'click', text: 'Continue', instruction: 'Clicking Continue again...' },
            { type: 'manual_click_wait', text: 'Continue', instruction: 'Meta security requires manual input. Please click "Continue" in the review info manually.' },
            { type: 'wait', selector: 'input[type="password"], input[name*="password" i], input[autocomplete*="password" i]', instruction: 'Waiting for security confirmation modal...' },
            { type: 'fill_password', instruction: 'Entering password automatically...' },
            { type: 'click', text: 'Continue|Submit|Confirm', near: 'input[type="password"]', instruction: 'Clicking Continue to confirm password...' },
            { type: 'click', text: 'Delete profile | Delete account | Delete', instruction: 'Clicking the final Delete button to confirm...' },
            { type: 'wait_url', keywords: ['login'], instruction: 'Waiting for system to log out...' },
            { type: 'close_tab', instruction: 'Account deleted successfully. Closing tab...' }
        ],
        instagram: [
            { type: 'navigate', url: 'https://accountscenter.instagram.com/manage/', instruction: 'Opening Accounts Management...' },
            { type: 'wait', selector: 'div[role="main"], div[role="button"], a[role="link"], main', timeout: 15000, instruction: 'Waiting for Accounts Center to load...' },
            { type: 'click', text: 'Manage', instruction: 'Clicking the "Manage" button...' },
            { type: 'click', text: 'Deactivation or deletion | Deactivation & deletion', instruction: 'Selecting "Deactivation or deletion"...' },
            { type: 'click', text: 'delete profile | delete account', instruction: 'Selecting "Delete profile"...' },
            { type: 'click', text: 'Continue', instruction: 'Clicking Continue...' },
            { type: 'click', text: 'Continue', instruction: 'Clicking Continue again...' }, // Extra IG step
            { type: 'click', text: 'Privacy concerns', instruction: 'Selecting "Privacy concerns" as the reason...' },
            { type: 'click', text: 'Continue', instruction: 'Clicking Continue...' },
            { type: 'click', text: 'Continue', instruction: 'Clicking Continue again...' },
            { type: 'manual_click_wait', text: 'Continue', instruction: 'Meta security requires manual input. Please click "Continue" in the review info manually.' },
            { type: 'wait', selector: 'input[type="password"], input[name*="password" i], input[autocomplete*="password" i]', instruction: 'Waiting for security confirmation modal...' },
            { type: 'fill_password', instruction: 'Entering password automatically...' },
            { type: 'click', text: 'Continue|Submit|Confirm', near: 'input[type="password"]', instruction: 'Clicking Continue to confirm password...' },
            { type: 'click', text: 'Delete profile | Delete account | Delete', instruction: 'Clicking the final Delete button to confirm...' },
            { type: 'wait_url', keywords: ['login'], instruction: 'Waiting for system to log out...' },
            { type: 'close_tab', instruction: 'Account deleted successfully. Closing tab...' }
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
            chrome.storage.session.get(['settlementMode', 'settlementPlatform', 'settlementCredentials', 'settlementStep', 'settlementDeletionDone'], (result) => {
                // If deletion is already complete, close the tab — don't auto-fill
                // the post-logout login page or restart the guide.
                if (result.settlementDeletionDone) {
                    completeGuide();
                    return;
                }

                if (result.settlementMode && result.settlementPlatform && result.settlementCredentials) {
                    storedCredentials = result.settlementCredentials;
                    currentStep = result.settlementStep || 0;
                    // Small delay to let the page load
                    setTimeout(() => {
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

    function autoFillLogin() {
        if (!storedCredentials) return;
        showTooltip('Waiting for login form...', null);

        waitForElement('input[type="password"], input[name="password"]', (passwordField) => {
            if (!passwordField) {
                console.warn('ULegacy: Login form fields not found');
                showTooltip('Unable to find login form. Please log in manually.', null);
                return;
            }

            showTooltip('Logging in automatically...', null);

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

            fillInput(passwordField, storedCredentials.password);
            passwordFilled = true;

            if (usernameFilled && passwordFilled) {
                showTooltip('Credentials entered. Logging in...', null);
                setTimeout(() => {
                    const submitBtn = document.querySelector(
                        'button[type="submit"], input[type="submit"], button[name="login"]'
                    ) || findByText('Log In') || findByText('Sign In') || findByText('Login') || findByText('Next');

                    if (submitBtn) simulateReactClick(submitBtn);
                }, 800);
            }
        }, 10000);
    }

    function startGuide(platform) {
        if (isActive) return;

        const steps = PLATFORM_STEPS[platform];
        if (!steps) {
            showTooltip('Platform not supported yet. Manual deletion required.', null);
            return;
        }

        guideSteps = steps;
        if (currentStep === undefined || currentStep === null || currentStep >= guideSteps.length) {
            currentStep = 0;
        }
        isActive = true;

        // Block close/exit buttons on Accounts Center pages so the beneficiary
        // can't accidentally navigate away from the deletion flow.
        blockCloseButtons();

        processStep();
    }

    function saveStepAndProcess() {
        if (chrome.storage && chrome.storage.session) {
            chrome.storage.session.set({ settlementStep: currentStep }, () => {
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

        switch (step.type) {
            case 'navigate':
                let targetUrl = step.url;
                if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                    targetUrl = window.location.origin + targetUrl;
                }

                const currentUrl = window.location.href.toLowerCase();
                const targetUrlObj = new URL(targetUrl);
                const currentUrlObj = new URL(currentUrl);

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
                }, step.timeout || 10000);
                break;

            case 'manual_click_wait':
                showTooltip('Locating button...', null);
                waitForElement(null, (el) => {
                    if (el) {
                        highlightElement(el);
                        showTooltip(step.instruction, null);

                        const clickListener = (e) => {
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
                }, 10000, step.text);
                break;

            case 'click':
                handleClickStep(step);
                break;

            case 'fill_password':
                showTooltip('Waiting for password input...', null);
                waitForElement('input[type="password"], input[name="password"]', (passwordField) => {
                    if (passwordField && storedCredentials) {
                        fillInput(passwordField, storedCredentials.password);
                        showTooltip('Password entered automatically.', null);
                        setTimeout(() => {
                            currentStep++;
                            saveStepAndProcess();
                        }, 800);
                    } else if (passwordField) {
                        showTooltip('Please enter the account password manually, then click Next.', () => {
                            currentStep++;
                            saveStepAndProcess();
                        });
                    } else {
                        currentStep++;
                        saveStepAndProcess();
                    }
                }, 10000);
                break;

            case 'captcha_check':
                if (detectCaptcha()) {
                    showTooltip('⚠️ Security check detected. Please complete the CAPTCHA, then click Next to continue.', () => {
                        currentStep++;
                        saveStepAndProcess();
                    });
                } else {
                    currentStep++;
                    saveStepAndProcess();
                }
                break;

            // NEW: Halts the script and polls the URL until a specific keyword is detected
            case 'wait_url':
                showTooltip(step.instruction, null);
                // Signal to auto-fill.js that deletion is complete — do NOT
                // re-fill login forms when we land on the post-logout page.
                chrome.storage.session.set({ settlementDeletionDone: true });
                const urlTimeout = Date.now() + 20000; // 20-second maximum wait
                const checkUrl = () => {
                    const currentLoc = window.location.href.toLowerCase();
                    const keywords = step.keywords || [];
                    if (keywords.some(kw => currentLoc.includes(kw.toLowerCase()))) {
                        currentStep++;
                        saveStepAndProcess();
                    } else if (Date.now() > urlTimeout) {
                        currentStep++;
                        saveStepAndProcess(); // Failsafe fallback
                    } else {
                        setTimeout(checkUrl, 500);
                    }
                };
                checkUrl();
                break;

            // NEW: Finalizes the deletion sequence and triggers tab closure
            case 'close_tab':
                showTooltip(step.instruction, null);
                completeGuide();
                break;

            default:
                currentStep++;
                saveStepAndProcess();
        }
    }

    function handleClickStep(step) {
        // Poll for the element — SPA pages (like Meta Accounts Center) render
        // content asynchronously, so the target may not exist in the DOM yet.
        const maxWait = step.timeout || 15000;
        const pollInterval = 500;
        const startTime = Date.now();

        showTooltip(step.instruction, null);

        // If step.near is set, scope the search to the same dialog/form/modal
        // that contains the reference element (e.g., the password input).
        function getScopeRoot() {
            if (!step.near) return null;
            const refEl = document.querySelector(step.near);
            if (!refEl) return null;
            // Walk up to the nearest modal container
            return refEl.closest('[role="dialog"], [role="alertdialog"], dialog, form, [aria-modal="true"]');
        }

        const tryFind = () => {
            let el = null;

            // Try scoped search first (within the same modal as the reference element)
            const scopeRoot = getScopeRoot();
            if (scopeRoot) {
                if (step.selector) el = scopeRoot.querySelector(step.selector);
                if (!el && step.text) el = findByText(step.text, scopeRoot);
            }

            // Fall back to global search if scoped search found nothing
            if (!el) {
                if (step.selector) el = document.querySelector(step.selector);
                if (!el && step.text) el = findByText(step.text);
            }

            if (el) {
                // Element found — highlight it, show instruction (no Next button),
                // then auto-click after a brief delay so the user can see what's happening.
                highlightElement(el);
                showTooltip(step.instruction, null);
                setTimeout(() => {
                    simulateReactClick(el);
                    currentStep++;
                    setTimeout(() => saveStepAndProcess(), 1000);
                }, 800);
            } else if (Date.now() - startTime < maxWait) {
                // Still waiting — retry after a short interval
                setTimeout(tryFind, pollInterval);
            } else {
                // Timed out — fall back to manual mode WITH a Next button
                showTooltip(`Cannot find the element. Please click "${step.text || 'the button'}" manually, then click Next.`, () => {
                    currentStep++;
                    setTimeout(() => saveStepAndProcess(), 1000);
                });
            }
        };
        tryFind();
    }

    function detectCaptcha() {
        for (const selector of CAPTCHA_SELECTORS) {
            try {
                if (document.querySelector(selector)) return true;
            } catch (e) { }
        }
        return false;
    }

    function fillInput(el, value) {
        el.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        )?.set;
        if (nativeSetter) {
            nativeSetter.call(el, value);
        } else {
            el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function waitForElement(selector, callback, timeout, textToFind = null) {
        const start = Date.now();
        const check = () => {
            let el = null;
            if (selector) el = document.querySelector(selector);
            else if (textToFind) el = findByText(textToFind);

            if (el) {
                callback(el);
                return;
            }
            if (Date.now() - start > timeout) {
                callback(null);
                return;
            }
            setTimeout(check, 200);
        };
        check();
    }

    function simulateReactClick(element) {
        if (!element) return;
        try { element.focus(); } catch (e) { }

        const rect = element.getBoundingClientRect();
        const clientX = rect.left + (rect.width / 2);
        const clientY = rect.top + (rect.height / 2);

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

        const events = [
            new PointerEvent('pointerdown', eventOptions),
            new MouseEvent('mousedown', eventOptions),
            new PointerEvent('pointerup', eventOptions),
            new MouseEvent('mouseup', eventOptions),
            new MouseEvent('click', eventOptions)
        ];

        events.forEach(event => {
            try { element.dispatchEvent(event); } catch (e) { }
        });
    }

    // ---------- Block close/exit buttons on Accounts Center ----------
    // The X button in the top-right corner lets the user leave the deletion
    // flow. During settlement we blur it and make it non-clickable.
    function blockCloseButtons() {
        const host = window.location.hostname;
        if (!host.includes('accountscenter.')) return;

        const CLOSE_SELECTORS = [
            'a[aria-label="Close"]',
            'div[aria-label="Close"]',
            'button[aria-label="Close"]',
            '[role="button"][aria-label="Close"]',
            'a[aria-label="close"]',
            'div[aria-label="close"]',
            'a[href="/"]', // Meta "home" link that looks like an X
        ];

        function disableCloseElement(el) {
            if (el.dataset.ulegacyBlocked) return; // Already processed
            el.dataset.ulegacyBlocked = 'true';
            el.style.cssText += 'filter: blur(4px) !important; pointer-events: none !important; opacity: 0.3 !important;';
            // Also prevent any click from reaching it
            el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
        }

        function scanAndBlock() {
            for (const selector of CLOSE_SELECTORS) {
                document.querySelectorAll(selector).forEach(disableCloseElement);
            }
            // Also catch SVG-based close icons: look for small clickable elements
            // near the top-right of the page that contain an SVG with an X shape
            document.querySelectorAll('[role="button"], a, button').forEach(el => {
                if (el.dataset.ulegacyBlocked) return;
                const rect = el.getBoundingClientRect();
                // Top-right corner: within 80px of top, within 80px of right edge
                if (rect.top < 80 && (window.innerWidth - rect.right) < 80 && rect.width < 60 && rect.height < 60) {
                    const hasSvg = el.querySelector('svg');
                    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                    if (hasSvg || ariaLabel.includes('close') || ariaLabel.includes('back')) {
                        disableCloseElement(el);
                    }
                }
            });

            // Block password visibility toggle (eye icon) in security modals
            // so the beneficiary cannot reveal the owner's password.
            const PASSWORD_TOGGLE_SELECTORS = [
                '[aria-label="Show password"]',
                '[aria-label="Hide password"]',
                '[aria-label="show password"]',
                '[aria-label="hide password"]',
                '[aria-label="Toggle password visibility"]',
                '[data-type="password-toggle"]',
            ];
            for (const selector of PASSWORD_TOGGLE_SELECTORS) {
                document.querySelectorAll(selector).forEach(disableCloseElement);
            }
            // Also find clickable elements adjacent to password inputs (eye icon buttons)
            document.querySelectorAll('input[type="password"]').forEach(pwInput => {
                const container = pwInput.parentElement;
                if (!container) return;
                container.querySelectorAll('[role="button"], button, div[tabindex], span[tabindex]').forEach(el => {
                    if (el === pwInput) return;
                    // Small element next to password field with an SVG = likely the eye icon
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 50 && rect.height < 50 && (el.querySelector('svg') || el.querySelector('i'))) {
                        disableCloseElement(el);
                    }
                });
            });
        }

        // Initial scan
        scanAndBlock();

        // Re-scan when new elements are added (React SPA)
        const observer = new MutationObserver(() => scanAndBlock());
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    function findByText(text, scopeRoot) {
        if (!text) return null;
        const targets = text.split('|').map(t => t.trim().toLowerCase());
        const root = scopeRoot || document;

        const interactiveSelector = 'button, a, div[role="button"], [role="link"], [role="menuitem"], [role="radio"], input[type="button"], input[type="submit"], input[type="radio"], input[type="checkbox"]';

        // --- Pass 1: Exact text matches among interactive elements (highest priority) ---
        const interactiveElements = root.querySelectorAll(interactiveSelector);
        for (const el of interactiveElements) {
            if (checkElementMatch(el, targets, 'exact')) return el;
        }

        // --- Pass 2: Exact matches among non-interactive wrapper elements ---
        const otherElements = root.querySelectorAll('span, label, div, p, li');
        for (const el of otherElements) {
            if (checkElementMatch(el, targets, 'exact')) {
                const clickableParent = el.closest('button, a, [role="button"], [role="radio"], label, li');
                return clickableParent || el;
            }
        }

        // --- Pass 3: Partial (includes) matches among interactive elements (fallback) ---
        for (const el of interactiveElements) {
            if (checkElementMatch(el, targets, 'partial')) return el;
        }

        // --- Pass 4: Partial matches among non-interactive elements ---
        for (const el of otherElements) {
            if (checkElementMatch(el, targets, 'partial')) {
                const clickableParent = el.closest('button, a, [role="button"], [role="radio"], label, li');
                return clickableParent || el;
            }
        }

        return null;
    }

    function checkElementMatch(el, targets, mode) {
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
            if (!isElementVisible(el)) continue;

            if (mode === 'exact') {
                // Exact match: element text equals the target exactly
                if (elText === target) return true;
            } else {
                // Partial match: element text contains the target,
                // but penalize very long text to avoid matching entire paragraphs
                if (elText.includes(target) && elText.length < target.length + 20) return true;
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
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
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
        .ulegacy-guide-tooltip .step-text { font-weight: 400; }
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
        .ulegacy-guide-tooltip .step-next:hover { background: #3a00b0; }
    `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showTooltip(instruction, onNext) {
        const existing = document.querySelector('.ulegacy-guide-tooltip');
        if (existing) existing.remove();

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

        chrome.storage.session.get(['settlementPlatform'], (result) => {
            const platform = result.settlementPlatform || 'unknown';

            // Try to show a completion tooltip (may fail if called before body/styles are ready)
            try {
                if (document.body) {
                    injectTooltipStyles();
                    showTooltip('✅ Account deletion completed! Closing tab in 3 seconds...', null);
                }
            } catch (e) { /* Page not ready — that's fine, background handles the close */ }

            // Notify background.js — it will close the window AND relay to popup
            chrome.runtime.sendMessage({
                type: 'settlement_account_deleted',
                data: { platform: platform }
            });

            // Backup: if background.js didn't close the window (e.g. race condition),
            // try again after 3 seconds.
            setTimeout(() => {
                try {
                    const tooltip = document.querySelector('.ulegacy-guide-tooltip');
                    if (tooltip) tooltip.remove();
                } catch (e) {}

                window.close();
                chrome.runtime.sendMessage({ type: 'close_current_tab' });
            }, 3000);
        });
    }

    // ---------- Init ----------
    initGuide();
})();