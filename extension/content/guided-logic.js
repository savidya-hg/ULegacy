// guided-logic.js - Guides beneficiary through account deletion

let currentStep = 0;
let guideSteps = [];
let isActive = false;

// Platform-specific step definitions
const PLATFORM_STEPS = {
    facebook: [
        { type: 'navigate', url: '/settings', instruction: 'Opening Settings...' },
        { type: 'wait', selector: '[role="main"]', instruction: 'Wait for settings to load...' },
        { type: 'click', selector: 'a[href*="privacy"]', instruction: 'Click Privacy Settings' },
        { type: 'click', selector: 'a[href*="deactivation"]', instruction: 'Click Deactivation and Deletion' },
        { type: 'click', selector: 'div:contains("Delete Account")', instruction: 'Select Delete Account' },
        { type: 'fill', selector: 'input[type="password"]', instruction: 'Entering password...' },
        { type: 'click', selector: 'button:contains("Delete Account")', instruction: 'Click final Delete button' }
    ],
    google: [
        { type: 'navigate', url: '/account', instruction: 'Opening Google Account...' },
        { type: 'click', selector: 'a[href*="delete-account"]', instruction: 'Click Delete Account' },
        { type: 'wait', selector: 'input[type="password"]', instruction: 'Verify your identity...' },
        { type: 'fill', selector: 'input[type="password"]', instruction: 'Entering password...' },
        { type: 'click', selector: 'button:contains("Delete")', instruction: 'Confirm deletion' }
    ],
    instagram: [
        { type: 'navigate', url: '/accounts/remove/request/permanent/', instruction: 'Opening Instagram deletion page...' },
        { type: 'wait', selector: 'select', instruction: 'Select reason for deletion...' },
        { type: 'fill', selector: 'input[type="password"]', instruction: 'Entering password...' },
        { type: 'click', selector: 'button:contains("Delete")', instruction: 'Click Delete' }
    ],
    tiktok: [
        { type: 'navigate', url: '/settings/account/delete', instruction: 'Opening TikTok deletion page...' },
        { type: 'wait', selector: 'button:contains("Delete")', instruction: 'Click Delete Account' }
    ],
    twitter: [
        { type: 'navigate', url: '/settings/deactivate', instruction: 'Opening Twitter deactivation page...' },
        { type: 'wait', selector: 'input[type="password"]', instruction: 'Verifying...' },
        { type: 'fill', selector: 'input[type="password"]', instruction: 'Entering password...' },
        { type: 'click', selector: 'button:contains("Deactivate")', instruction: 'Confirm deactivation' }
    ]
};

// Listen for start message from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'start_guide' && message.platform) {
        startGuide(message.platform);
        sendResponse({ status: 'started' });
    }
});

function startGuide(platform) {
    if (isActive) {
        console.log('Guide already active');
        return;
    }

    const steps = PLATFORM_STEPS[platform];
    if (!steps) {
        console.error('No steps defined for platform:', platform);
        showTooltip('Platform not supported yet. Manual deletion required.', 'error');
        return;
    }

    guideSteps = steps;
    currentStep = 0;
    isActive = true;

    console.log('Starting guide for', platform);
    processStep();
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
            const url = new URL(window.location.href);
            const newUrl = url.origin + step.url;
            if (window.location.pathname !== step.url) {
                window.location.href = newUrl;
                // Wait for navigation then continue
                setTimeout(() => processStep(), 1500);
            } else {
                currentStep++;
                processStep();
            }
            break;

        case 'wait':
            waitForElement(step.selector, () => {
                currentStep++;
                processStep();
            }, 5000);
            break;

        case 'click':
            const el = document.querySelector(step.selector);
            if (el) {
                highlightElement(el);
                showTooltip(step.instruction, () => {
                    el.click();
                    currentStep++;
                    processStep();
                });
            } else {
                console.warn('Element not found:', step.selector);
                // Try to find by text
                const fallback = findByText(step.selector);
                if (fallback) {
                    highlightElement(fallback);
                    showTooltip(step.instruction, () => {
                        fallback.click();
                        currentStep++;
                        processStep();
                    });
                } else {
                    showTooltip('Cannot find element. Please click it manually.', null);
                    // Manual override: user clicks next
                    currentStep++;
                    processStep();
                }
            }
            break;

        case 'fill':
            const input = document.querySelector(step.selector);
            if (input) {
                // In production, get password from vault
                const password = prompt('Enter the account password (this is not stored):');
                if (password) {
                    input.value = password;
                    // Trigger change event
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    showTooltip('Password entered', () => {
                        currentStep++;
                        processStep();
                    });
                } else {
                    showTooltip('Password required to continue', null);
                }
            } else {
                currentStep++;
                processStep();
            }
            break;

        default:
            currentStep++;
            processStep();
    }
}

function waitForElement(selector, callback, timeout) {
    const start = Date.now();
    const check = () => {
        const el = document.querySelector(selector);
        if (el) {
            callback(el);
            return;
        }
        if (Date.now() - start > timeout) {
            console.warn('Timeout waiting for element:', selector);
            callback(null);
            return;
        }
        setTimeout(check, 200);
    };
    check();
}

function findByText(text) {
    const elements = document.querySelectorAll('button, a, div, span');
    for (const el of elements) {
        if (el.textContent && el.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
            return el;
        }
    }
    return null;
}

function highlightElement(el) {
    el.classList.add('ulegacy-guide-highlight');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showTooltip(instruction, onNext) {
    // Remove existing tooltip
    const existing = document.querySelector('.ulegacy-guide-tooltip');
    if (existing) existing.remove();

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
    showTooltip('Account deletion completed!', null);
    setTimeout(() => {
        const tooltip = document.querySelector('.ulegacy-guide-tooltip');
        if (tooltip) tooltip.remove();
        // Notify completion
        chrome.runtime.sendMessage({
            type: 'guide_complete',
            platform: 'facebook' // or whatever platform
        });
    }, 3000);
}

console.log('ULegacy Guided Logic loaded');