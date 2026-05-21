import { z } from 'zod';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { env } from './env.ts';

// ─── Postmark inbound webhook payload ────────────────────────────────────
//
// Subset of fields we actually use. Postmark sends a much larger object
// (attachments, headers, raw email, etc.) — we accept anything via Zod's
// passthrough and only require the fields we read. See
// https://postmarkapp.com/developer/webhooks/inbound-webhook for the full
// shape if we ever need more.

export const PostmarkInbound = z
  .object({
    MessageID: z.string(),                        // Postmark's unique message id
    Date: z.string().optional(),                  // RFC 2822 timestamp string
    From: z.string().email().or(z.string()),      // "Name <addr@example.com>" or bare addr
    FromName: z.string().optional(),
    FromFull: z
      .object({
        Email: z.string(),
        Name: z.string().optional(),
      })
      .optional(),
    Subject: z.string().default(''),
    TextBody: z.string().default(''),             // plain-text body (preferred)
    HtmlBody: z.string().default(''),             // HTML fallback if TextBody is empty
    StrippedTextReply: z.string().optional(),     // text with quoted history stripped
    ToFull: z
      .array(z.object({ Email: z.string() }))
      .optional(),                                // the address it was sent to (our inbound addr)
  })
  .passthrough();

export type PostmarkInbound = z.infer<typeof PostmarkInbound>;

// ─── Authentication ──────────────────────────────────────────────────────
//
// Postmark supports HTTP Basic Auth on inbound webhooks — you embed the
// credentials in the URL: https://user:pass@host/path. Postmark sends the
// matching Authorization header. We require it because the cloudflared URL
// is otherwise publicly reachable; without auth anyone who guessed it could
// inject tickets.
//
// Production should add HMAC signature verification on top — see Postmark's
// "Webhook Signature" feature. Deferred.

export function assertPostmarkAuth(c: Context): void {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Basic ')) {
    throw new HTTPException(401, { message: 'Missing Basic auth' });
  }
  const decoded = atob(header.slice('Basic '.length));
  const [user, pass] = decoded.split(':', 2);
  if (user !== env.POSTMARK_INBOUND_USER || pass !== env.POSTMARK_INBOUND_PASS) {
    throw new HTTPException(401, { message: 'Bad Basic auth' });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Pull a clean (email, name) tuple out of Postmark's variable From shapes.
 * Prefers FromFull (structured) over FromName + From (string parsing).
 */
export function parseFrom(payload: PostmarkInbound): { email: string; name: string | null } {
  if (payload.FromFull?.Email) {
    return { email: payload.FromFull.Email.toLowerCase(), name: payload.FromFull.Name ?? null };
  }
  // From is often "Name <addr@example.com>" — pull out the bracketed part.
  const match = payload.From.match(/<([^>]+)>/);
  if (match) {
    const name = payload.From.slice(0, match.index).trim().replace(/^"|"$/g, '') || null;
    return { email: match[1].toLowerCase(), name: payload.FromName ?? name };
  }
  return { email: payload.From.trim().toLowerCase(), name: payload.FromName ?? null };
}

/**
 * Best body for the ticket message: stripped reply if present (Postmark
 * removes quoted history), else TextBody, else HTML body. HTML is left
 * as-is for v1 — proper sanitisation/conversion is a v2 concern.
 */
export function pickBody(payload: PostmarkInbound): string {
  return (
    payload.StrippedTextReply?.trim() ||
    payload.TextBody?.trim() ||
    payload.HtmlBody?.trim() ||
    '(empty body)'
  );
}
