import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { supabaseAdmin } from '../lib/supabase.ts';
import { PostmarkInbound, assertPostmarkAuth, parseTo } from '../lib/postmark.ts';
import { processInboundEmail, resolveInboundWorkspace } from '../lib/inbound-email.ts';

export const webhooks = new Hono();

// POST /api/v1/webhooks/postmark/inbound
//
// Postmark POSTs an inbound email here. We:
//   1. Validate the webhook secret (in the URL query string).
//   2. Parse the JSON payload with Zod.
//   3. Resolve the destination workspace from the To: domain — match
//      against workspace_email_domains, else fall back to the system
//      "unrouted" bucket so customer mail never silently drops.
//   4. Hand off to processInboundEmail (customer match + ticket + auto-triage).
//   5. Return 200 immediately so Postmark doesn't retry.
webhooks.post('/postmark/inbound', async (c) => {
  assertPostmarkAuth(c);

  const body = await c.req.json().catch(() => null);
  const parsed = PostmarkInbound.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: 'Invalid Postmark payload: ' + parsed.error.issues.map((i) => i.message).join('; '),
    });
  }
  const payload = parsed.data;

  try {
    const to = parseTo(payload);
    const resolution = await resolveInboundWorkspace({
      sb: supabaseAdmin,
      toDomain: to?.domain ?? null,
    });

    const result = await processInboundEmail({
      sb: supabaseAdmin,
      workspaceId: resolution.workspaceId,
      payload,
    });
    // Per-event audit row when we fell through to the unrouted bucket so
    // platform admins can find them in the god UI. Skipped for routed mail
    // (the ticket itself is the evidence; spamming audit_events for every
    // routed message would dwarf legitimate audit entries).
    if (!resolution.routed) {
      await supabaseAdmin.from('audit_events').insert({
        workspace_id: resolution.workspaceId,
        action: 'inbound.unrouted',
        target_type: 'ticket',
        target_id: result.ticket_id,
        metadata: {
          to_email: to?.email ?? null,
          to_domain: to?.domain ?? null,
          from_email: payload.FromFull?.Email ?? payload.From,
          subject: payload.Subject,
          message_id: payload.MessageID,
        },
      });
    }

    // Log lines diverge by dedup / threaded / new-ticket so the dev tail
    // can see at a glance whether a retry hit existing state. Routing info
    // is included in every variant.
    const routing = resolution.routed ? `matched ${resolution.matchedDomain}` : 'UNROUTED';
    const dest = `workspace ${resolution.workspaceId} (${routing})`;
    if (result.deduped) {
      console.log(`[postmark] inbound to ${to?.email ?? '(unknown)'} → ${dest} → DEDUPED to existing ticket ${result.ticket_display_id}`);
    } else if (result.threaded) {
      console.log(`[postmark] inbound to ${to?.email ?? '(unknown)'} → ${dest} → THREADED reply on ticket ${result.ticket_display_id}`);
    } else {
      console.log(
        `[postmark] inbound to ${to?.email ?? '(unknown)'} → ${dest} ` +
          `→ ticket ${result.ticket_display_id} (new_customer=${result.is_new_customer}, auto_triage=${result.auto_triage_queued})`,
      );
    }
    return c.json({ ...result, routed: resolution.routed }, 200);
  } catch (err) {
    console.error('[postmark] processInboundEmail failed:', err);
    // 500 (not 400) so Postmark will retry — likely a transient DB issue,
    // not a malformed payload.
    throw new HTTPException(500, {
      message: err instanceof Error ? err.message : 'Inbound processing failed',
    });
  }
});
