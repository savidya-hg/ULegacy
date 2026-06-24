// Simple guided logic for Facebook deletion (simplified)
// This is triggered by the extension when beneficiary clicks "Delete"

let currentStep = 0;
const steps = [
    { selector: 'a[href*="settings"]', text: 'Click Settings' },
    { selector: '[data-testid="settings_sidebar"]', text: 'Open Settings Sidebar' },
    { selector: 'div:contains("Privacy")', text: 'Go to Privacy' },
    { selector: 'div:contains("Deactivation")', text: 'Go to Deactivation' },
    { selector: 'input[type="password"]', text: 'Enter password (auto-filled)' },
    { selector: 'button:contains("Delete Account")', text: 'Click Delete Account' }
];

function startGuide() {
    showStep(0);
}

function showStep(index) {
    if (index >= steps.length) {
        alert('Account deletion process initiated. Please wait for confirmation.');
        return;
    }
    const step = steps[index];
    const element = document.querySelector(step.selector);
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('ulegacy-guide-highlight');
        // Show tooltip
        const tooltip = document.createElement('div');
        tooltip.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: #333; color: white; padding: 12px 24px; border-radius: 8px;
            z-index: 99999; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        `;
        tooltip.textContent = `Step ${index+1}: ${step.text}`;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Next →';
        closeBtn.style.cssText = 'margin-left: 20px; background: #007bff; border: none; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer;';
        closeBtn.onclick = () => {
            document.body.removeChild(tooltip);
            element.classList.remove('ulegacy-guide-highlight');
            currentStep++;
            showStep(currentStep);
        };
        tooltip.appendChild(closeBtn);
        document.body.appendChild(tooltip);
    } else {
        // Fallback: skip this step
        console.warn('Element not found:', step.selector);
        currentStep++;
        showStep(currentStep);
    }
}

// Listen for message from popup to start guide
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'start_guide') {
        startGuide();
        sendResponse({ status: 'started' });
    }
});

console.log('ULegacy Guided Logic loaded');