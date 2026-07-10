import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend/ directory
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(dotenv_path=_env_path)

logger = logging.getLogger("ulegacy.notifications")

SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USERNAME = os.getenv("SMTP_USERNAME")  # your Gmail address
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")  # App Password (not normal password)
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USERNAME)
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")

# ---------- Core Email Sender ----------

def send_email(to_email: str, subject: str, html_content: str, text_content: str = None):
    """Send email using Gmail SMTP with HTML and plain-text fallback"""
    if not SMTP_USERNAME or not SMTP_PASSWORD:
        logger.warning(f"SMTP credentials not configured — skipping email to {to_email}")
        return {"success": False, "error": "SMTP credentials not configured"}

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = f"ULegacy <{FROM_EMAIL}>"
        msg['To'] = to_email

        # Plain-text fallback (improves deliverability)
        if text_content:
            msg.attach(MIMEText(text_content, 'plain'))

        # HTML version
        msg.attach(MIMEText(html_content, 'html'))

        # Send
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.sendmail(FROM_EMAIL, to_email, msg.as_string())

        logger.info(f"Email sent to {to_email}: {subject}")
        return {"success": True}
    except Exception as e:
        logger.error(f"Email failed to {to_email}: {e}")
        return {"success": False, "error": str(e)}

# ---------- Shared Email Header/Footer Components ----------

def _email_header(title: str, subtitle: str, gradient: str = "linear-gradient(135deg, #4a00e0, #8e2de2)"):
    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: {gradient}; padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">{title}</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 5px 0 0;">{subtitle}</p>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e9ecf2;">
    """

def _email_footer():
    return """
            <p style="font-size: 11px; color: #adb5bd; margin-top: 20px; text-align: center;">
                ULegacy — Post Mortem Data Management<br>
                This is an automated message. Please do not reply directly.
            </p>
        </div>
    </div>
    """

def _email_button(text: str, url: str, color: str = "#4a00e0"):
    return f"""
    <div style="text-align: center; margin: 24px 0;">
        <a href="{url}" style="background: {color}; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">{text}</a>
    </div>
    """

def _email_warning_box(text: str):
    return f"""
    <div style="background: #fff3cd; padding: 12px 16px; border-radius: 8px; margin: 16px 0;">
        <p style="font-size: 13px; color: #856404; margin: 0;">{text}</p>
    </div>
    """

# ==========================================================================
# EMAIL TYPE 1: Grace Period — Owner Notification
# Sent when the owner has been inactive for 30 days.
# ==========================================================================

def send_grace_period_email(email: str, reset_link: str):
    """Send grace period notification to owner — 30 days inactive, 7 days to respond"""
    html = _email_header("ULegacy", "Are you still with us?")
    html += f"""
            <p style="font-size: 15px; color: #2d3748;">Dear Owner,</p>
            <p style="font-size: 15px; color: #2d3748;">Your ULegacy account has been <strong>inactive for 30 days</strong>.</p>
            <p style="font-size: 15px; color: #2d3748;">If you're still alive and well, please open your browser extension or click the button below to reset the timer:</p>
            {_email_button("I'm Alive — Reset Timer", reset_link, "#28a745")}
            <p style="font-size: 14px; color: #6c757d; border-top: 1px solid #e9ecf2; padding-top: 16px;">
                If we don't hear from you in <strong>7 days</strong>, your designated beneficiary will be notified and the settlement process will begin.
            </p>
    """
    html += _email_footer()

    text = (
        "ULegacy — Are you still with us?\n\n"
        "Dear Owner,\n\n"
        "Your ULegacy account has been inactive for 30 days.\n"
        "If you're still alive and well, please open your browser extension to reset the timer.\n\n"
        "If we don't hear from you in 7 days, your designated beneficiary will be notified.\n"
    )
    return send_email(email, "ULegacy: Are you still there?", html, text)

# ==========================================================================
# EMAIL TYPE 2: Grace Period — Beneficiary Notification
# Sent to the beneficiary when the owner enters grace period.
# Asks if the owner is still active with confirm/deny links.
# ==========================================================================

def send_beneficiary_grace_email(email: str, owner_email: str, user_id: str, confirmation_token: str):
    """Send grace period notification to beneficiary — asking if owner is still active"""
    confirm_active_url = f"{BASE_URL}/api/settlement/confirm-active/{user_id}/{confirmation_token}"
    confirm_inactive_url = f"{BASE_URL}/api/settlement/confirm-inactive/{user_id}/{confirmation_token}"

    html = _email_header("ULegacy", "Owner Activity Check")
    html += f"""
            <p style="font-size: 15px; color: #2d3748;">Dear Beneficiary,</p>
            <p style="font-size: 15px; color: #2d3748;">
                The ULegacy account owner (<strong>{owner_email}</strong>) has been 
                <strong>inactive for 30 days</strong>. As their designated beneficiary, 
                we need your help to verify their status.
            </p>
            <p style="font-size: 15px; color: #2d3748;">
                Do you know if the owner is still active?
            </p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{confirm_active_url}" style="background: #28a745; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block; margin: 0 8px;">Yes, Owner is Active</a>
                <a href="{confirm_inactive_url}" style="background: #dc3545; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block; margin: 0 8px;">No, Owner is Inactive</a>
            </div>
            {_email_warning_box("If you select 'Owner is Inactive', the settlement process will begin immediately. You will need the Recovery Key that was shared with you by the owner to complete the process.")}
            <p style="font-size: 14px; color: #6c757d; border-top: 1px solid #e9ecf2; padding-top: 16px;">
                If neither you nor the owner responds within <strong>7 days</strong>, 
                the settlement process will begin automatically and you will receive 
                further instructions via email.
            </p>
    """
    html += _email_footer()

    text = (
        "ULegacy — Owner Activity Check\n\n"
        "Dear Beneficiary,\n\n"
        f"The ULegacy account owner ({owner_email}) has been inactive for 30 days.\n"
        "As their designated beneficiary, we need your help to verify their status.\n\n"
        f"Owner is still active: {confirm_active_url}\n"
        f"Owner is inactive: {confirm_inactive_url}\n\n"
        "If neither responds within 7 days, settlement will begin automatically.\n"
    )
    return send_email(email, "ULegacy: Owner Activity Verification Required", html, text)

# ==========================================================================
# EMAIL TYPE 3: Grace Period Reminder — Owner
# Sent at day 3 and day 5 of the 7-day grace period.
# ==========================================================================

def send_grace_reminder_email(email: str, days_remaining: int, reset_link: str):
    """Send a grace period reminder to the owner during the 7-day window"""
    urgency_color = "#dc3545" if days_remaining <= 2 else "#f0ad4e"

    html = _email_header("ULegacy", f"⚠️ {days_remaining} Days Remaining", f"linear-gradient(135deg, {urgency_color}, #e74c3c)")
    html += f"""
            <p style="font-size: 15px; color: #2d3748;">Dear Owner,</p>
            <p style="font-size: 15px; color: #2d3748;">
                This is a reminder that your ULegacy grace period has 
                <strong>{days_remaining} day{"s" if days_remaining != 1 else ""} remaining</strong>.
            </p>
            <p style="font-size: 15px; color: #2d3748;">
                If you do not respond, your designated beneficiary will be notified 
                and the digital asset settlement process will begin automatically.
            </p>
            {_email_button("I'm Alive — Reset Timer", reset_link, "#28a745")}
            {_email_warning_box(f"You have {days_remaining} day{'s' if days_remaining != 1 else ''} to respond before settlement begins. This action cannot be undone once initiated.")}
    """
    html += _email_footer()

    text = (
        f"ULegacy — {days_remaining} Days Remaining\n\n"
        "Dear Owner,\n\n"
        f"Your ULegacy grace period has {days_remaining} day(s) remaining.\n"
        "If you do not respond, settlement will begin automatically.\n\n"
        f"Reset timer: {reset_link}\n"
    )
    return send_email(email, f"ULegacy: ⚠️ {days_remaining} Days Until Settlement", html, text)

# ==========================================================================
# EMAIL TYPE 4: Settlement Instructions — Beneficiary
# Sent when settlement is triggered (either by 7-day expiry or beneficiary
# confirming owner is inactive). Contains step-by-step instructions.
# ==========================================================================

def send_settlement_instructions_email(email: str, user_id: str):
    """Send detailed settlement instructions to the beneficiary"""
    html = _email_header("ULegacy", "Settlement Process — Instructions", "linear-gradient(135deg, #1a1a2e, #16213e)")
    html += f"""
            <p style="font-size: 15px; color: #2d3748;">Dear Beneficiary,</p>
            <p style="font-size: 15px; color: #2d3748;">
                The account owner has been confirmed inactive. You can now begin the 
                digital asset settlement process. Please follow the steps below carefully.
            </p>

            <div style="background: white; border: 1px solid #e9ecf2; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <h3 style="font-size: 14px; color: #2d3748; margin: 0 0 12px;">Step-by-Step Instructions</h3>
                
                <div style="margin: 10px 0; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #4a00e0;">
                    <strong style="color: #4a00e0;">Step 1:</strong>
                    <span style="color: #2d3748;">Install the ULegacy Chrome extension (if not already installed) or open it in your browser.</span>
                </div>
                
                <div style="margin: 10px 0; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #4a00e0;">
                    <strong style="color: #4a00e0;">Step 2:</strong>
                    <span style="color: #2d3748;">Switch to <strong>"Beneficiary"</strong> mode using the dropdown at the top-right of the extension popup.</span>
                </div>
                
                <div style="margin: 10px 0; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #4a00e0;">
                    <strong style="color: #4a00e0;">Step 3:</strong>
                    <span style="color: #2d3748;">Enter the <strong>Recovery Key</strong> that was shared with you by the owner.</span>
                </div>
                
                <div style="margin: 10px 0; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #4a00e0;">
                    <strong style="color: #4a00e0;">Step 4:</strong>
                    <span style="color: #2d3748;">Enter the following <strong>User ID</strong>:</span>
                    <div style="margin-top: 4px; padding: 6px 10px; background: #e9ecf2; border-radius: 4px; font-family: monospace; font-size: 12px; word-break: break-all;">{user_id}</div>
                </div>
                
                <div style="margin: 10px 0; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #4a00e0;">
                    <strong style="color: #4a00e0;">Step 5:</strong>
                    <span style="color: #2d3748;">Click <strong>"Verify & Load"</strong>. You will see a list of accounts to delete.</span>
                </div>
                
                <div style="margin: 10px 0; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #4a00e0;">
                    <strong style="color: #4a00e0;">Step 6:</strong>
                    <span style="color: #2d3748;">Click <strong>"Delete"</strong> on each account. A new tab will open, log in automatically, and guide you through the deletion process.</span>
                </div>
                
                <div style="margin: 10px 0; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #4a00e0;">
                    <strong style="color: #4a00e0;">Step 7:</strong>
                    <span style="color: #2d3748;">Once all accounts are deleted, click <strong>"Complete Settlement"</strong> to finalize the process.</span>
                </div>
            </div>

            {_email_warning_box("You will need the Recovery Key to decrypt and access the accounts. Without it, the data cannot be recovered. If you encounter any security checks (CAPTCHAs), please complete them manually — the process will resume automatically.")}
            <p style="font-size: 13px; color: #6c757d;">This settlement process should be completed within 30 days.</p>
    """
    html += _email_footer()

    text = (
        "ULegacy — Settlement Process Instructions\n\n"
        "Dear Beneficiary,\n\n"
        "The account owner has been confirmed inactive. Follow these steps:\n\n"
        "1. Install or open the ULegacy Chrome extension\n"
        "2. Switch to 'Beneficiary' mode\n"
        "3. Enter the Recovery Key shared by the owner\n"
        f"4. Enter User ID: {user_id}\n"
        "5. Click 'Verify & Load'\n"
        "6. Click 'Delete' on each account and follow the guided process\n"
        "7. Click 'Complete Settlement' when done\n\n"
        "You need the Recovery Key to proceed. Without it, data cannot be recovered.\n"
    )
    return send_email(email, "ULegacy: Settlement Process — Action Required", html, text)

# ==========================================================================
# EMAIL TYPE 5: Settlement Triggered — Beneficiary (Original, updated)
# Sent when the 7-day grace period expires with no response from anyone.
# ==========================================================================

def send_settlement_email(email: str, token: str, settlement_link: str):
    """Send settlement notification to beneficiary — owner confirmed inactive after full 7-day expiry"""
    html = _email_header("ULegacy", "Digital Will Settlement", "linear-gradient(135deg, #1a1a2e, #16213e)")
    html += f"""
            <p style="font-size: 15px; color: #2d3748;">Dear Beneficiary,</p>
            <p style="font-size: 15px; color: #2d3748;">
                The account owner has been <strong>inactive for over 37 days</strong> 
                and has not responded to our verification attempts during the 7-day grace period.
            </p>
            <p style="font-size: 15px; color: #2d3748;">
                As the designated beneficiary, the settlement process is now available. 
                Please follow the instructions below to begin managing the owner's digital accounts.
            </p>

            <div style="background: white; border: 1px solid #e9ecf2; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <h3 style="font-size: 14px; color: #2d3748; margin: 0 0 8px;">What to do next:</h3>
                <ol style="font-size: 14px; color: #2d3748; padding-left: 20px;">
                    <li style="margin: 6px 0;">Open the ULegacy Chrome extension</li>
                    <li style="margin: 6px 0;">Switch to <strong>Beneficiary</strong> mode</li>
                    <li style="margin: 6px 0;">Enter the <strong>Recovery Key</strong> and <strong>User ID</strong> (provided separately)</li>
                    <li style="margin: 6px 0;">Click <strong>Verify & Load</strong></li>
                    <li style="margin: 6px 0;">Delete each account using the guided process</li>
                    <li style="margin: 6px 0;">Click <strong>Complete Settlement</strong> when finished</li>
                </ol>
            </div>

            {_email_warning_box("You will need the Recovery Key to decrypt and access the accounts. Without it, the data cannot be recovered.")}
            <p style="font-size: 13px; color: #6c757d;">This settlement link will expire in 30 days.</p>
    """
    html += _email_footer()

    text = (
        "ULegacy — Digital Will Settlement\n\n"
        "Dear Beneficiary,\n\n"
        "The account owner has been inactive for over 37 days and has not responded.\n\n"
        "To begin the settlement process:\n"
        "1. Open the ULegacy Chrome extension\n"
        "2. Switch to Beneficiary mode\n"
        "3. Enter Recovery Key and User ID\n"
        "4. Click Verify & Load\n"
        "5. Delete each account using the guided process\n"
        "6. Click Complete Settlement when finished\n\n"
        "You need the Recovery Key to proceed.\n"
        "This link expires in 30 days.\n"
    )
    return send_email(email, "ULegacy: Digital Will Settlement", html, text)