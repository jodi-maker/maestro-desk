import type { SupabaseClient } from '@supabase/supabase-js';

// Resolves the per-workspace "From" identity for outbound mail. Picks the
// brand's first verified email domain (verified_at IS NOT NULL, deleted_at
// IS NULL, ordered by created_at — i.e. the longest-standing verified
// domain) and constructs `support@<domain>`. From-name falls back to the
// workspace name when support_email_display_name is unset.
//
// Returns null when the workspace has no verified domain — the caller
// should fall back to the platform-default sender (env.POSTMARK_OUTBOUND_FROM)
// or skip the send entirely if the platform default isn't configured either.
//
// "support@" is hardcoded for v1. A future column on workspace_email_domains
// (outbound_local_part text default 'support') could let brands customise.

export interface OutboundFrom {
  fromEmail: string;
  fromName: string;
}

export async function getOutboundFrom(
  sb: SupabaseClient,
  workspaceId: string,
): Promise<OutboundFrom | null> {
  const { data: ws, error: wErr } = await sb
    .from('workspaces')
    .select('name, support_email_display_name')
    .eq('id', workspaceId)
    .single();
  if (wErr || !ws) return null;

  const { data: domain, error: dErr } = await sb
    .from('workspace_email_domains')
    .select('domain')
    .eq('workspace_id', workspaceId)
    .not('verified_at', 'is', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (dErr || !domain) return null;

  return {
    fromEmail: `support@${domain.domain}`,
    fromName: ws.support_email_display_name?.trim() || ws.name,
  };
}
