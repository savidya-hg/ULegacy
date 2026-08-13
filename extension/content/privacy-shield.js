(() => {
// privacy-shield.js - Content script that blurs sensitive content
// PG1 Fix: ONLY activates when in settlement mode (new tab opened by extension)
// CF2 Fix: If blurring fails, blocks the entire page as a fail-safe

const SENSITIVE_SELECTORS = {
    // Facebook — inbox, feed, stories, media
    'facebook.com': [
        '[aria-label="Messages"]',
        '[aria-label="Inbox"]',
        '[role="feed"]',
        'div[aria-label*="message"]',
        'div[role="tablist"]',
        'div[aria-label="Stories"]',
        'div[data-pagelet="Stories"]',
        'div[data-pagelet="Feed"]',
        'div[data-pagelet="RightRail"]'
    ],
    // Instagram — feed, DMs, stories, explore, reels
    'instagram.com': [
        'article[role="presentation"]',
        'div[role="dialog"]:not(:has(input[type="password"])):not(:has(input[name*="password" i])):not(:has(input[autocomplete*="password" i]))',
        'main > section',
        'div[role="tablist"]'
    ],
    // TikTok — feed, messages
    'tiktok.com': [
        'div[data-e2e="recommend-list-item-container"]',
        'div[data-e2e="chat-room"]',
        'div[class*="DivVideoFeedV2"]'
    ]
};

// Text-based fallback selectors (more resilient to UI changes)
const TEXT_BASED_SELECTORS = [
    'a[href*="/messages"]',
    'a[href*="/inbox"]',
    'a[href*="/direct"]',
    'a[href*="/stories"]',
    'a[href*="/explore"]',
    'a[href*="/reels"]'
];

let isSettlementMode = false;
let shieldApplied = false;

// ---------- Check if we're in settlement mode ----------
function checkSettlementMode() {
    // Check session storage for settlement flag set by background.js
    if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(['settlementMode', 'settlementDeletionDone'], (result) => {
            // If the guided-logic has already completed deletion, the account
            // is gone — there's nothing private left to shield on the post-logout page.
            if (result.settlementDeletionDone) {
                console.log('ULegacy: Deletion complete — privacy shield inactive');
                return;
            }

            if (result.settlementMode === true) {
                isSettlementMode = true;
                console.log('ULegacy: Settlement mode ACTIVE — applying privacy shield');
                applyBlur();
            } else {
                console.log('ULegacy: Not in settlement mode — privacy shield inactive');
            }
        });
    }
}

function applyBlur() {
    // Wait for document to be ready
    if (!document.head) {
        setTimeout(applyBlur, 50);
        return;
    }

    // Inject blur, highlight, and tooltip styles immediately so they are available
    // even on skipped subdomains/paths.
    if (!document.getElementById('ulegacy-shield-styles')) {
        const style = document.createElement('style');
        style.id = 'ulegacy-shield-styles';
        style.textContent = `
            .ulegacy-blur {
                filter: blur(25px) !important;
                pointer-events: none !important;
                user-select: none !important;
                -webkit-user-select: none !important;
                opacity: 0.7 !important;
                transition: filter 0.1s ease !important;
            }
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
            #ulegacy-page-block {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                background: rgba(26, 26, 46, 0.95) !important;
                z-index: 999999 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                flex-direction: column !important;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Skip blurring/blocking on pages the beneficiary needs to interact with
    const pathname = window.location.pathname.toLowerCase();
    const SAFE_PATHS = [
        '/settings', '/privacy', '/delete', '/deactivate',
        '/account', '/profile', '/edit', '/login', '/signin',
        '/accounts/remove', '/accounts/login', '/accounts/edit',
        '/help', '/support', '/center', '/noscript',
        '/personal-info', '/data-and-privacy', '/deleteaccount'
    ];
    if (SAFE_PATHS.some(p => pathname.includes(p))) {
        console.log('ULegacy: On safe path, privacy shield skipped:', pathname);
        return;
    }

    // Determine which host we're on
    const host = window.location.hostname;
    
    // Skip accounts management subdomains as they don't contain personal content (feed/DMs)
    // and need to be fully accessible for deletion.
    if (host.includes('accountscenter.') || host.includes('accounts.')) {
        console.log('ULegacy: On account center subdomain, privacy shield skipped:', host);
        return;
    }

    let matchedHost = null;
    for (const domain of Object.keys(SENSITIVE_SELECTORS)) {
        if (host.includes(domain)) {
            matchedHost = domain;
            break;
        }
    }

    if (!matchedHost) {
        console.log('ULegacy: No selector definitions for', host);
        applyFullPageBlock('Unrecognized platform — page blocked for privacy protection.');
        return;
    }

    // Apply blur to sensitive elements for this platform
    const selectors = SENSITIVE_SELECTORS[matchedHost] || [];
    const allSelectors = [...selectors, ...TEXT_BASED_SELECTORS];

    let blurredCount = 0;
    allSelectors.forEach(selector => {
        try {
            document.querySelectorAll(selector).forEach(el => {
                el.classList.add('ulegacy-blur');
                blurredCount++;
            });
        } catch (e) {
            // Ignore invalid selectors
        }
    });

    shieldApplied = blurredCount > 0;

    // Observer for dynamic content (SPAs load content asynchronously)
    if (document.body) {
        const observer = new MutationObserver(mutations => {
            let newBlurs = 0;
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        allSelectors.forEach(selector => {
                            try {
                                if (node.matches && node.matches(selector)) {
                                    node.classList.add('ulegacy-blur');
                                    newBlurs++;
                                }
                                node.querySelectorAll(selector).forEach(el => {
                                    el.classList.add('ulegacy-blur');
                                    newBlurs++;
                                });
                            } catch (e) {}
                        });
                    }
                });
            });
            if (newBlurs > 0) shieldApplied = true;
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // CF2 Fix: Fail-safe — if no elements were blurred after 2 seconds,
    // block the entire page to prevent privacy leaks.
    setTimeout(() => {
        if (!shieldApplied) {
            console.warn('ULegacy: Privacy shield could not blur any elements — activating full page block');
            applyFullPageBlock('ULegacy could not verify privacy protection on this page. The page has been blocked for your safety.');
        }
    }, 2000);

    console.log(`ULegacy Privacy Shield active on ${host} — ${blurredCount} elements blurred`);
}

// CF2 Fix: Full page block overlay when blur fails
function applyFullPageBlock(message) {
    if (document.getElementById('ulegacy-page-block')) return;

    // Wait for body
    if (!document.body) {
        setTimeout(() => applyFullPageBlock(message), 100);
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'ulegacy-page-block';
    overlay.innerHTML = `
        <div style="text-align: center; color: white; max-width: 400px; padding: 20px;">
            <div style="font-size: 48px; margin-bottom: 16px;">🛡️</div>
            <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 12px;">Privacy Protection Active</h2>
            <p style="font-size: 14px; opacity: 0.8; line-height: 1.6;">${message}</p>
            <p style="font-size: 12px; opacity: 0.6; margin-top: 16px;">Please navigate to the account settings or deletion page to continue.</p>
        </div>
    `;
    document.body.appendChild(overlay);
}

checkSettlementMode();
})();