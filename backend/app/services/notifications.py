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

def send_grace_period_email(email: str, reset_link: str):
    """Send grace period notification to owner — 30 days inactive, 7 days to respond"""
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #4a00e0, #8e2de2); padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">ULegacy</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 5px 0 0;">Are you still with us?</p>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e9ecf2;">
            <p style="font-size: 15px; color: #2d3748;">Your ULegacy account has been <strong>inactive for 30 days</strong>.</p>
            <p style="font-size: 15px; color: #2d3748;">If you're still alive and well, please open your browser extension or click the button below to reset the timer:</p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{reset_link}" style="background: #28a745; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">I'm Alive — Reset Timer</a>
            </div>
            <p style="font-size: 14px; color: #6c757d; border-top: 1px solid #e9ecf2; padding-top: 16px;">
                If we don't hear from you in <strong>7 days</strong>, your designated beneficiary will be notified and the settlement process will begin.
            </p>
        </div>
    </div>
    """
    text = (
        "ULegacy — Are you still with us?\n\n"
        "Your ULegacy account has been inactive for 30 days.\n"
        "If you're still alive and well, please open your browser extension to reset the timer.\n\n"
        "If we don't hear from you in 7 days, your designated beneficiary will be notified.\n"
    )
    return send_email(email, "ULegacy: Are you still there?", html, text)

def send_settlement_email(email: str, token: str, settlement_link: str):
    """Send settlement notification to beneficiary — owner confirmed inactive"""
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">ULegacy</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 5px 0 0;">Digital Will Settlement</p>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e9ecf2;">
            <p style="font-size: 15px; color: #2d3748;">The account owner has been <strong>inactive for over 37 days</strong> and has not responded to our verification attempts.</p>
            <p style="font-size: 15px; color: #2d3748;">As the designated beneficiary, you can now begin the settlement process. You will need the <strong>Recovery Key</strong> that was shared with you by the owner.</p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{settlement_link}?token={token}" style="background: #4a00e0; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Begin Settlement</a>
            </div>
            <div style="background: #fff3cd; padding: 12px 16px; border-radius: 8px; margin: 16px 0;">
                <p style="font-size: 13px; color: #856404; margin: 0;">You will need the Recovery Key to decrypt and access the accounts. Without it, the data cannot be recovered.</p>
            </div>
            <p style="font-size: 13px; color: #6c757d;">This settlement link will expire in 30 days.</p>
        </div>
    </div>
    """
    text = (
        "ULegacy — Digital Will Settlement\n\n"
        "The account owner has been inactive for over 37 days and has not responded to our verification attempts.\n\n"
        "As the designated beneficiary, you can begin the settlement process.\n"
        f"Settlement link: {settlement_link}?token={token}\n\n"
        "You will need the Recovery Key shared with you by the owner.\n"
        "This link will expire in 30 days.\n"
    )
    return send_email(email, "ULegacy: Digital Will Settlement", html, text)