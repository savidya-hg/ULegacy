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
            { type: 'wait', selector: 'body', instruction: 'Waiting for Management page to load...' },
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
            { type: 'click', text: 'Continue|Submit|Confirm', instruction: 'Clicking Continue to confirm password...' },
            { type: 'click', text: 'Delete profile | Delete account | Delete', instruction: 'Clicking the final Delete button to confirm...' },
            { type: 'wait_url', keywords: ['login'], instruction: 'Waiting for system to log out...' },
            { type: 'close_tab', instruction: 'Account deleted successfully. Closing tab...' }
        ],
        instagram: [
            { type: 'navigate', url: 'https://accountscenter.instagram.com/manage/', instruction: 'Opening Accounts Management...' },
            { type: 'wait', selector: 'body', instruction: 'Waiting for Management page to load...' },
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
            { type: 'click', text: 'Continue|Submit|Confirm', instruction: 'Clicking Continue to confirm password...' },
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
            chrome.storage.session.get(['settlementMode', 'settlementPlatform', 'settlementCredentials', 'settlementStep'], (result) => {
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
                }, 10000);
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
                        showTooltip('Password entered automatically.', () => {
                            currentStep++;
                            saveStepAndProcess();
                        });
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
        let el = step.selector ? document.querySelector(step.selector) : null;
        if (!el && step.text) el = findByText(step.text);

        if (el) {
            highlightElement(el);
            showTooltip(step.instruction, () => {
                simulateReactClick(el);
                currentStep++;
                setTimeout(() => saveStepAndProcess(), 1000);
            });
        } else {
            showTooltip(`Cannot find the element. Please click "${step.text || 'the button'}" manually, then click Next.`, () => {
                currentStep++;
                setTimeout(() => saveStepAndProcess(), 1000);
            });
        }
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

    function findByText(text) {
        if (!text) return null;
        const targets = text.split('|').map(t => t.trim().toLowerCase());

        const interactiveElements = document.querySelectorAll(
            'button, a, div[role="button"], [role="link"], [role="menuitem"], [role="radio"], input[type="button"], input[type="submit"], input[type="radio"], input[type="checkbox"]'
        );
        for (const el of interactiveElements) {
            if (checkElementMatch(el, targets, true)) return el;
        }

        const otherElements = document.querySelectorAll('span, label, div, p, li');
        for (const el of otherElements) {
            if (checkElementMatch(el, targets, false)) {
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
                if (elText.includes(target) && isElementVisible(el)) return true;
            } else {
                if ((elText === target || (elText.includes(target) && elText.length < target.length + 12)) && isElementVisible(el)) {
                    return true;
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

            showTooltip('✅ Account deletion completed! Closing tab in 3 seconds...', null);

            // Notify background.js to drop the user from Supabase now that it's done
            chrome.runtime.sendMessage({
                type: 'settlement_account_deleted',
                data: { platform: platform }
            });

            // Trigger tab closure
            setTimeout(() => {
                const tooltip = document.querySelector('.ulegacy-guide-tooltip');
                if (tooltip) tooltip.remove();

                // Standard close (works if the script opened the tab)
                window.close();

                // Backup close (tell background.js to kill the tab)
                chrome.runtime.sendMessage({ type: 'close_current_tab' });
            }, 3000);
        });
    }

    // ---------- Init ----------
    initGuide();
})();