-- Real-time presence + collaboration. ticket_viewers tracks which
-- agents are currently looking at a ticket, with an optional
-- composing flag so the SPA can warn before two agents send
-- competing replies.
--
-- This is a hot table by design — every active ticket-detail view
-- heartbeats every ~5s. The composite PK (ticket_id, user_id) +
-- upsert pattern keeps the row count bounded by (open tickets
-- right now) × (agents looking at them). Stale rows are filtered
-- server-side at read time (>15s = not present); a periodic
-- purge can prune them, but the table stays small either way.

create table ticket_viewers (
  ticket_id      uuid not null references tickets(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  last_seen_at   timestamptz not null default now(),
  composing      boolean not null default false,
  composing_at   timestamptz,
  primary key (ticket_id, user_id)
);

create index ticket_viewers_ticket_seen_idx
  on ticket_viewers (ticket_id, last_seen_at desc);

-- RLS: any workspace member can read presence (so chips show up
-- for everyone on the team), but each user can only write/delete
-- their own row. Platform admins get the cross-workspace escape
-- hatch consistent with the rest of the schema.
alter table ticket_viewers enable row level security;

create policy ticket_viewers_read on ticket_viewers
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt());

create policy ticket_viewers_write on ticket_viewers
  for all to authenticated
  using      (user_id = auth.uid() and public.is_workspace_member(workspace_id))
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));
