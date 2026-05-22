import type { SupabaseClient } from '@supabase/supabase-js';
import { extractMessageId, parseFrom, pickBody, type PostmarkInbound } from './postmark.ts';
import { triageTicket } from './triage.ts';
import { BudgetExceededError } from './budget.ts';

// ─── Display ID generation ───────────────────────────────────────────────
//
// Placeholder — random 6-digit numbers. Same approach as POST /tickets.
// Replace with a per-workspace sequence (or trigger) before this is
// exposed to real users.

function nextTicketDisplayId(): string {
  return `TK-${Math.floor(Math.random() * 900000 + 100000)}`;
}

function nextCustomerDisplayId(): string {
  return `M${String(Math.floor(Math.random() * 9000 + 1000))}`;
}

// ─── Entry point ─────────────────────────────────────────────────────────

export interface InboundResult {
  ticket_id: string;
  ticket_display_id: string;
  customer_id: string;
  is_new_customer: boolean;
  auto_triage_queued: boolean;
  // true when this payload's RFC Message-ID matched an existing
  // customer message — Postmark retry, no new ticket created.
  deduped: boolean;
}

/**
 * Convert an inbound email into a ticket. Steps:
 *   0. Dedup check: if a customer message with this RFC Message-ID already
 *      exists for the workspace, return its ticket without creating anything.
 *   1. Match the sender against customers by email; create a stub if missing.
 *   2. Create a ticket with status=open, priority=normal (triage may change these).
 *   3. Create the first ticket_messages row from the email body.
 *   4. Fire-and-forget auto-triage. The webhook returns immediately so Postmark
 *      doesn't retry — triage runs in the background and updates the ticket
 *      when done.
 *
 * Called by the Postmark webhook handler. Assumes the request has already
 * been authenticated (via Basic Auth in the webhook URL).
 */
export async function processInboundEmail(args: {
  sb: SupabaseClient;
  workspaceId: string;
  payload: PostmarkInbound;
}): Promise<InboundResult> {
  const { sb, workspaceId, payload } = args;
  const { email, name } = parseFrom(payload);
  const body = pickBody(payload);
  const subject = payload.Subject?.trim() || '(no subject)';
  const externalMessageId = extractMessageId(payload);

  // 0. Dedup check — Postmark retries deliver the same payload multiple
  //    times. Match by RFC Message-ID; if we already wrote a customer message
  //    with this ID, return the existing ticket instead of creating a
  //    duplicate. Skipped when Message-ID is missing (some senders omit it)
  //    — those payloads can't be deduped and will produce a duplicate ticket
  //    on retry. The partial unique index in 20260522130000 is defense-in-
  //    depth against the concurrent-retry race; the application check below
  //    avoids creating orphan tickets on the way to a 23505.
  if (externalMessageId) {
    const { data: dup, error: dErr } = await sb
      .from('ticket_messages')
      .select('ticket_id, tickets!inner(display_id, customer_id)')
      .eq('workspace_id', workspaceId)
      .eq('role', 'customer')
      .eq('external_message_id', externalMessageId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (dErr) throw new Error(`Inbound dedup lookup failed: ${dErr.message}`);
    if (dup) {
      const t = (Array.isArray(dup.tickets) ? dup.tickets[0] : dup.tickets) as
        | { display_id: string; customer_id: string }
        | null;
      return {
        ticket_id: dup.ticket_id,
        ticket_display_id: t?.display_id ?? '',
        customer_id: t?.customer_id ?? '',
        is_new_customer: false,
        auto_triage_queued: false,
        deduped: true,
      };
    }
  }

  // 1. Match-or-create the customer.
  let customerId: string;
  let isNewCustomer = false;
  const { data: existingCustomer, error: cErr } = await sb
    .from('customers')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('email', email)
    .is('deleted_at', null)
    .maybeSingle();
  if (cErr) throw new Error(`Customer lookup failed: ${cErr.message}`);

  if (existingCustomer) {
    customerId = existingCustomer.id;
  } else {
    // Stub customer — name parsed from From header if present, no other PII.
    // Agents can fill in mobile/brand/VIP-tier later via the UI.
    //
    // Race window: two webhook retries for the same NEW sender both miss the
    // lookup above and try to insert. The (workspace_id, email) unique
    // constraint guarantees one wins; the loser hits PG 23505. On that
    // specific error, re-query for the row the winner just created and use
    // that customer_id instead of failing the whole webhook (Postmark would
    // otherwise retry up to 10 times). Any other DB error still bubbles.
    const [firstName, ...rest] = (name ?? email.split('@')[0]).split(/\s+/);
    const lastName = rest.join(' ') || null;
    const insert = await sb
      .from('customers')
      .insert({
        workspace_id: workspaceId,
        display_id: nextCustomerDisplayId(),
        first_name: firstName,
        last_name: lastName,
        email,
      })
      .select('id')
      .single();
    if (insert.error) {
      if (insert.error.code === '23505') {
        const winner = await sb
          .from('customers')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('email', email)
          .is('deleted_at', null)
          .maybeSingle();
        if (winner.error || !winner.data) {
          throw new Error(
            `Customer race recovery failed: ${winner.error?.message ?? 'row not visible after unique violation'}`,
          );
        }
        customerId = winner.data.id;
        // isNewCustomer stays false — the other request created it.
      } else {
        throw new Error(`Customer create failed: ${insert.error.message}`);
      }
    } else {
      customerId = insert.data.id;
      isNewCustomer = true;
    }
  }

  // 2. Create the ticket. Status/priority/category are best-guess defaults;
  //    auto-triage may overwrite them.
  const { data: newTicket, error: tErr } = await sb
    .from('tickets')
    .insert({
      workspace_id: workspaceId,
      display_id: nextTicketDisplayId(),
      subject,
      customer_id: customerId,
      status_key: 'open',
      priority_key: 'normal',
      sla_state: 'ok',
    })
    .select('id, display_id')
    .single();
  if (tErr) throw new Error(`Ticket create failed: ${tErr.message}`);

  // 3. First message from the email body. The RFC Message-ID extracted at
  //    the top is stored so we can thread our reply via In-Reply-To when
  //    auto-reply fires.
  const authorLabel = name?.trim() || email;
  const { error: mErr } = await sb.from('ticket_messages').insert({
    workspace_id: workspaceId,
    ticket_id: newTicket.id,
    role: 'customer',
    author_label: authorLabel,
    body,
    external_message_id: externalMessageId,
  });
  if (mErr) throw new Error(`Message create failed: ${mErr.message}`);

  // 4. Fire-and-forget auto-triage. We swallow errors here — they're already
  //    logged in ai_usage_log + console — because the webhook MUST return
  //    fast or Postmark will retry. The agent can manually re-trigger
  //    triage via POST /api/v1/tickets/:id/triage if the auto attempt failed.
  let autoTriageQueued = false;
  try {
    // We deliberately don't await this. If the workspace is out of budget
    // (BudgetExceededError), we just log and move on — the ticket still
    // gets created.
    void triageTicket({
      sb,
      ticketId: newTicket.id,
      workspaceId,
      userId: null,   // system-triggered, no user
    }).catch((err) => {
      if (err instanceof BudgetExceededError) {
        console.log(`[inbound-email] auto-triage skipped — workspace ${workspaceId} out of budget`);
      } else {
        console.error('[inbound-email] auto-triage failed:', err);
      }
    });
    autoTriageQueued = true;
  } catch (err) {
    console.error('[inbound-email] failed to queue auto-triage:', err);
  }

  return {
    ticket_id: newTicket.id,
    ticket_display_id: newTicket.display_id,
    customer_id: customerId,
    is_new_customer: isNewCustomer,
    auto_triage_queued: autoTriageQueued,
    deduped: false,
  };
}
