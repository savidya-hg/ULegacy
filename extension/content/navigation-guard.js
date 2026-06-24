// Block navigation to sensitive pages

const BLOCKED_PATHS = [
    '/messages',
    '/inbox',
    '/direct',
    '/photos',
    '/gallery',
    '/feed',
    '/stories'
];

const ALLOWED_PATHS = [
    '/settings',
    '/privacy',
    '/delete',
    '/deactivate',
    '/account',
    '/profile'
];

function isBlocked(url) {
    const pathname = new URL(url).pathname.toLowerCase();
    return BLOCKED_PATHS.some(p => pathname.includes(p));
}

// Intercept navigation via webNavigation (done in background)
// But we can also do client-side guard for clicks
document.addEventListener('click', (e) => {
    const target = e.target.closest('a');
    if (target && target.href) {
        if (isBlocked(target.href)) {
            e.preventDefault();
            e.stopPropagation();
            alert('Access to this page is blocked during settlement.');
            // Redirect to a safe page
            const origin = new URL(target.href).origin;
            window.location.href = origin + '/settings';
        }
    }
}, true);