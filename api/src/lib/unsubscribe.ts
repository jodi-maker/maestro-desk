// Stateless unsubscribe tokens for outbound customer email (CSAT etc.).
//
// A token is `base64url(customerId).hmac` where the HMAC is over
// `${workspaceId}:${customerId}` keyed with BETTER_AUTH_SECRET. No DB column is
// needed: the signature proves the link came from us, and it's bound to the
// workspace, so a token minted for one brand can't unsubscribe a customer in
// another. The verifier takes the workspace from the URL slug and re-checks the
// customer belongs to it.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

function sign(workspaceId: string, customerId: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(`${workspaceId}:${customerId}`)
    .digest('base64url');
}

export function makeUnsubscribeToken(workspaceId: string, customerId: string): string {
  const id = Buffer.from(customerId, 'utf8').toString('base64url');
  return `${id}.${sign(workspaceId, customerId)}`;
}

/**
 * Returns the customerId if the token is a valid unsubscribe token for this
 * workspace, else null. Constant-time signature comparison.
 */
export function verifyUnsubscribeToken(workspaceId: string, token: string): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  let customerId: string;
  try {
    customerId = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!customerId) return null;
  const expected = Buffer.from(sign(workspaceId, customerId));
  const got = Buffer.from(token.slice(dot + 1));
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  return customerId;
}

/**
 * Absolute one-click unsubscribe URL on the API origin (BETTER_AUTH_URL), which
 * is where the public unsubscribe endpoint lives.
 */
export function unsubscribeUrl(workspaceSlug: string, token: string): string {
  const base = env.BETTER_AUTH_URL.replace(/\/+$/, '');
  return `${base}/api/v1/public/${encodeURIComponent(workspaceSlug)}/unsubscribe?u=${encodeURIComponent(token)}`;
}
