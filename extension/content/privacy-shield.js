// This runs on Facebook, Instagram, Google etc.
// It blurs sensitive elements.

const SENSITIVE_SELECTORS = [
    // Facebook
    '[aria-label="Messages"]',
    '[aria-label="Inbox"]',
    '[role="feed"]',
    '.x1n2onr6', // common class for feed
    // Instagram
    'article[role="presentation"]',
    '._a9zr',
    // Google
    '.gb_ye', // Gmail inbox
    '.gmail-nav'
];

function applyBlur() {
    const style = document.createElement('style');
    style.textContent = `
        .ulegacy-blur {
            filter: blur(25px) !important;
            pointer-events: none !important;
            user-select: none !important;
        }
        .ulegacy-guide-highlight {
            outline: 3px solid #ff6b6b !important;
            outline-offset: 2px !important;
            background: #fff3cd !important;
        }
    `;
    document.head.appendChild(style);

    SENSITIVE_SELECTORS.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            el.classList.add('ulegacy-blur');
        });
    });

    // MutationObserver for dynamic content
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    SENSITIVE_SELECTORS.forEach(selector => {
                        if (node.matches && node.matches(selector)) {
                            node.classList.add('ulegacy-blur');
                        }
                    });
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

applyBlur();
console.log('ULegacy Privacy Shield active');