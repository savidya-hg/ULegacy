import os
import smtplib
import logging
from datetime import datetime
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
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=10) as server:
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
    html = _email_header("ULegacy Alert", "Inactivity detected")
    html += f"""
            <div style="text-align: center; margin: 30px 0;">
                <p style="font-size: 16px; color: #2d3748; margin-bottom: 24px;">Your ULegacy account has been inactive for 30 days. Please click the button below to reset the timer:</p>
                {_email_button("I'm Alive — Reset Timer", reset_link, "#28a745")}
            </div>
    """
    html += _email_footer()

    text = (
        "ULegacy Alert — Inactivity detected\n\n"
        "Your ULegacy account has been inactive for 30 days. Please click the link below to reset the timer:\n"
        f"{reset_link}\n"
    )
    return send_email(email, "ULegacy Alert: Inactivity Detected", html, text)

# ==========================================================================
# EMAIL TYPE 1B: Owner Reported Inactive Alert
# Sent when the beneficiary reports the owner as inactive.
# Gives the owner a link to cancel settlement and reset status to active.
# ==========================================================================

def send_owner_reported_inactive_email(email: str, reset_link: str):
    """Send alert email to owner when beneficiary has reported them inactive, giving them a reset button"""
    html = _email_header("ULegacy Alert", "Inactivity Confirmation", "linear-gradient(135deg, #dc3545, #bd2130)")
    html += f"""
            <p style="font-size: 15px; color: #2d3748;">Dear Owner,</p>
            <p style="font-size: 15px; color: #2d3748;">
                Your designated beneficiary has reported that you are currently inactive. As a result, the settlement process has been initiated.
            </p>
            <p style="font-size: 15px; color: #2d3748; font-weight: bold; color: #dc3545;">
                If this is a mistake and you are active, please click the button below immediately to cancel the settlement and mark your account active again:
            </p>
            {_email_button("I'm Alive — Cancel Settlement & Reset Timer", reset_link, "#28a745")}
    """
    html += _email_footer()

    text = (
        "ULegacy Alert — Inactivity Confirmation\n\n"
        "Dear Owner,\n\n"
        "Your designated beneficiary has reported that you are inactive. The settlement process has been initiated.\n\n"
        "If this is a mistake, please click the link below immediately to cancel the settlement and reset your timer:\n"
        f"{reset_link}\n"
    )
    return send_email(email, "ULegacy Alert: Settlement Process Initiated by Beneficiary", html, text)

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
# EMAIL TYPE 5: Settlement Complete — Owner & Beneficiary
# Sent after the beneficiary completes the settlement process.
# Contains a full activity log of all actions taken during settlement.
# ==========================================================================

def send_settlement_complete_email(email: str, user_id: str, audit_logs: list, is_owner: bool = False):
    """Send settlement completion report to owner or beneficiary with full audit trail."""
    role = "Owner" if is_owner else "Beneficiary"
    greeting = "Dear Account Owner," if is_owner else "Dear Beneficiary,"

    # Build the audit log rows
    log_rows = ""
    for log in audit_logs:
        timestamp = log.get("created_at", "—")
        # Format the timestamp nicely
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            formatted_time = dt.strftime("%b %d, %Y at %I:%M %p UTC")
        except Exception:
            formatted_time = timestamp

        action = log.get("action", "unknown").replace("_", " ").title()
        metadata = log.get("metadata", {})

        # Build a human-readable detail string from metadata
        details = []
        if metadata.get("triggered_by"):
            details.append(f"Triggered by: {metadata['triggered_by']}")
        if metadata.get("platform"):
            details.append(f"Platform: {metadata['platform']}")
        if metadata.get("settled_at"):
            details.append("Finalized")
        if metadata.get("old_email"):
            details.append(f"Changed from {metadata['old_email']}")
        if metadata.get("beneficiary_notified"):
            details.append(f"Notified: {metadata['beneficiary_notified']}")
        detail_str = "; ".join(details) if details else "—"

        # Color-code by action type
        if "complete" in log.get("action", ""):
            dot_color = "#28a745"
        elif "deleted" in log.get("action", ""):
            dot_color = "#dc3545"
        elif "verified" in log.get("action", ""):
            dot_color = "#4a00e0"
        elif "triggered" in log.get("action", ""):
            dot_color = "#f0ad4e"
        else:
            dot_color = "#6c757d"

        log_rows += f"""
            <tr>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f0f0f0; font-size: 12px; color: #6c757d; white-space: nowrap; vertical-align: top;">{formatted_time}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f0f0f0; font-size: 13px; vertical-align: top;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: {dot_color}; margin-right: 6px; vertical-align: middle;"></span>
                    <strong style="color: #2d3748;">{action}</strong>
                </td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f0f0f0; font-size: 12px; color: #6c757d; vertical-align: top;">{detail_str}</td>
            </tr>"""

    html = _email_header("ULegacy", "Settlement Complete ✓", "linear-gradient(135deg, #28a745, #20c997)")
    html += f"""
            <p style="font-size: 15px; color: #2d3748;">{greeting}</p>
            <p style="font-size: 15px; color: #2d3748;">
                The settlement process for ULegacy account <strong style="font-family: monospace; background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 12px;">{user_id}</strong> has been <strong style="color: #28a745;">completed successfully</strong>.
            </p>
            <p style="font-size: 15px; color: #2d3748;">
                Below is a complete log of all actions performed during the settlement process for your records.
            </p>

            <div style="background: white; border: 1px solid #e9ecf2; border-radius: 8px; padding: 0; margin: 20px 0; overflow: hidden;">
                <div style="background: #f8f9fa; padding: 10px 16px; border-bottom: 1px solid #e9ecf2;">
                    <h3 style="font-size: 14px; color: #2d3748; margin: 0;">📋 Settlement Activity Log</h3>
                </div>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #fafbfc;">
                            <th style="padding: 8px 10px; text-align: left; font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e9ecf2;">Timestamp</th>
                            <th style="padding: 8px 10px; text-align: left; font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e9ecf2;">Action</th>
                            <th style="padding: 8px 10px; text-align: left; font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e9ecf2;">Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {log_rows if log_rows else '<tr><td colspan="3" style="padding: 16px; text-align: center; color: #adb5bd;">No detailed logs available.</td></tr>'}
                    </tbody>
                </table>
            </div>

            <div style="background: #d4edda; padding: 12px 16px; border-radius: 8px; margin: 16px 0;">
                <p style="font-size: 13px; color: #155724; margin: 0;">
                    ✅ All designated accounts have been processed. The encrypted vault has been permanently deleted from ULegacy servers. No recoverable data remains.
                </p>
            </div>

            <p style="font-size: 13px; color: #6c757d; border-top: 1px solid #e9ecf2; padding-top: 16px;">
                This email serves as your official record of the settlement process. Please keep it for your reference.
            </p>
    """
    html += _email_footer()

    # Plain-text version
    log_text_lines = ""
    for log in audit_logs:
        timestamp = log.get("created_at", "—")
        action = log.get("action", "unknown").replace("_", " ").title()
        log_text_lines += f"  • {timestamp} — {action}\n"

    text = (
        f"ULegacy — Settlement Complete\n\n"
        f"{greeting}\n\n"
        f"The settlement for account {user_id} has been completed successfully.\n\n"
        f"Activity Log:\n{log_text_lines}\n"
        "All encrypted data has been permanently deleted.\n"
        "Please keep this email for your records.\n"
    )

    subject = "ULegacy: Settlement Complete — Activity Report"
    return send_email(email, subject, html, text)