# Captain Billing — Developer & Owner Guide
## Version 11 | Complete Code Reference

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [How the App Works — Flow Overview](#2-how-the-app-works--flow-overview)
3. [How to Change Prices](#3-how-to-change-prices)
4. [How to Change Your UPI ID](#4-how-to-change-your-upi-id)
5. [How to Change Your WhatsApp Number](#5-how-to-change-your-whatsapp-number)
6. [How to Change the Trial Duration](#6-how-to-change-the-trial-duration)
7. [How to Activate Premium for a User](#7-how-to-activate-premium-for-a-user)
8. [Screen Flow Explained](#8-screen-flow-explained)
9. [How the Trial & Expiry System Works](#9-how-the-trial--expiry-system-works)
10. [Firebase Setup Reference](#10-firebase-setup-reference)
11. [Running the App Locally](#11-running-the-app-locally)
12. [Building a Distributable Installer](#12-building-a-distributable-installer)
13. [Frequently Asked Questions](#13-frequently-asked-questions)

---

## 1. Project Structure

```
CaptainBilling_v11/
├── main.js                  ← Electron main process (window, tray, IPC)
├── preload.js               ← Exposes safe APIs to renderer (electronAPI)
├── package.json             ← App name, version, Electron config
├── DEVELOPER_GUIDE.md       ← THIS FILE
│
├── assets/
│   ├── icon.ico             ← App window icon
│   ├── tray.ico             ← System tray icon
│   └── bill-icon.ico        ← Icon for bill windows
│
├── renderer/
│   └── index.html           ← THE ENTIRE FRONTEND (all UI, CSS, JS in one file)
│
└── src/
    ├── firebase.js          ← Firebase SDK initialization + all Firestore helpers
    ├── firebase-config.js   ← Firebase project config (reference only)
    ├── auth-bridge.js       ← Auth state management + welcome screen logic
    └── auth.html            ← Google OAuth popup (opened by main.js)
```

---

## 2. How the App Works — Flow Overview

```
App opens
    │
    ▼
Login Screen shown  ←─── user must sign in (no offline mode)
    │ (Google sign-in)
    ▼
auth-bridge.js: onAuthChange()
    │
    ├─ checks Firestore for user doc
    ├─ determines status: 'trial' | 'active' | 'expired'
    │
    ▼
Welcome Screen shown (once per session)
    │ user clicks "Start Trial" or "Buy Now"
    ▼
App unlocked (if trial/active) OR Upgrade Wall shown (if expired)
    │
    ▼
Cloud sync: bills, contacts, settings loaded from Firestore
```

---

## 3. How to Change Prices

Open: `renderer/index.html`

Search for this block (around line 4215):

```javascript
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  ✏️  OWNER CONFIG — EDIT ONLY THIS SECTION                              ║
// ╠══════════════════════════════════════════════════════════════════════════╣

const PLANS = [
  { name: 'Monthly',  months: 1,  price: 99,  suffix: '/mo',  save: ''          },
  { name: '6 Months', months: 6,  price: 449, suffix: '/6mo', save: 'Save ₹145' },
  { name: 'Yearly',   months: 12, price: 799, suffix: '/yr',  save: 'Save ₹389' },
];
```

### To change prices:

| Field    | What it does                                      | Example     |
|----------|---------------------------------------------------|-------------|
| `name`   | Label shown on the plan card                      | `'Monthly'` |
| `months` | How many months this plan covers (for your record)| `1`         |
| `price`  | ₹ amount charged — appears on card + UPI QR       | `99`        |
| `suffix` | Small text after price                            | `'/mo'`     |
| `save`   | Green savings badge (leave `''` to hide it)       | `'Save ₹145'` |

### Example — raise prices:

```javascript
const PLANS = [
  { name: 'Monthly',  months: 1,  price: 149, suffix: '/mo',  save: ''          },
  { name: '6 Months', months: 6,  price: 699, suffix: '/6mo', save: 'Save ₹195' },
  { name: 'Yearly',   months: 12, price: 999, suffix: '/yr',  save: 'Save ₹789' },
];
```

✅ Changes take effect everywhere automatically:
- Login screen plan cards
- Welcome screen plan cards
- Premium/Upgrade overlay plan cards
- UPI QR code amount

---

## 4. How to Change Your UPI ID

In the same OWNER CONFIG block:

```javascript
const UPI_ID = '9878654321@ybl';   // ← Replace this with your UPI ID
```

### Examples of valid UPI IDs:
- `yourname@ybl`  (PhonePe)
- `yourname@oksbi`  (SBI)
- `yourname@okhdfcbank`  (HDFC)
- `9876543210@paytm`  (Paytm)
- `yourname@ibl`  (ICICI)

The UPI ID is used to:
1. Display in the payment section (users copy it manually)
2. Generate the UPI QR code (via api.qrserver.com)
3. Build the `upi://pay?pa=...` deep-link

---

## 5. How to Change Your WhatsApp Number

In the same OWNER CONFIG block:

```javascript
const WA_NUMBER = '919878654321';   // ← Replace this
```

**Format rules:**
- Country code + phone number, NO `+`, NO spaces, NO dashes
- India (+91): `91` + 10-digit number → `919876543210`
- UAE (+971): `971` + 9-digit number → `971501234567`

This number is displayed in the "After payment" section so customers know where to send their payment screenshot.

---

## 6. How to Change the Trial Duration

In the OWNER CONFIG block:

```javascript
const TRIAL_DAYS = 7;   // ← Change to any number of days
```

| Value | Effect                                |
|-------|---------------------------------------|
| `7`   | 7-day free trial (default)            |
| `14`  | 2-week trial                          |
| `30`  | 1-month trial                         |
| `0`   | No trial — must pay immediately       |

**Note:** The trial start date is stored in Firestore on first login and cannot be reset by the user. Changing `TRIAL_DAYS` in code affects ALL users (including existing ones whose trial has already started).

---

## 7. How to Activate Premium for a User

You do this manually in the **Firebase Console** (no admin panel built-in yet).

### Steps:

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Open your project → **Firestore Database**
3. Navigate to: `users` → `{user's UID}` 
   - Find the UID: user's Google account UID (shown in Firebase Auth tab)
4. Set these two fields:

| Field           | Type      | Value                                              |
|-----------------|-----------|----------------------------------------------------|
| `premium`       | boolean   | `true`                                             |
| `premiumExpiry` | timestamp | Set to the date their subscription expires         |

### Example — 1 month from today:
- `premium`: `true`
- `premiumExpiry`: Click the timestamp picker, set date 1 month ahead

### To revoke premium:
- Set `premium` to `false`, or set `premiumExpiry` to a past date

---

## 8. Screen Flow Explained

### Screen 1: Login Screen
- Shown to ALL unauthenticated users
- No offline option (removed in v11)
- Shows plan pricing cards so users know what they're signing up for
- Two CTAs: "Sign in with Google" and "Start My 7-Day Free Trial" (both trigger the same Google auth)

### Screen 2: Welcome Screen
- Shown ONCE per session after successful login
- Displays user's trial status (days remaining)
- Shows 3 plan cards (clickable to select a plan)
- **"Start Free Trial" button** → dismisses welcome screen, enters app
- **"Buy Now" button** → opens payment/upgrade overlay
- On next app launch (same session), skips to app directly

### Screen 3: The App
- Full billing UI
- Trial days badge shown in top-right user chip
- Upgrade/PRO badge shown when premium is active

### Screen 4: Upgrade Wall (Expired users)
- Shown when trial has expired AND user has no active premium
- The app behind it is **completely disabled** (grey + no pointer events)
- The close button ("Maybe later") is **hidden**
- User MUST purchase a plan to continue

---

## 9. How the Trial & Expiry System Works

### Data stored in Firestore (`users/{uid}` document):

```json
{
  "trialStart":    Timestamp,   // set on first login
  "premium":       false,       // set to true when you activate manually
  "premiumExpiry": Timestamp,   // set when you activate premium
  "createdAt":     Timestamp    // when account was created
}
```

### Status determination logic (in `auth-bridge.js`):

```
1. If premium == true AND premiumExpiry > now  →  status = 'active'
2. If trialStart exists AND (now - trialStart) < TRIAL_DAYS  →  status = 'trial'
3. Otherwise  →  status = 'expired'
```

### What each status means:

| Status    | Welcome Screen          | App Access | Cloud Sync | Badge    |
|-----------|-------------------------|------------|------------|----------|
| `trial`   | Trial CTA shown         | ✅ Full     | ✅ Full     | TRIAL Xd |
| `active`  | Skipped (goes straight) | ✅ Full     | ✅ Full     | 👑 PRO   |
| `expired` | Upgrade wall shown      | ❌ Blocked  | ❌ Blocked  | UPGRADE  |

---

## 10. Firebase Setup Reference

The Firebase project is already configured. These are the keys used:

```javascript
// In src/firebase.js and src/firebase-config.js
const firebaseConfig = {
  apiKey:            "AIzaSyDcvQEkEuCqagBXMR0XdpYXqbDLFugRQ_Y",
  authDomain:        "billing-app-70f4f.firebaseapp.com",
  projectId:         "billing-app-70f4f",
  storageBucket:     "billing-app-70f4f.firebasestorage.app",
  messagingSenderId: "5472017689",
  appId:             "1:5472017689:web:afc6825acf1edede9c7988",
  measurementId:     "G-MMMK10FDSY"
};
```

### Firestore Collections:

```
users/
  {uid}/                     ← user document (premium status, trial)
    bills/
      {billId}               ← individual bill documents
    data/
      contacts               ← bulk contacts map
      settings               ← user settings
    contacts/
      {key}                  ← per-contact entries (legacy format)
```

### Firebase Auth:
- Method: Google OAuth via popup (handled in `src/auth.html`)
- Electron opens `auth.html` in a separate BrowserWindow
- Tokens are passed back to main app via Electron IPC

---

## 11. Running the App Locally

### Requirements:
- Node.js v16+ 
- npm v7+

### First-time setup:
```bash
cd CaptainBilling_v11
npm install
```

### Run in development:
```bash
npm start
```

### If you see a blank screen:
- Check DevTools (Ctrl+Shift+I) for errors
- Usually a Firebase connection issue — ensure you have internet

---

## 12. Building a Distributable Installer

### Windows (.exe installer):
```bash
npm run build
# Output: dist/CaptainBilling Setup x.x.x.exe
```

### Make sure `package.json` has:
```json
{
  "scripts": {
    "start": "electron .",
    "build": "electron-builder --win"
  },
  "build": {
    "appId": "com.luciferbilling.app",
    "productName": "Captain Billing",
    "win": {
      "target": "nsis",
      "icon": "assets/icon.ico"
    }
  }
}
```

Install electron-builder if needed:
```bash
npm install --save-dev electron-builder
```

---

## 13. Frequently Asked Questions

**Q: A user says their trial is expired but they paid. How do I fix it?**  
A: Go to Firebase Console → Firestore → `users/{uid}` → set `premium: true` and `premiumExpiry` to a future timestamp.

**Q: Can I extend someone's trial?**  
A: Yes. In Firestore, update their `trialStart` to a more recent timestamp. For example, setting it to today gives them a fresh 7-day trial.

**Q: Can users bypass the trial/payment by manipulating local storage?**  
A: No. The premium check reads directly from Firestore (server-side). Local storage is not used for auth or premium status.

**Q: How do I find a user's UID?**  
A: Firebase Console → Authentication → Users tab → find by email → copy UID.

**Q: Can I add a 4th pricing plan?**  
A: Yes. Add a 4th object to the `PLANS` array in `renderer/index.html`. You'll also need to add a 4th plan card `<div>` in the premium overlay HTML (`plan-12` section), and update `renderPlanCards()` if needed.

**Q: The UPI QR code isn't scanning. What's wrong?**  
A: Ensure `UPI_ID` is correct and the amount is a valid number. The QR is generated by `api.qrserver.com` — needs internet. Test the `upi://pay?pa=...` URL directly in a browser on your phone.

**Q: How do I change the app name from "Captain Billing"?**  
A: Search and replace `Captain Billing` in:
  - `renderer/index.html` (title, welcome screen, login screen)
  - `package.json` (`productName`, `name`)
  - `main.js` (window title)
  - `UPI_NAME` constant in `renderer/index.html`

---

*Last updated: v11 | Built with Electron + Firebase*
