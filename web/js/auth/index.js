// ─── Auth panel ──────────────────────────────────────────────────────────────
// Pre-login screen — three swappable panels (login / forgot password /
// create account) plus the SSO buttons and password-strength meter.
// All handlers transition into the app by calling window.login(...),
// which lives in app.js and owns the app-shell setup (sidebar avatar,
// SLA refresh, snooze polling, dashboard render).
//
// External reaches (interim, via window): login — still in app.js (app-local
// bootstrap; ssoLogin/submitLogin call window.login).
//
// The auth screen DOM lives in static index.html; its inline handlers are
// delegated as auth.* actions (registered below). showAuthPanel stays
// exported (agent-login + platform-admin import it); the rest are
// module-internal. The login-password Enter-to-submit keydown is wired
// programmatically at the bottom (sparse event on a static element).

import { registerActions, registerInputActions } from '../core/event-delegation.js';
import { resetPassword } from '../core/auth-client.js';

export function showAuthPanel(panel) {
  ['login','forgot','create','platform-admin','agent','set-password'].forEach(p => {
    const el = document.getElementById('auth-'+p);
    if (el) el.style.display = p === panel ? 'block' : 'none';
  });
  // Clear stale error/confirmation messages
  ['login-error','create-error','create-confirm','forgot-confirm','pa-error','ag-error','sp-error','sp-confirm'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
}

// Set-password landing — entered from the emailed reset/invite link. app.js
// calls beginSetPassword(token) on startup when the URL carries ?reset_token.
let _resetToken = null;
export function beginSetPassword(token) {
  _resetToken = token;
  showAuthPanel('set-password');
}

function isValidEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

function togglePassword(id) {
  const el = document.getElementById(id); if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

function ssoLogin(provider) {
  const presets = {
    google:    { name: 'Sofia Reyes',  initials: 'SR', role: 'Senior Agent' },
    microsoft: { name: 'James Webb',   initials: 'JW', role: 'Senior Agent' },
    saml:      { name: 'Emma Clarke',  initials: 'EC', role: 'Admin' },
  };
  const p = presets[provider] || presets.saml;
  window.login(p.role, p.name, p.initials);
}

function deriveNameFromEmail(email) {
  const local = email.split('@')[0];
  const parts = local.split(/[._-]/).filter(Boolean);
  const cap = w => w ? w[0].toUpperCase() + w.slice(1) : '';
  const first = cap(parts[0]) || 'User';
  const last  = cap(parts[1]) || '';
  return { name: (first + ' ' + last).trim(), initials: ((first[0]||'') + (last[0]||'')).toUpperCase() || first[0] };
}

function submitLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  if (!email || !pw) { errEl.textContent = 'Please enter your email and password.'; errEl.style.display = 'block'; return; }
  if (!isValidEmail(email)) { errEl.textContent = 'Please enter a valid email.'; errEl.style.display = 'block'; return; }
  if (pw.length < 6) { errEl.textContent = 'Invalid email or password.'; errEl.style.display = 'block'; return; }
  const { name, initials } = deriveNameFromEmail(email);
  window.login('Senior Agent', name, initials);
}

function submitForgot() {
  const email = document.getElementById('forgot-email')?.value.trim() || '';
  const c = document.getElementById('forgot-confirm');
  if (!isValidEmail(email)) {
    if (c) { c.textContent = 'Please enter a valid email address.'; c.style.color = 'var(--red)'; c.style.display = 'block'; }
    return;
  }
  if (c) { c.textContent = 'Reset link sent — check your inbox.'; c.style.color = 'var(--green)'; c.style.display = 'block'; }
}

function pwScore(pw) {
  let s = 0;
  if (!pw) return 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

function updatePwStrength(pw) {
  const wrap = document.getElementById('pw-strength-wrap');
  const bar  = document.getElementById('pw-strength-bar');
  const text = document.getElementById('pw-strength-text');
  if (!wrap || !bar || !text) return;
  if (!pw) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const score = pwScore(pw);
  const labels = ['Very weak','Weak','Fair','Good','Strong','Very strong'];
  const colors = ['var(--red)','var(--red)','var(--amber)','var(--amber)','var(--green)','var(--green)'];
  bar.style.width = (score / 5) * 100 + '%';
  bar.style.background = colors[score];
  text.textContent = labels[score];
  text.style.color = colors[score];
}

function submitCreate() {
  const first = document.getElementById('ca-first').value.trim();
  const last  = document.getElementById('ca-last').value.trim();
  const email = document.getElementById('ca-email').value.trim();
  const pw    = document.getElementById('ca-password').value;
  const terms = document.getElementById('ca-terms').checked;
  const errEl = document.getElementById('create-error');
  const okEl  = document.getElementById('create-confirm');
  errEl.style.display = 'none';
  okEl.style.display = 'none';
  if (!first || !last)         { errEl.textContent = 'Please enter your first and last name.'; errEl.style.display = 'block'; return; }
  if (!isValidEmail(email))    { errEl.textContent = 'Please enter a valid work email.';      errEl.style.display = 'block'; return; }
  if (pwScore(pw) < 3)         { errEl.textContent = 'Password is too weak — aim for "Good" or higher.'; errEl.style.display = 'block'; return; }
  if (!terms)                  { errEl.textContent = 'Please accept the terms.';              errEl.style.display = 'block'; return; }
  okEl.style.display = 'block';
}

async function submitSetPassword() {
  const pw    = document.getElementById('sp-password')?.value || '';
  const errEl = document.getElementById('sp-error');
  const okEl  = document.getElementById('sp-confirm');
  const btn   = document.getElementById('sp-submit');
  if (errEl) errEl.style.display = 'none';
  if (okEl)  okEl.style.display = 'none';
  if (pwScore(pw) < 3) {
    if (errEl) { errEl.textContent = 'Password is too weak — aim for "Good" or higher.'; errEl.style.display = 'block'; }
    return;
  }
  if (!_resetToken) {
    if (errEl) { errEl.textContent = 'Missing or expired reset link — request a new one.'; errEl.style.display = 'block'; }
    return;
  }
  if (btn) btn.disabled = true;
  try {
    await resetPassword(_resetToken, pw);
    _resetToken = null;
    if (okEl) okEl.style.display = 'block';
    // Send them to the sign-in panel after a beat to enter the new password.
    setTimeout(() => showAuthPanel('agent'), 1500);
  } catch (err) {
    if (errEl) { errEl.textContent = err?.message || 'Could not set password.'; errEl.style.display = 'block'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

registerActions({
  'auth.ssoLogin':         (ds) => ssoLogin(ds.provider),
  'auth.togglePw':         (ds) => togglePassword(ds.target),
  'auth.showPanel':        (ds) => showAuthPanel(ds.panel),
  'auth.submitLogin':      () => submitLogin(),
  'auth.submitForgot':     () => submitForgot(),
  'auth.submitCreate':     () => submitCreate(),
  'auth.submitSetPassword': () => submitSetPassword(),
});

registerInputActions({
  'auth.pwStrength': (ds, el) => updatePwStrength(el.value),
});

// Enter-to-submit on the (static) login password field. Sparse keydown event
// on a single always-present element → wired directly, not via the harness.
document.getElementById('login-password')
  ?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLogin(); });
