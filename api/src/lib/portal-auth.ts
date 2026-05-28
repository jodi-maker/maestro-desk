import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

// Token TTLs. Magic link is short so a stolen email can't be used much
// later; session is week-long so customers don't have to re-auth every
// time they want to check on a ticket.
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;       // 15 min
const SESSION_TTL_MS    = 7  * 24 * 60 * 60 * 1000;  // 7 days

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export async function createMagicLink(args: {
  sb:          SupabaseClient;
  workspaceId: string;
  customerId:  string;
}): Promise<{ token: string; expiresAt: string }> {
  const { sb, workspaceId, customerId } = args;
  const token = generateToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();
  const { error } = await sb.from('portal_magic_links').insert({
    token,
    workspace_id: workspaceId,
    customer_id:  customerId,
    expires_at:   expiresAt,
  });
  if (error) throw new Error(`magic link insert failed: ${error.message}`);
  return { token, expiresAt };
}

// Atomic exchange: confirm the magic link is unused + unexpired, mark it
// used, mint a session. Returns the session token + customer info.
export async function verifyMagicLink(args: {
  sb:          SupabaseClient;
  workspaceId: string;
  token:       string;
}): Promise<{ sessionToken: string; customerId: string } | null> {
  const { sb, workspaceId, token } = args;

  const { data: link, error: lookupErr } = await sb
    .from('portal_magic_links')
    .select('token, workspace_id, customer_id, expires_at, used_at')
    .eq('token', token)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (lookupErr) throw new Error(`magic link lookup failed: ${lookupErr.message}`);
  if (!link) return null;
  if (link.used_at) return null;
  if (new Date(link.expires_at).getTime() < Date.now()) return null;

  // Mark used. Defense against double-consume races: include the
  // is-null check in the update predicate so the second writer no-ops.
  const { data: marked, error: markErr } = await sb
    .from('portal_magic_links')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .is('used_at', null)
    .select('token')
    .maybeSingle();
  if (markErr)  throw new Error(`magic link mark-used failed: ${markErr.message}`);
  if (!marked) return null;  // someone else consumed it first

  const sessionToken = generateToken();
  const sessionExpires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error: sessErr } = await sb.from('portal_sessions').insert({
    token:        sessionToken,
    workspace_id: workspaceId,
    customer_id:  link.customer_id,
    expires_at:   sessionExpires,
  });
  if (sessErr) throw new Error(`session insert failed: ${sessErr.message}`);

  return { sessionToken, customerId: link.customer_id };
}

export async function customerForSession(args: {
  sb:          SupabaseClient;
  workspaceId: string;
  sessionToken: string;
}): Promise<{ customerId: string } | null> {
  const { sb, workspaceId, sessionToken } = args;
  const { data, error } = await sb
    .from('portal_sessions')
    .select('customer_id, expires_at')
    .eq('token', sessionToken)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw new Error(`session lookup failed: ${error.message}`);
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return { customerId: data.customer_id };
}
