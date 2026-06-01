-- Bump tickets.updated_at when any of a ticket's child rows changes.
-- Until now, only direct UPDATEs to the tickets row touched
-- updated_at (via the existing set_updated_at trigger). New messages,
-- new tags, and time entries were invisible to anything that watched
-- updated_at for change detection — including the new live-sync poll
-- driven by the presence heartbeat.
--
-- After this migration: any mutation that an agent on the ticket-detail
-- view would care about (new replies, tag changes, AI-tag accepts, time
-- logged) bumps the parent ticket's updated_at, so the heartbeat-driven
-- sync sees it on the next beat and refetches the full detail.
--
-- Explicit non-targets:
--   - ticket_viewers — heartbeats every 5s, would self-defeat the sync
--   - events / audit_events — internal log, not user-visible change
--   - ticket_attachments — only inserted alongside a ticket_messages
--     row today; that row is the trigger surface
--   - ticket_links — link state lives in the API layer, not surfaced on
--     the detail view's main fields
--
-- The function is intentionally simple — no SECURITY DEFINER. It runs
-- as the calling role, which for agents is `authenticated`; their RLS
-- on tickets already allows UPDATEs to rows in their workspace, so the
-- bump is permitted in the same transaction as the child write.
--
-- The `deleted_at is null` predicate on the UPDATE serves two purposes:
-- (a) soft-deleted parents don't get spurious updated_at bumps from
-- late child mutations (would re-surface them on activity-sorted lists)
-- (b) hard-delete cascades from tickets → child tables match 0 rows
-- here (the parent row is already gone), making the trigger fan-out
-- during a cascade a cheap no-op instead of a wasted UPDATE attempt.

create or replace function public.bump_ticket_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.tickets
  set updated_at = now()
  where id = coalesce(new.ticket_id, old.ticket_id)
    and deleted_at is null;
  return coalesce(new, old);
end;
$$;

-- CREATE OR REPLACE keeps the migration idempotent — re-running it
-- against a DB where the triggers already exist (e.g. after a partial
-- failure, or a fresh Docker validation against the merged file)
-- won't error out. PG 14+ syntax; Supabase is on 15+, vanilla PG 17 OK.

create or replace trigger bump_ticket_on_message
  after insert or update or delete on ticket_messages
  for each row execute function public.bump_ticket_updated_at();

create or replace trigger bump_ticket_on_tag
  after insert or delete on ticket_tags
  for each row execute function public.bump_ticket_updated_at();

create or replace trigger bump_ticket_on_ai_tag
  after insert or update or delete on ticket_ai_tags
  for each row execute function public.bump_ticket_updated_at();

create or replace trigger bump_ticket_on_time_entry
  after insert or update or delete on time_entries
  for each row execute function public.bump_ticket_updated_at();
