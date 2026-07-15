(() => {
// navigation-guard.js - Blocks navigation to sensitive pages
// PG1 Fix: ONLY activates when in settlement mode (new tab opened by extension)

const BLOCKED_PATHS = [
    '/messages',
    '/inbox',
    '/direct',
    '/photos',
    '/gallery',
    '/feed',
    '/stories',
    '/watch',
    '/explore',
    '/reels',
    '/notifications'
];

const ALLOWED_PATHS = [
    '/settings',
    '/privacy',
    '/delete',
    '/deactivate',
    '/account',
    '/profile',
    '/edit',
    '/login',
    '/signin',
    '/accounts/remove',
    '/accounts/login',
    '/accounts/edit',
    '/accounts_center',
    '/account_center',
    '/help',
    '/support',
    '/personal-info',
    '/data-and-privacy',
    '/deleteaccount',
    '/noscript'
];

let isSettlementMode = false;

function isBlocked(url) {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        // Don't block if it's an allowed path
        if (ALLOWED_PATHS.some(p => pathname.includes(p))) return false;
        return BLOCKED_PATHS.some(p => pathname.includes(p));
    } catch (e) {
        return false;
    }
}

function initGuard() {
    // Check if we're in settlement mode
    if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(['settlementMode'], (result) => {
            if (result.settlementMode === true) {
                isSettlementMode = true;
                console.log('ULegacy: Navigation Guard ACTIVE');
                activateGuard();
            } else {
                console.log('ULegacy: Not in settlement mode — navigation guard inactive');
            }
        });
    }
}

function activateGuard() {
    // Block navigation via click events
    document.addEventListener('click', (e) => {
        if (!isSettlementMode) return;

        const target = e.target.closest('a');
        if (target && target.href) {
            if (isBlocked(target.href)) {
                e.preventDefault();
                e.stopPropagation();
                showBlockedAlert();
                // Redirect to safe page
                const origin = new URL(target.href).origin;
                window.location.href = origin + '/settings';
            }
        }
    }, true);

    // Prevent back/forward navigation to blocked pages
    window.addEventListener('popstate', (e) => {
        if (!isSettlementMode) return;
        if (isBlocked(window.location.href)) {
            const origin = new URL(window.location.href).origin;
            window.location.href = origin + '/settings';
        }
    });

    // Check current page on load
    if (isBlocked(window.location.href)) {
        showBlockedAlert();
        const origin = new URL(window.location.href).origin;
        window.location.href = origin + '/settings';
    }

    // Add animation styles
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideDown {
            from { transform: translateX(-50%) translateY(-20px); opacity: 0; }
            to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
    `;
    if (document.head) {
        document.head.appendChild(style);
    }
}

function showBlockedAlert() {
    // Remove any existing alert
    const existing = document.getElementById('ulegacy-nav-alert');
    if (existing) existing.remove();

    const alert = document.createElement('div');
    alert.id = 'ulegacy-nav-alert';
    alert.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: #dc3545; color: white; padding: 12px 24px;
        border-radius: 8px; z-index: 99999; font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        animation: slideDown 0.3s ease;
    `;
    alert.textContent = '🚫 This page is blocked during settlement. Redirecting to settings...';

    if (document.body) {
        document.body.appendChild(alert);
        setTimeout(() => {
            alert.style.opacity = '0';
            alert.style.transition = 'opacity 0.5s';
            setTimeout(() => alert.remove(), 500);
        }, 3000);
    }
}

// ---------- Init ----------
initGuard();
})();