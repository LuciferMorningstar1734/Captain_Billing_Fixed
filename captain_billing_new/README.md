# Captain Billing — Firebase Cloud Sync
Firebase project: billing-app-70f4f

## Your credentials are already configured.
No config editing needed — your Firebase values are pre-filled in src/firebase.js.

---

## Before first run — complete these 3 steps in Firebase Console

### Step 1 — Enable Google Sign-In
1. Go to https://console.firebase.google.com → billing app project
2. Left sidebar → Authentication → Sign-in method tab
3. Click Google → toggle Enable → set support email → Save

### Step 2 — Create Firestore Database
1. Left sidebar → Databases & Storage → Firestore Database → Create database
2. Choose Production mode → select region closest to you → Done
3. Go to Rules tab → replace everything with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}
```
4. Click Publish

### Step 3 — Add localhost as Authorized Domain
1. Authentication → Settings tab → Authorized domains
2. Confirm localhost is in the list (it usually is by default)
3. Also add 127.0.0.1 if not present

---

## Run the app
```
npm install
npm start
```

## How it works
- Sign in with Google on first launch
- Every Save / Update / Delete syncs to Firestore automatically
- Sign in on any device with the same Gmail → all bills appear instantly
- Works offline — syncs automatically when internet reconnects
- User chip in titlebar shows your name — click to sign out

## Project structure
```
CaptainBilling/
├── main.js              Electron main process
├── preload.js           IPC bridge (all APIs)
├── src/
│   ├── firebase.js      Firebase SDK + Auth + Firestore (YOUR CREDENTIALS ARE HERE)
│   ├── auth-bridge.js   Auth state → UI integration
│   └── login-overlay.html  Sign-in screen HTML
├── renderer/
│   └── index.html       Full billing app
├── assets/              App icons (add your icon.ico here)
└── package.json
```
