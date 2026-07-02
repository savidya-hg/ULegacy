// privacy-shield.js - Content script that blurs sensitive content

const SENSITIVE_SELECTORS = [
    // Facebook
    '[aria-label="Messages"]',
    '[aria-label="Inbox"]',
    '[role="feed"]',
    '.x1n2onr6',
    'div[aria-label*="message"]',
    'div[role="tablist"]',
    
    // Instagram
    'article[role="presentation"]',
    '._a9zr',
    'div[role="dialog"]',
    
    // Google
    '.gb_ye',
    '.gmail-nav',
    'div[role="main"]'
];

function applyBlur() {
    // Wait for document to be ready
    if (!document.head) {
        setTimeout(applyBlur, 50);
        return;
    }

    // Only run on specific domains
    const host = window.location.hostname;
    const relevantHosts = ['facebook.com', 'instagram.com', 'mail.google.com', 'google.com'];
    if (!relevantHosts.some(h => host.includes(h))) {
        console.log('ULegacy: Not running on', host);
        return;
    }

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
            outline: 3px solid #ff6b6b !important;
            outline-offset: 2px !important;
            background: #fff3cd !important;
            border-radius: 4px !important;
            transition: outline 0.3s ease !important;
            position: relative !important;
            z-index: 9999 !important;
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
            z-index: 99999 !important;
            font-size: 14px !important;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4) !important;
            max-width: 400px !important;
            text-align: center !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
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
    document.head.appendChild(style);

    // Apply blur to sensitive elements
    SENSITIVE_SELECTORS.forEach(selector => {
        try {
            document.querySelectorAll(selector).forEach(el => {
                el.classList.add('ulegacy-blur');
            });
        } catch (e) {
            // Ignore invalid selectors
        }
    });

    // Observer for dynamic content
    if (document.body) {
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        SENSITIVE_SELECTORS.forEach(selector => {
                            try {
                                if (node.matches && node.matches(selector)) {
                                    node.classList.add('ulegacy-blur');
                                }
                                node.querySelectorAll(selector).forEach(el => {
                                    el.classList.add('ulegacy-blur');
                                });
                            } catch (e) {}
                        });
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    console.log('ULegacy Privacy Shield active on', host);
}

// Run
applyBlur();