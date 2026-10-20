// ─────────────────────────────────────────────────────────────────────────────
//  auth-bridge.js  v11.1 — Fixed logout / re-login cycle
//  Fixes: same-user re-login guard, app-wrap state, welcome screen on re-login
// ─────────────────────────────────────────────────────────────────────────────

let _uid            = null;
let _lastUserId     = null;
let _isProcessing   = false;
let _isLoggedOut    = true;   // Track explicit logout so re-login always runs fully
let _pinUnlockResume = false;

const PIN_ENABLED_KEY       = 'lb_pin_enabled';
const PIN_HASH_KEY          = 'lb_pin_hash';
const PIN_SALT_KEY          = 'lb_pin_salt';
const AUTH_SESSION_UID_KEY  = 'lb_auth_session_uid';
const AUTH_LOGIN_START_KEY  = 'lb_auth_login_started';
const PIN_UNLOCKED_UID_KEY  = 'lb_pin_unlocked_uid';

function _pinEnabled() {
  return localStorage.getItem(PIN_ENABLED_KEY) === '1' &&
         !!localStorage.getItem(PIN_HASH_KEY) &&
         !!localStorage.getItem(PIN_SALT_KEY);
}
function _setPinSettingsMsg(msg, ok = true) {
  const el = document.getElementById('pinSettingsMsg');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
}
function _randHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}
async function _sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function _hashPin(pin, salt) {
  return _sha256Hex(salt + ':' + pin);
}
function _hidePinGate() {
  const el = document.getElementById('pinOverlay');
  if (el) el.style.display = 'none';
  const input = document.getElementById('pinInput');
  if (input) input.value = '';
  const err = document.getElementById('pinError');
  if (err) err.style.display = 'none';
}
function _showPinGate(user) {
  const login = document.getElementById('loginOverlay');
  if (login) login.style.display = 'none';
  const ws = document.getElementById('welcomeScreen');
  if (ws) ws.classList.remove('open');
  _lockApp();
  const name = document.getElementById('pinUserName');
  if (name) name.textContent = user?.displayName || user?.email || 'Signed-in user';
  const el = document.getElementById('pinOverlay');
  if (el) el.style.display = 'flex';
  setTimeout(() => document.getElementById('pinInput')?.focus(), 40);
}
function _refreshPinSettingsUI() {
  const enabled = _pinEnabled();
  const chk = document.getElementById('pinEnableChk');
  const fields = document.getElementById('pinSetupFields');
  const disableBtn = document.getElementById('pinDisableBtn');
  const changeBtn = document.getElementById('pinChangeBtn');
  const saveBtn = document.getElementById('pinSaveBtn');
  const status = document.getElementById('pinCurrentStatus');
  const visual = document.getElementById('pinSettingsVisual');
  const visualStatus = document.getElementById('pinVisualStatus');
  const newPin = document.getElementById('pinNew');
  const confirm = document.getElementById('pinConfirm');
  if (chk) chk.checked = enabled;
  if (fields) fields.style.display = enabled ? 'none' : 'grid';
  if (disableBtn) disableBtn.style.display = enabled ? '' : 'none';
  if (changeBtn) changeBtn.style.display = enabled ? '' : 'none';
  if (saveBtn) {
    saveBtn.style.display = enabled ? 'none' : '';
    saveBtn.textContent = enabled ? 'Save New PIN' : 'Set PIN';
  }
  if (status) status.textContent = enabled
    ? 'PIN unlock is ON. This device will stay signed in and ask for PIN on relaunch.'
    : 'PIN unlock is OFF. Relaunching the app will require Google sign-in again.';
  if (visual) visual.classList.toggle('is-on', enabled);
  if (visualStatus) visualStatus.textContent = enabled ? 'ON' : 'OFF';
  if (newPin) newPin.value = '';
  if (confirm) confirm.value = '';
  _setPinSettingsMsg('');
}
async function _setPersistenceForPinMode() {
  if (window.FB && window.FB.setPersistenceMode) {
    await window.FB.setPersistenceMode(_pinEnabled() ? 'local' : 'session');
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function _showLogin() {
  _hidePinGate();
  const el = document.getElementById('loginOverlay');
  if (el) el.style.display = 'flex';
  const ws = document.getElementById('welcomeScreen');
  if (ws) ws.classList.remove('open');
  _lockApp();
}
function _hideLogin() {
  _hidePinGate();
  const el = document.getElementById('loginOverlay');
  if (el) el.style.display = 'none';
  const btn = document.getElementById('googleSignInBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 001.83 5.4L4.5 7.49a4.77 4.77 0 014.48-3.31z"/></svg> Sign in with Google';
  }
}
function _lockApp() {
  const aw = document.getElementById('appWrap');
  if (aw) { aw.style.pointerEvents = 'none'; aw.style.opacity = '0.3'; aw.style.userSelect = 'none'; }
}
function _unlockApp() {
  const aw = document.getElementById('appWrap');
  if (aw) { aw.style.pointerEvents = ''; aw.style.opacity = ''; aw.style.userSelect = ''; }
  const overlay = document.getElementById('premiumOverlay');
  if (overlay) { overlay.classList.remove('open'); overlay.classList.remove('expired-wall'); overlay.style.zIndex = ''; }
  const closeBtn = document.getElementById('premCloseBtn');
  if (closeBtn) closeBtn.style.display = '';
}
function _escapeHTML(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}
function _setUserChip(user) {
  const chip = document.getElementById('userChip');
  if (!chip) return;
  if (user) {
    const name = _escapeHTML(user.displayName || user.email || 'User');
    const photo = user.photoURL
      ? '<img class="user-chip-avatar" src="' + _escapeHTML(user.photoURL) + '" alt="">'
      : '<span style="font-size:13px;">👤</span>';
    chip.innerHTML = photo + '<span class="user-chip-name">' + name + '</span>';
    chip.title = 'Signed in as ' + user.email + '\nClick for profile';
    chip.onclick = toggleProfilePopup;
    chip.style.cursor = 'pointer';
  } else {
    chip.innerHTML = '<span class="user-chip-signin">Sign in</span>';
    chip.title = 'Click for profile';
    chip.onclick = toggleProfilePopup;
    chip.style.cursor = 'pointer';
    const badge = chip.querySelector('.prem-badge');
    if (badge) badge.remove();
  }
}
function _setUserChipPolished(user) {
  const chip = document.getElementById('userChip');
  if (!chip) return;
  chip.onclick = toggleProfilePopup;
  chip.style.cursor = 'pointer';

  if (user) {
    const name = _escapeHTML(user.displayName || user.email || 'User');
    const photo = user.photoURL
      ? '<img class="user-chip-avatar" src="' + _escapeHTML(user.photoURL) + '" alt="">'
      : '<span class="user-chip-avatar">&#128100;</span>';
    chip.innerHTML = photo + '<span class="user-chip-name">' + name + '</span>';
    chip.title = 'Signed in as ' + (user.email || name) + '\nClick for profile';
    return;
  }

  chip.innerHTML = '<span class="user-chip-signin">Sign in</span>';
  chip.title = 'Click for profile';
}
_setUserChip = _setUserChipPolished;
function _resetAppState() {
  if (typeof window.LB_setRegistry === 'function') window.LB_setRegistry([]);
  else if (window.billsRegistry) window.billsRegistry = [];
  if (typeof renderFileSystem === 'function') renderFileSystem();
  if (typeof updateDashboard   === 'function') updateDashboard();
}

// ── Wait for window.FB ───────────────────────────────────────────────────────
function waitForFB() {
  return new Promise(resolve => {
    if (window.FB) return resolve();
    const t = setInterval(() => { if (window.FB) { clearInterval(t); resolve(); } }, 30);
  });
}

function clearUserLocalData() {
  localStorage.removeItem('lb_contacts');
  localStorage.removeItem('lb_hidden_customers');
  localStorage.removeItem('lb_wa_phone');
}

// ── Main auth handler ─────────────────────────────────────────────────────────
async function onAuthChange(user) {
  if (_isProcessing) return;
  _isProcessing = true;

  try {
    if (user) {
      const loginStarted = sessionStorage.getItem(AUTH_LOGIN_START_KEY) === '1';
      const sessionUid   = sessionStorage.getItem(AUTH_SESSION_UID_KEY);
      const pinUnlocked  = sessionStorage.getItem(PIN_UNLOCKED_UID_KEY) === user.uid;

      if (!_pinEnabled() && !loginStarted && sessionUid !== user.uid) {
        _uid = null;
        _isLoggedOut = true;
        _showLogin();
        _setUserChip(null);
        _resetAppState();
        try { await window.FB.signOut(); } catch(e) {}
        return;
      }

      if (_pinEnabled() && !loginStarted && sessionUid !== user.uid && !pinUnlocked) {
        _showPinGate(user);
        _setUserChip(user);
        return;
      }

      if (loginStarted) {
        sessionStorage.setItem(AUTH_SESSION_UID_KEY, user.uid);
        sessionStorage.removeItem(AUTH_LOGIN_START_KEY);
        if (_pinEnabled()) sessionStorage.setItem(PIN_UNLOCKED_UID_KEY, user.uid);
      }

      const cameFromPin = _pinUnlockResume;
      _pinUnlockResume = false;

      // Detect if this is a fresh login (after logout, or different account)
      const isFreshLogin = !cameFromPin && (_isLoggedOut || (_lastUserId !== null && _lastUserId !== user.uid));
      const isSameSessionUser = (_lastUserId === user.uid && !_isLoggedOut);

      const previousUserId = _lastUserId;
      const isDifferentAccount = previousUserId && previousUserId !== user.uid;

      _uid         = user.uid;
      _lastUserId  = user.uid;
      _isLoggedOut = false;

      if (isDifferentAccount) {
        clearUserLocalData();
      }

      _hideLogin();
      _setUserChip(user);

      // Same user, app already running — just update chip, skip full re-init
      if (isSameSessionUser) {
        _isProcessing = false;
        return;
      }

      if (window.electronAPI && typeof window.electronAPI.setUserId === 'function') {
        await window.electronAPI.setUserId(_uid);
      }

      await waitForFB();

      // ── 1. Premium / Trial check ──────────────────────────────────────────
      let configTrialDays = 7;
      try {
        const cfg = await window.electronAPI.getConfig();
        if (cfg && cfg.trialDays) configTrialDays = Number(cfg.trialDays) || 7;
      } catch(e) {}
      const TRIAL_DAYS = configTrialDays;
      let premiumStatus = 'trial';
      let trialDaysLeft = TRIAL_DAYS;
      try {
        const userDoc = await window.FB.getUserDoc(_uid);
        if (!userDoc) {
          await window.FB.initUserDoc(_uid);
        } else {
          const now = Date.now();
          if (userDoc.premium) {
            if (userDoc.premiumExpiry) {
              const expMs = userDoc.premiumExpiry.seconds
                ? userDoc.premiumExpiry.seconds * 1000
                : new Date(userDoc.premiumExpiry).getTime();
              premiumStatus = expMs > now ? 'active' : 'expired';
            } else {
              premiumStatus = 'active';
            }
          } else if (userDoc.trialStart) {
            const startMs = userDoc.trialStart.seconds
              ? userDoc.trialStart.seconds * 1000
              : new Date(userDoc.trialStart).getTime();
            const daysLeft = Math.ceil(TRIAL_DAYS - (now - startMs) / 86400000);
            premiumStatus  = daysLeft > 0 ? 'trial' : 'expired';
            trialDaysLeft  = Math.max(0, daysLeft);
          } else {
            await window.FB.initUserDoc(_uid);
          }
        }
      } catch(e) {
        console.error('[LB] premium check failed:', e);
        premiumStatus = 'trial';
      }

      // ── 2. Welcome screen — always show on fresh login ────────────────────
      // Clear the session key on fresh login so welcome always appears
      const wsKey = 'lb_ws_shown_' + _uid;
      if (isFreshLogin) sessionStorage.removeItem(wsKey);

      const wsAlreadySeen = sessionStorage.getItem(wsKey);
      if (!wsAlreadySeen) {
        sessionStorage.setItem(wsKey, String(Date.now()));
        _lockApp();
        if (typeof showWelcomeScreen === 'function') {
          showWelcomeScreen(user, premiumStatus, trialDaysLeft);
        }
      } else {
        if (premiumStatus !== 'expired') _unlockApp();
      }

      // ── 3. Notify premium status ──────────────────────────────────────────
      if (typeof window.LB_onPremiumReady === 'function') {
        window.LB_onPremiumReady(premiumStatus, trialDaysLeft);
      }

      const isPremium = premiumStatus === 'active' || premiumStatus === 'trial';
      if (!isPremium) {
        if (typeof toast === 'function') toast('⚠️ Trial expired — upgrade required');
        _isProcessing = false;
        return;
      }

      // ── 4. Settings sync ──────────────────────────────────────────────────
      try {
        const cloudSettings = await window.FB.loadSettingsCloud(_uid);
        if (cloudSettings) {
          const local  = await window.electronAPI.getSettings();
          const merged = { ...local, ...cloudSettings };
          await window.electronAPI.saveSettings(merged);
          if (typeof applyAppSettings === 'function') applyAppSettings(merged);
          if (typeof refreshBusinessIdentity === 'function') refreshBusinessIdentity();
          const sp = document.getElementById('settingSavePath'); if (sp && merged.savePath)   sp.value = merged.savePath;
          const sy = document.getElementById('settingSyncPath'); if (sy && merged.syncPath)   sy.value = merged.syncPath;
          const bn = document.getElementById('bizName');         if (bn && merged.bizName)    bn.value = merged.bizName;
          const bt = document.getElementById('bizTagline');      if (bt && merged.bizTagline) bt.value = merged.bizTagline;
          if (typeof toast === 'function') toast('☁️ Settings synced');
        }
      } catch(e) { console.error('[LB] settings sync:', e); }

      // ── 5. Contacts sync ──────────────────────────────────────────────────
      try {
        const cloudContacts = await window.FB.loadAllContactsMapCloud(_uid);
        if (cloudContacts && Object.keys(cloudContacts).length) {
          const local  = JSON.parse(localStorage.getItem('lb_contacts') || '{}');
          localStorage.setItem('lb_contacts', JSON.stringify({ ...local, ...cloudContacts }));
        } else {
          const cc = await window.FB.loadContactsCloud(_uid);
          if (cc && Object.keys(cc).length) {
            const local  = JSON.parse(localStorage.getItem('lb_contacts') || '{}');
            const merged = { ...local, ...cc };
            localStorage.setItem('lb_contacts', JSON.stringify(merged));
            await window.FB.saveAllContactsCloud(_uid, merged);
          }
        }
      } catch(e) { console.error('[LB] contacts sync:', e); }

      // ── 6. Bills sync ─────────────────────────────────────────────────────
      try {
        if (typeof toast === 'function') toast('☁️ Loading bills…');
        const cloudBills = await window.FB.loadAllBillsCloud(_uid);
        if (cloudBills.length) {
          const existing  = Array.isArray(window.billsRegistry) ? [...window.billsRegistry] : [];
          const mergedMap = {};
          existing.forEach(b  => { const k = b.id || b._filePath; if (k) mergedMap[k] = b; });
          cloudBills.forEach(b => {
            const k  = b.id || ('__c' + Math.random());
            const lc = mergedMap[k];
            mergedMap[k] = lc ? { ...b, _filePath: lc._filePath || '' } : b;
          });
          const merged = Object.values(mergedMap);
          if (typeof window.LB_setRegistry === 'function') window.LB_setRegistry(merged);
          else {
            window.billsRegistry = merged;
            if (typeof renderFileSystem === 'function') renderFileSystem();
            if (typeof updateDashboard  === 'function') updateDashboard();
          }
          if (typeof toast === 'function') toast('☁️ ' + cloudBills.length + ' bills loaded');
        } else {
          if (typeof toast === 'function') toast('☁️ Signed in — no cloud bills yet');
        }
      } catch(e) { console.error('[LB] bills sync:', e); }

    } else {
      // ── SIGNED OUT ────────────────────────────────────────────────────────
      _uid         = null;
      _isLoggedOut = true;
      sessionStorage.removeItem(AUTH_SESSION_UID_KEY);
      sessionStorage.removeItem(AUTH_LOGIN_START_KEY);
      sessionStorage.removeItem(PIN_UNLOCKED_UID_KEY);
      clearUserLocalData();
      if (window.electronAPI && typeof window.electronAPI.setUserId === 'function') {
        await window.electronAPI.setUserId(null);
      }
      // Keep _lastUserId so we can detect same-user re-login

      _showLogin();
      _setUserChip(null);
      _resetAppState();

      // Remove any expired wall overlays
      const overlay = document.getElementById('premiumOverlay');
      if (overlay) { overlay.classList.remove('open'); overlay.classList.remove('expired-wall'); }
    }
  } catch(e) {
    console.error('[LB] onAuthChange error:', e);
  } finally {
    _isProcessing = false;
  }
}

// ── Listen to lb-auth-change (fired by firebase.js) ──────────────────────────
window.addEventListener('lb-auth-change', (e) => {
  onAuthChange(e.detail && e.detail.user ? e.detail.user : null);
});

// ── Fallback direct registration ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const t = setInterval(() => {
    if (window.FB && window.FB.onAuthStateChanged) {
      clearInterval(t);
      window.FB.onAuthStateChanged(user => onAuthChange(user));
    }
  }, 50);
});

// ── Public API ────────────────────────────────────────────────────────────────
window.LB_AUTH = {
  getUid:    () => _uid,
  isOffline: () => false,

  signIn: async () => {
    const errEl = document.getElementById('loginError');
    const btn   = document.getElementById('googleSignInBtn');
    if (btn) { btn.textContent = 'Signing in…'; btn.disabled = true; }
    if (errEl) errEl.style.display = 'none';
    if (!window.FB) {
      if (errEl) { errEl.textContent = 'Firebase not loaded.'; errEl.style.display = 'block'; }
      if (btn) { btn.textContent = '↩ Retry'; btn.disabled = false; }
      return;
    }
    await _setPersistenceForPinMode();
    sessionStorage.setItem(AUTH_LOGIN_START_KEY, '1');
    const result = await window.FB.signInWithGoogle();
    if (!result?.success) {
      sessionStorage.removeItem(AUTH_LOGIN_START_KEY);
      if (errEl) { errEl.textContent = result?.error || 'Sign-in failed'; errEl.style.display = 'block'; }
      if (btn) { btn.textContent = '↩ Try Again'; btn.disabled = false; }
    }
    // On success: Firebase fires onAuthStateChanged → onAuthChange(user)
  },

  signOut: async () => {
    if (!window.FB) return;
    if (!confirm('Sign out of Captain Billing?')) return;
    // Clear session key so welcome screen shows on next login (even same account)
    if (_uid) sessionStorage.removeItem('lb_ws_shown_' + _uid);
    sessionStorage.removeItem(AUTH_SESSION_UID_KEY);
    sessionStorage.removeItem(AUTH_LOGIN_START_KEY);
    sessionStorage.removeItem(PIN_UNLOCKED_UID_KEY);
    _isLoggedOut = true;  // Mark before Firebase fires the event
    await window.FB.signOut();
    // Firebase fires onAuthStateChanged(null) → onAuthChange(null)
  },

  syncBillToCloud: async (billData) => {
    if (!_uid || !window.FB) return;
    try { await window.FB.saveBillCloud(_uid, billData); } catch(e) { console.error('[LB] syncBill:', e); }
  },
  deleteBillFromCloud: async (billId) => {
    if (!_uid || !window.FB || !billId) return;
    try { await window.FB.deleteBillCloud(_uid, billId); } catch(e) { console.error('[LB] deleteBill:', e); }
  },
  syncContactToCloud: async (name, phone) => {
    if (!_uid || !window.FB) return;
    try {
      await window.FB.saveContactCloud(_uid, name, phone);
      const all = JSON.parse(localStorage.getItem('lb_contacts') || '{}');
      await window.FB.saveAllContactsCloud(_uid, all);
    } catch(e) { console.error('[LB] syncContact:', e); }
  },
  syncSettingsToCloud: async (settingsData) => {
    if (!_uid || !window.FB) return;
    try { await window.FB.saveSettingsCloud(_uid, settingsData); } catch(e) { console.error('[LB] syncSettings:', e); }
  },
  syncAllContactsToCloud: async () => {
    if (!_uid || !window.FB) return;
    try {
      const all = JSON.parse(localStorage.getItem('lb_contacts') || '{}');
      await window.FB.saveAllContactsCloud(_uid, all);
    } catch(e) { console.error('[LB] syncAllContacts:', e); }
  },
};

window.LB_PIN = {
  isEnabled: _pinEnabled,
  refreshSettingsUI: _refreshPinSettingsUI,

  saveFromSettings: async () => {
    const pin = (document.getElementById('pinNew')?.value || '').trim();
    const confirmPin = (document.getElementById('pinConfirm')?.value || '').trim();
    if (!/^\d{4,8}$/.test(pin)) {
      _setPinSettingsMsg('PIN must be 4 to 8 digits.', false);
      document.getElementById('pinNew')?.focus();
      return;
    }
    if (pin !== confirmPin) {
      _setPinSettingsMsg('PIN and confirm PIN do not match.', false);
      document.getElementById('pinConfirm')?.focus();
      return;
    }
    const salt = _randHex(16);
    const hash = await _hashPin(pin, salt);
    localStorage.setItem(PIN_SALT_KEY, salt);
    localStorage.setItem(PIN_HASH_KEY, hash);
    localStorage.setItem(PIN_ENABLED_KEY, '1');
    if (_uid) {
      sessionStorage.setItem(AUTH_SESSION_UID_KEY, _uid);
      sessionStorage.setItem(PIN_UNLOCKED_UID_KEY, _uid);
    }
    await _setPersistenceForPinMode();
    _refreshPinSettingsUI();
    _setPinSettingsMsg('PIN unlock enabled. Next relaunch will ask for this PIN.');
    if (typeof toast === 'function') toast('PIN unlock enabled');
  },

  disableFromSettings: async () => {
    if (!confirm('Disable PIN unlock? Next relaunch will require Google sign-in.')) return;
    localStorage.removeItem(PIN_ENABLED_KEY);
    localStorage.removeItem(PIN_HASH_KEY);
    localStorage.removeItem(PIN_SALT_KEY);
    sessionStorage.removeItem(PIN_UNLOCKED_UID_KEY);
    await _setPersistenceForPinMode();
    _refreshPinSettingsUI();
    _setPinSettingsMsg('PIN unlock disabled. Close and reopen will require Google sign-in.');
    if (typeof toast === 'function') toast('PIN unlock disabled');
  },

  verifyGate: async () => {
    const input = document.getElementById('pinInput');
    const err = document.getElementById('pinError');
    const pin = (input?.value || '').trim();
    const salt = localStorage.getItem(PIN_SALT_KEY);
    const savedHash = localStorage.getItem(PIN_HASH_KEY);
    if (!pin || !salt || !savedHash) {
      if (err) { err.textContent = 'PIN is not configured. Please sign in again.'; err.style.display = 'block'; }
      return;
    }
    const hash = await _hashPin(pin, salt);
    if (hash !== savedHash) {
      if (err) { err.textContent = 'Wrong PIN. Try again.'; err.style.display = 'block'; }
      if (input) { input.value = ''; input.focus(); }
      return;
    }
    const user = window.FB && window.FB.currentUser ? window.FB.currentUser() : null;
    if (!user) {
      if (err) { err.textContent = 'Session expired. Please sign in again.'; err.style.display = 'block'; }
      return;
    }
    sessionStorage.setItem(AUTH_SESSION_UID_KEY, user.uid);
    sessionStorage.setItem(PIN_UNLOCKED_UID_KEY, user.uid);
    _pinUnlockResume = true;
    _hidePinGate();
    onAuthChange(user);
  },

  signOutFromGate: async () => {
    sessionStorage.removeItem(AUTH_SESSION_UID_KEY);
    sessionStorage.removeItem(AUTH_LOGIN_START_KEY);
    sessionStorage.removeItem(PIN_UNLOCKED_UID_KEY);
    _isLoggedOut = true;
    _hidePinGate();
    if (window.FB) await window.FB.signOut();
    _showLogin();
  },
};
