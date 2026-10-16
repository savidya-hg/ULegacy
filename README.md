# ULegacy — Privacy-First Digital Legacy System
> **Final Year Research Project**

ULegacy is a decentralized, zero-knowledge digital estate management system. It acts as an automated "Dead Man's Switch," monitoring a user's inactivity and securely guiding a designated beneficiary to delete their social media accounts (Facebook, Instagram, TikTok) post-mortem, without ever exposing the deceased's private communications.

## System Architecture
*   **Frontend:** Manifest V3 Chrome Extension (Javascript, Web Crypto API)
*   **Backend:** Python 3.10+, FastAPI
*   **Database:** Supabase (PostgreSQL)

---

## Local Development Setup Guide

Follow these instructions to run the ULegacy system on your local machine.

### 1. Prerequisites
*   [Python 3.10 or higher](https://www.python.org/downloads/) installed.
*   Google Chrome
*   A free [Supabase](https://supabase.com/) account.
*   A Gmail account with an "App Password" generated (for sending automated emails).

### 2. Database Setup (Supabase)
1. Create a new project in Supabase.
2. In the Supabase SQL Editor, create the following required tables:
   ```sql
   -- Create Users Table
   CREATE TABLE users (
       id UUID PRIMARY KEY,
       email TEXT UNIQUE NOT NULL,
       recovery_key_hash TEXT NOT NULL,
       salt TEXT NOT NULL,
       beneficiary_email TEXT,
       status TEXT DEFAULT 'active',
       last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
       grace_period_start TIMESTAMP WITH TIME ZONE,
       settlement_token TEXT
   );

   -- Create Vaults Table
   CREATE TABLE vaults (
       id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
       user_id UUID REFERENCES users(id) ON DELETE CASCADE,
       encrypted_data TEXT NOT NULL,
       platform_metadata JSONB
   );
   ```
3. Retrieve your **Project URL** and **anon/public API Key** from Settings > API.

### 3. Backend Setup (FastAPI)
Open your terminal and navigate to the project directory:

```bash
# 1. Navigate to the backend directory
cd backend

# 2. Create a virtual environment
python -m venv venv

# 3. Activate the virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# 4. Install dependencies
pip install -r requirements.txt
pip install apscheduler  # Required for the background timer
```

**Environment Variables:**
Create a `.env` file inside the `backend/` directory and add it with your credentials:

```env
SUPABASE_URL="your-supabase-url"
SUPABASE_KEY="your-supabase-anon-key"

SMTP_SERVER="smtp.gmail.com"
SMTP_PORT=587
SMTP_USERNAME="your-email@gmail.com"
SMTP_PASSWORD="your-16-character-app-password"
FROM_EMAIL="your-email@gmail.com"

BASE_URL="http://localhost:8000"
```

**Run the Server:**
Start the FastAPI server using Uvicorn:
```bash
uvicorn app.main:app --reload
```
The backend is now running at `http://localhost:8000`.

### 4. Frontend Setup (Chrome Extension)
1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in the URL bar.
3. Enable **"Developer mode"** in the top right corner.
4. Click **"Load unpacked"** in the top left corner.
5. Select the `extension/` folder located inside the `ULegacy` project directory.
6. Pin the ULegacy extension icon to your browser toolbar for easy access.

---

## Testing the System (Simulation)

To avoid waiting 37 days for the Dead Man's Switch to trigger organically, you can use the built-in simulation endpoints.

1. **Register as Owner:** Open the extension, generate a Recovery Key, and register your email. Add a mock Facebook account to your vault.
2. **Trigger Grace Period:** In the extension popup, click the **"Test: Grace Period"** button. This instantly ages your backend heartbeat by 31 days and dispatches the warning emails.
3. **Trigger Settlement:** Click **"Test: Final Settlement"** to instantly bypass the 7-day grace period. You will receive an email containing the `user_id`.
4. **Act as Beneficiary:** Switch the extension to "Beneficiary" mode. Enter the `user_id` and the Owner's Recovery Key. 
5. **Execute:** Click "Delete" on the Facebook account to watch the automated step-engine and Privacy Shield in action.

---
**License:** Academic / Open-Source
