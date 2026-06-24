// content/privacy-shield.js

const SENSITIVE_SELECTORS = [
    // Facebook
    '[aria-label="Messages"]',
    '[aria-label="Inbox"]',
    '[role="feed"]',
    '.x1n2onr6',
    // Instagram
    'article[role="presentation"]',
    '._a9zr',
    // Google
    '.gb_ye',
    '.gmail-nav'
];

function applyBlur() {
    // Wait for document.head to exist
    if (!document.head) {
        setTimeout(applyBlur, 50);
        return;
    }

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
        try {
            document.querySelectorAll(selector).forEach(el => {
                el.classList.add('ulegacy-blur');
            });
        } catch (e) {
            // Ignore invalid selectors
        }
    });

    // MutationObserver for dynamic content
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
                            } catch (e) {}
                        });
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
}

// Only run on pages we actually care about
const currentHost = window.location.hostname;
if (currentHost.includes('facebook.com') || 
    currentHost.includes('instagram.com') || 
    currentHost.includes('mail.google.com')) {
    applyBlur();
    console.log('ULegacy Privacy Shield active on', currentHost);
} else {
    console.log('ULegacy Privacy Shield: Not running on', currentHost);
}