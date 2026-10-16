# ULegacy — Complete User Manual

Welcome to ULegacy, the privacy-first digital legacy system. This guide will walk you through everything you need to know to secure your digital footprint (as an Owner) and execute final wishes (as a Beneficiary).

---

## 1. Introduction
ULegacy operates as a "Dead Man's Switch." It silently monitors your web browsing activity. If you are inactive for more than 30 days, the system assumes you may be incapacitated or deceased. After a 7-day warning period, it automatically contacts your designated beneficiary, providing them with a secure portal to automatically delete your connected social media accounts without ever reading your private messages.

---

## 2. For the Owner: Securing Your Digital Legacy

### 2.1 Registration
1. Click on the ULegacy extension icon in your Chrome toolbar.
2. You will be greeted by the Registration screen.
3. **Generate Recovery Key:** Click the "Generate New Key" button. The system will create a highly secure, 64-character hexadecimal key.
4. **Enter Email:** Type in your primary email address.
5. Click **Register**.

### 2.2 Securing Your Recovery Key (CRITICAL)
Your Recovery Key is the master password to your encrypted vault. **ULegacy does not store this key anywhere on its servers.** 
*   **Copy the Key:** Click the copy icon next to the key.
*   **Store it offline:** Print it out, write it down, or store it in a physical safe. 
*   **Share it:** Ensure your designated beneficiary knows where to find this key in the event of your death. If this key is lost, your digital vault cannot be unlocked.

### 2.3 Adding Social Media Accounts
Once registered, you will see the Owner Dashboard.
1. Scroll down to the **Vault** section.
2. Click **+ Add Account**.
3. Select the platform (Facebook, Instagram, or TikTok) from the dropdown.
4. Enter your exact login username and password for that platform.
5. Click **Save**. The account is now encrypted using your Recovery Key and securely synced to the server.

### 2.4 Assigning a Beneficiary
Your beneficiary is the trusted person who will carry out your account deletions.
1. Scroll to the **Beneficiary** section.
2. Enter your trusted contact's email address.
3. Click **Save Beneficiary**. 
*(Note: They will not be notified until you trigger the Dead Man's Switch).*

### 2.5 How the Heartbeat Works
You do not need to do anything to tell ULegacy you are alive. The extension operates silently in the background. It detects when you switch tabs, click links, or type on any website. 
*   It sends a tiny "heartbeat" signal to the server exactly once every 24 hours.
*   If you stop using your browser for 30 consecutive days, the 7-day Grace Period begins.

### 2.6 Editing Your Profile
*   **Changing Email:** Click the "Edit" button next to your email address at the top of the dashboard to change it.
*   **Regenerating Key:** If you believe your Recovery Key was compromised, click the refresh icon next to the key to generate a new one. (You must give the new key to your beneficiary).
*   **Force Reset Timer:** If you want to manually prove you are active (or you were away on a long vacation), click the "Force Reset Timer" button at the bottom of the dashboard to reset the 30-day countdown immediately.

---

## 3. For the Beneficiary: Executing the Settlement

If the Owner has passed away, the Dead Man's Switch will eventually trigger. As the beneficiary, here is what you need to do.

### 3.1 Receiving the Settlement Email
After the owner's 30-day inactivity and 7-day grace period expire, you will receive a secure email from ULegacy.
*   The email will contain a unique **User ID**.
*   You must locate the physical **Recovery Key** that the owner left behind for you.

### 3.2 Accessing the Settlement Portal
1. Open the ULegacy extension.
2. In the top right corner, use the dropdown menu to switch your role from **"Owner"** to **"Beneficiary"**.
3. The Settlement Portal will load.

### 3.3 Unlocking the Vault
1. Paste the **User ID** from your email into the first box.
2. Paste the **Recovery Key** the owner provided into the second box.
3. Click **Verify & Load**. The system will securely unlock the vault.

### 3.4 Executing Automated Account Deletions
You will now see a list of the owner's connected accounts.
1. Click the red **Delete** button next to an account (e.g., Facebook).
2. A new browser window will open automatically.
3. **Do not touch your mouse or keyboard.** The ULegacy system will automatically log in, navigate the complex account settings, and permanently delete the profile.
4. Once completed, the window will close itself, and the dashboard will show a green checkmark next to the account.

### 3.5 The Privacy Shield (What to Expect)
While the automation is running, ULegacy enforces the deceased's privacy. If the system accidentally navigates over a feed or a direct messaging page, you will see a heavy blur (the Privacy Shield) applied instantly. **You cannot read the messages.** Do not attempt to click on them.

### 3.6 Human-in-the-Loop Fallbacks
Sometimes, social media sites ask for a security check.
*   **CAPTCHAs:** If the system detects a CAPTCHA (like identifying traffic lights), it will pause. A red tooltip will appear telling you to solve the CAPTCHA manually. Once you click "Next", the automation will resume.
*   **Error Finding Buttons:** If the social media site changed its layout, a red tooltip will point to a button and ask you to click it manually, then click Next.

### 3.7 Finalizing the Settlement
1. Once all accounts have green checkmarks, click the large **Complete Settlement** button at the bottom of the dashboard.
2. The server will permanently shred the encrypted vault and all associated data.
3. You will receive a final confirmation email with an audit log of the deleted accounts.

---

## 4. Troubleshooting & FAQs

**Q: What if I lose my Recovery Key?**
A: If the Owner loses the Recovery Key, they can click "Generate New Key" in their dashboard. However, if the Owner passes away and the beneficiary cannot find the key, the accounts are permanently locked forever. ULegacy cannot recover it.

**Q: Will the system accidentally trigger if I go on a 2-week vacation?**
A: No. The system requires 30 days of total inactivity, followed by a 7-day grace period where you will receive multiple warning emails. You can click a link in those emails from your phone to instantly reset the timer.

**Q: Does ULegacy track the websites I visit?**
A: Absolutely not. The extension only detects *that* you are using the browser (by tracking mouse clicks and tab changes), it never records *what* you are looking at.

**Q: Can I use this on my phone?**
A: Currently, the ULegacy extension must be installed on a desktop computer running Google Chrome or a Chromium-based browser to perform the automated deletions.
