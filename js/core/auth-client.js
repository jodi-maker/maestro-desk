// Real Supabase-backed auth for the SPA.
//
// Two callers:
//   - js/auth/platform-admin.js — platform admins (no workspace context)
//   - js/auth/agent-login.js    — agents signing into a specific workspace
//
// Both end up at /api/v1/whoami, which returns the user record plus the
// list of workspace memberships. The platform-admin path ignores
// memberships and shows the god panel; the agent path uses memberships to
// auto-pick the workspace (1 → auto) or surface a picker (2+).
//
// We don't ship the supabase-js SDK — the auth flow is a single REST call,
// so a direct fetch is enough and avoids a CDN dependency / build step.
//
// Storage:
//   sessionStorage.maestro_jwt          — handled by api-client
//   sessionStorage.maestro_workspace_id — handled by api-client
//   sessionStorage.maestro_user         — JSON of the current user (here)

import { apiGet, setJwt, setWorkspaceId, JWT_KEY } from './api-client.js';

const USER_KEY = 'maestro_user';

let _config = null;          // cached /config response

export async function loadConfig() {
  if (_config) return _config;
  _config = await apiGet('/api/v1/config', { auth: false, workspace: false });
  return _config;
}

export function getCurrentUser() {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch { return null; }
}

function setCurrentUser(user) {
  if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  else      sessionStorage.removeItem(USER_KEY);
}

/**
 * Generic email/password sign-in via Supabase Auth. Stashes the JWT, then
 * calls /api/v1/whoami to load the user + memberships. Returns the whoami
 * payload: { user, memberships }.
 *
 * Note: this does NOT pick a workspace. Callers decide what to do with the
 * memberships list (auto-pick if length 1, render a picker if more, treat
 * as god-only if empty).
 */
export async function signIn(email, password) {
  const cfg = await loadConfig();
  const res = await fetch(`${cfg.supabase_url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabase_anon_key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error_description || body.msg || `Sign-in failed (HTTP ${res.status})`);
  }
  if (!body.access_token) {
    throw new Error('Sign-in succeeded but no token returned');
  }
  setJwt(body.access_token);
  const me = await apiGet('/api/v1/whoami', { workspace: false });
  setCurrentUser(me.user);
  return me;
}

/**
 * Platform-admin sign-in — thin wrapper that returns just the user (matches
 * the existing call sites in js/auth/platform-admin.js).
 */
export async function platformAdminSignIn(email, password) {
  const { user } = await signIn(email, password);
  return user;
}

/**
 * Bootstrap helper for page reload — if a JWT is in sessionStorage, refresh
 * the user + memberships from /whoami. Returns { user, memberships } on
 * success, null if the stored token is invalid (and clears the stale state).
 */
export async function rehydrateUser() {
  if (!sessionStorage.getItem(JWT_KEY)) return null;
  try {
    const me = await apiGet('/api/v1/whoami', { workspace: false });
    setCurrentUser(me.user);
    return me;
  } catch (err) {
    if (err.status === 401) signOut();
    return null;
  }
}

export function signOut() {
  setJwt(null);
  setWorkspaceId(null);
  setCurrentUser(null);
}

export function isPlatformAdmin() {
  return Boolean(getCurrentUser()?.is_platform_admin);
}
