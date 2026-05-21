import type { SupabaseClient } from '@supabase/supabase-js';
import type { TriageOutput } from './triage.ts';

// ─── Config ──────────────────────────────────────────────────────────────

export interface WorkspaceAutoReplyConfig {
  min_confidence: number | null;     // null = auto-reply disabled
  categories: string[];              // empty = no auto-reply
  name: string;                      // workspace name, used as sign-off in the reply
}

// ─── Evaluation ──────────────────────────────────────────────────────────

export type AutoReplyDecision =
  | { eligible: true; reason: 'all_gates_passed' }
  | { eligible: false; reason:
      | 'workspace_disabled'
      | 'category_not_allowed'
      | 'confidence_below_threshold' };

/**
 * Pure function — no DB access, easy to unit test. Returns eligibility +
 * a tag describing why so callers can log it.
 */
export function evaluateAutoReply(
  triage: TriageOutput,
  config: WorkspaceAutoReplyConfig,
): AutoReplyDecision {
  if (config.min_confidence === null || config.categories.length === 0) {
    return { eligible: false, reason: 'workspace_disabled' };
  }
  if (!config.categories.includes(triage.category_key)) {
    return { eligible: false, reason: 'category_not_allowed' };
  }
  if (triage.confidence < config.min_confidence) {
    return { eligible: false, reason: 'confidence_below_threshold' };
  }
  return { eligible: true, reason: 'all_gates_passed' };
}

// ─── Posting ─────────────────────────────────────────────────────────────

export interface PostAutoReplyArgs {
  sb: SupabaseClient;
  workspaceId: string;
  ticketId: string;
  draftReply: string;
  confidence: number;
  model: string;
  workspaceName: string;
}

export interface PostAutoReplyResult {
  posted: boolean;
  reason?: 'already_auto_replied';
  message_id?: string;
}

/**
 * Insert the AI draft as a ticket_messages row (role='ai') AND emit an event
 * to the activity log for audit. Idempotent: if a previous auto-reply
 * already exists on this ticket, returns posted=false rather than spamming
 * the customer.
 *
 * Idempotency check uses the activity events table — looking for
 * (entity_type='ticket', entity_id, kind='auto_reply'). We chose this over a
 * column on ticket_messages because the events table is already the audit
 * surface and adding a column to ticket_messages is a bigger commitment.
 */
export async function postAutoReply(args: PostAutoReplyArgs): Promise<PostAutoReplyResult> {
  const { sb, workspaceId, ticketId, draftReply, confidence, model, workspaceName } = args;

  // 1. Idempotency check — has this ticket already been auto-replied?
  const { data: existing, error: eErr } = await sb
    .from('events')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('entity_type', 'ticket')
    .eq('entity_id', ticketId)
    .eq('kind', 'auto_reply')
    .limit(1)
    .maybeSingle();
  if (eErr) throw new Error(`Auto-reply idempotency check failed: ${eErr.message}`);
  if (existing) {
    return { posted: false, reason: 'already_auto_replied' };
  }

  // 2. Post the AI message. author_label is the workspace name so the customer
  //    sees a brand-consistent sender, not "AI Agent" (the prompt instructs
  //    Claude to sign off as the workspace name — keep these in sync).
  const { data: msg, error: mErr } = await sb
    .from('ticket_messages')
    .insert({
      workspace_id: workspaceId,
      ticket_id: ticketId,
      role: 'ai',
      author_user_id: null,
      author_label: workspaceName,
      body: draftReply,
    })
    .select('id')
    .single();
  if (mErr) throw new Error(`Auto-reply message insert failed: ${mErr.message}`);

  // 3. Audit event. details captures the confidence + model so future review
  //    can reason about which auto-replies were higher-risk.
  const { error: evErr } = await sb.from('events').insert({
    workspace_id: workspaceId,
    entity_type: 'ticket',
    entity_id: ticketId,
    kind: 'auto_reply',
    author_label: workspaceName,
    details: `Auto-reply posted (confidence ${confidence}, model ${model})`,
  });
  if (evErr) {
    console.error('[auto-reply] event log failed:', evErr.message);
    // Don't fail the whole post — the message was successfully sent. Just lose
    // the audit row for this one (rare; should be loud in logs to debug).
  }

  return { posted: true, message_id: msg.id };
}
