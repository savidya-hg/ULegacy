// navigation-guard.js - Blocks navigation to sensitive pages

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
    '/reels'
];

const ALLOWED_PATHS = [
    '/settings',
    '/privacy',
    '/delete',
    '/deactivate',
    '/account',
    '/profile',
    '/edit'
];

function isBlocked(url) {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        return BLOCKED_PATHS.some(p => pathname.includes(p));
    } catch (e) {
        return false;
    }
}

function isAllowed(url) {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        return ALLOWED_PATHS.some(p => pathname.includes(p));
    } catch (e) {
        return false;
    }
}

// Block navigation via click events
document.addEventListener('click', (e) => {
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
    if (isBlocked(window.location.href)) {
        const origin = new URL(window.location.href).origin;
        window.location.href = origin + '/settings';
    }
});

function showBlockedAlert() {
    const alert = document.createElement('div');
    alert.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: #dc3545; color: white; padding: 12px 24px;
        border-radius: 8px; z-index: 99999; font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        animation: slideDown 0.3s ease;
    `;
    alert.textContent = '🚫 This page is blocked during settlement.';
    document.body.appendChild(alert);
    setTimeout(() => {
        alert.style.opacity = '0';
        alert.style.transition = 'opacity 0.5s';
        setTimeout(() => alert.remove(), 500);
    }, 3000);
}

// Add animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideDown {
        from { transform: translateX(-50%) translateY(-20px); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
`;
document.head.appendChild(style);

console.log('ULegacy Navigation Guard active');