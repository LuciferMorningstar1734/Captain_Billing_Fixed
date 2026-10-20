// ─────────────────────────────────────────────────────────────────────────────
//  firebase.js  — Captain Billing Firebase integration
//  Auth strategy: open a local HTML auth page in BrowserWindow,
//  that page does signInWithPopup normally (it runs from firebaseapp.com domain
//  via a redirect trick), sends the user back via IPC.
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp }          from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getAuth, GoogleAuthProvider,
         signInWithCredential,
         onAuthStateChanged,
         signOut,
         setPersistence,
         browserLocalPersistence,
         browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc,
         deleteDoc, collection, getDocs,
         enableIndexedDbPersistence,
         serverTimestamp }        from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// Load Firebase config from config.json (works in npm start AND packaged setup)
let firebaseConfig = {
  apiKey: "AIzaSyDcvQEkEuCqagBXMR0XdpYXqbDLFugRQ_Y",
  authDomain: "billing-app-70f4f.firebaseapp.com",
  projectId: "billing-app-70f4f",
  storageBucket: "billing-app-70f4f.firebasestorage.app",
  messagingSenderId: "5472017689",
  appId: "1:5472017689:web:afc6825acf1edede9c7988",
  measurementId: "G-MMMK10FDSY"
};

try {
  const cfg = await window.electronAPI.getConfig();
  if (cfg && cfg.firebase && cfg.firebase.apiKey) {
    firebaseConfig = cfg.firebase;
    console.log('[CB] Firebase config loaded from config.json');
  }
} catch(e) {
  console.warn('[CB] Could not load Firebase config from config.json, using defaults:', e.message);
}

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);

async function setAuthPersistenceMode(mode) {
  const persistence = mode === 'local' ? browserLocalPersistence : browserSessionPersistence;
  try {
    await setPersistence(auth, persistence);
    console.log('[CB] Auth persistence:', mode === 'local' ? 'local/PIN' : 'session');
    return { success: true };
  } catch (e) {
    console.warn('[CB] Auth persistence failed:', e.message);
    return { success: false, error: e.message };
  }
}

await setAuthPersistenceMode(localStorage.getItem('lb_pin_enabled') === '1' ? 'local' : 'session');

enableIndexedDbPersistence(db).catch(() => {});

// ── Sign in: main process opens a BrowserWindow with our auth.html page ───────
// auth.html lives at src/auth.html and runs on its own, sends token via IPC
async function doGoogleSignIn() {
  return new Promise((resolve) => {
    // Tell main process to open the auth window
    window.electronAPI.openGoogleAuth();

    // Wait for main process to send back the credential tokens
    const unsub = window.electronAPI.onGoogleToken(async (data) => {
      if (data.error) {
        if (data.error === 'cancelled') return;
        showLoginError(data.error);
        const btn = document.getElementById('googleSignInBtn');
        if (btn) { btn.innerHTML = getGoogleBtnHTML(); btn.disabled = false; }
        return;
      }
      try {
        const cred = GoogleAuthProvider.credential(data.id_token, data.access_token || null);
        const r    = await signInWithCredential(auth, cred);
        resolve({ success: true, user: r.user });
      } catch (e) {
        showLoginError(e.message);
        const btn = document.getElementById('googleSignInBtn');
        if (btn) { btn.innerHTML = getGoogleBtnHTML(); btn.disabled = false; }
      }
    });
  });
}

function getGoogleBtnHTML() {
  return `<svg width="18" height="18" viewBox="0 0 18 18" style="flex-shrink:0">
    <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z"/>
    <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z"/>
    <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z"/>
    <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 001.83 5.4L4.5 7.49a4.77 4.77 0 014.48-3.31z"/>
  </svg> Sign in with Google`;
}

function showLoginError(msg) {
  const errEl = document.getElementById('loginError');
  if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
}

window.FB = {
  // ── User doc (for premium/trial tracking) ────────────────────────────────
  getUserDoc: async (uid) => {
    if (!uid) return null;
    try {
      const s = await getDoc(doc(db,'users',uid));
      return s.exists() ? s.data() : null;
    } catch { return null; }
  },
  initUserDoc: async (uid) => {
    if (!uid) return;
    try {
      await setDoc(doc(db,'users',uid), {
        trialStart: serverTimestamp(),
        premium: false,
        createdAt: serverTimestamp()
      }, { merge: true });
    } catch(e) { console.error('initUserDoc:', e); }
  },
  // ── Contacts (cloud) ──────────────────────────────────────────────────────
  saveAllContactsCloud: async (uid, contacts) => {
    // contacts = { "Name": "phone", ... }
    if (!uid) return;
    try {
      await setDoc(doc(db,'users',uid,'data','contacts'), { data: contacts, updatedAt: serverTimestamp() });
    } catch(e) { console.error('saveAllContactsCloud:', e); }
  },
  loadAllContactsMapCloud: async (uid) => {
    if (!uid) return null;
    try {
      const s = await getDoc(doc(db,'users',uid,'data','contacts'));
      return s.exists() ? (s.data().data || {}) : null;
    } catch { return null; }
  },
  currentUser: () => auth.currentUser,
  signInWithGoogle: doGoogleSignIn,
  signOut: async () => signOut(auth),
  setPersistenceMode: setAuthPersistenceMode,
  onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb),

  saveBillCloud: async (uid, bill) => {
    if (!uid || !bill?.id) return;
    try { await setDoc(doc(db,'users',uid,'bills',bill.id), {...bill, updatedAt: serverTimestamp()}); } catch {}
  },
  deleteBillCloud: async (uid, id) => {
    if (!uid || !id) return;
    try { await deleteDoc(doc(db,'users',uid,'bills',id)); } catch {}
  },
  loadAllBillsCloud: async (uid) => {
    if (!uid) return [];
    try { const s = await getDocs(collection(db,'users',uid,'bills')); return s.docs.map(d=>d.data()); } catch { return []; }
  },
  saveSettingsCloud: async (uid, s) => {
    if (!uid) return;
    try { await setDoc(doc(db,'users',uid,'data','settings'), {...s, updatedAt: serverTimestamp()}); } catch {}
  },
  loadSettingsCloud: async (uid) => {
    if (!uid) return null;
    try { const s = await getDoc(doc(db,'users',uid,'data','settings')); return s.exists() ? s.data() : null; } catch { return null; }
  },
  saveContactCloud: async (uid, name, phone) => {
    if (!uid || !name) return;
    const k = name.trim().toLowerCase().replace(/\s+/g,'_');
    try { await setDoc(doc(db,'users',uid,'contacts',k), {name:name.trim(),phone:phone||'',updatedAt:serverTimestamp()}); } catch {}
  },
  loadContactsCloud: async (uid) => {
    if (!uid) return {};
    try {
      const s = await getDocs(collection(db,'users',uid,'contacts'));
      const o = {}; s.docs.forEach(d=>{ const v=d.data(); o[v.name]=v.phone||''; }); return o;
    } catch { return {}; }
  },
};

onAuthStateChanged(auth, user => {
  window.dispatchEvent(new CustomEvent('lb-auth-change', {detail:{user}}));
});
