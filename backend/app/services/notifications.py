import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USERNAME = os.getenv("SMTP_USERNAME")  # your Gmail address
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")  # App Password (not normal password)
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USERNAME)

def send_email(to_email: str, subject: str, html_content: str):
    """Send email using Gmail SMTP (free)"""
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = FROM_EMAIL
        msg['To'] = to_email

        # Attach HTML
        part = MIMEText(html_content, 'html')
        msg.attach(part)

        # Send
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.sendmail(FROM_EMAIL, to_email, msg.as_string())

        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

def send_grace_period_email(email: str, reset_link: str):
    """Send grace period notification to owner"""
    html = f"""
    <h1>ULegacy - Are you still with us?</h1>
    <p>Your ULegacy account has been inactive for 30 days.</p>
    <p>If you're still alive and well, please click the link below to reset the timer:</p>
    <p><a href="{reset_link}">Click here to reset</a></p>
    <p>If we don't hear from you in 7 days, your designated beneficiary will be notified.</p>
    """
    return send_email(email, "ULegacy: Are you still there?", html)

def send_settlement_email(email: str, token: str, settlement_link: str):
    """Send settlement notification to beneficiary"""
    html = f"""
    <h1>ULegacy - Digital Will Settlement</h1>
    <p>The ULegacy owner has been inactive for over 30 days and has not responded to our verification attempts.</p>
    <p>To settle their digital will, click the link below and enter the recovery key:</p>
    <p><a href="{settlement_link}?token={token}">Click here to settle</a></p>
    <p>This link will expire in 30 days.</p>
    """
    return send_email(email, "ULegacy: Digital Will Settlement", html)