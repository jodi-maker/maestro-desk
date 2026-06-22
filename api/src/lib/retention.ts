// Data-retention purge (owner decision 2026-06-22): delete resolved tickets once
// they pass their workspace's retention window, measured from resolved_at. The
// PII-bearing children (messages, attachments, csat, time entries, viewers, …)
// are removed by the ON DELETE CASCADE FKs to tickets; aggregate logs that
// reference a ticket with ON DELETE SET NULL (ai_usage_log, automation events)
// are retained with their ticket link nulled.
//
// One set-based statement across all workspaces, each applying its own
// retention_days — no per-workspace loop, so cost doesn't grow with brand count.
// NULL retention_days = purge disabled for that workspace (legal hold).

import { getDb } from './db.js';

export async function purgeExpiredTickets(): Promise<{ purgedTickets: number }> {
  const sql = getDb();
  const rows = await sql`
    delete from tickets t
    using workspaces w
    where t.workspace_id = w.id
      and w.deleted_at is null
      and w.retention_days is not null
      and t.resolved_at is not null
      and t.resolved_at < now() - make_interval(days => w.retention_days)
    returning t.id
  `;
  return { purgedTickets: rows.count };
}
