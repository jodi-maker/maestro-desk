-- Make ticket_categories admin-manageable: add an is_active toggle and tighten
-- writes to workspace admins.
--
-- Until now categories were a fixed lookup seeded at provision time, and the
-- single `ticket_categories_ws` policy let ANY authenticated workspace member
-- INSERT/UPDATE/DELETE them. This migration:
--   1. adds `is_active boolean default true` so a default category can be
--      disabled (hidden from new tickets + AI triage) without losing history;
--   2. replaces the catch-all policy with read-for-members + write-for-admins,
--      matching the workspace_members admin-write pattern
--      (20260529230000_workspace_members_admin_writes.sql).
--
-- No DELETE path is exposed in the API — disabling (is_active=false) is the
-- reversible, history-safe way to retire a category. Existing tickets keep
-- their category_key regardless.

alter table ticket_categories
  add column if not exists is_active boolean not null default true;

-- Read for any workspace member; writes for workspace admins (or platform
-- admins). Drop the old all-verbs member policy first.
--
-- These use the post-pivot helpers is_workspace_member / is_workspace_admin,
-- which read the JWT 'workspace_ids' ARRAY claim injected by the access-token
-- hook (see 20260529120000_tickets_rls_pivot.sql + 20260529230000). Passing
-- the row's workspace_id means the predicate also rejects a caller-supplied
-- workspace_id that isn't one the caller belongs to / admins — so INSERT is
-- scoped correctly via the with-check.
--
-- Do NOT use current_workspace_id() here: it reads a SINGULAR 'workspace_id'
-- claim that the hook does not inject, so it is null under the live auth
-- regime and would deny all member/admin access via the user-scoped client.
drop policy if exists ticket_categories_ws on ticket_categories;

create policy ticket_categories_select on ticket_categories
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    or public.is_platform_admin_jwt()
  );

create policy ticket_categories_admin_write on ticket_categories
  for all to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    or public.is_platform_admin_jwt()
  )
  with check (
    public.is_workspace_admin(workspace_id)
    or public.is_platform_admin_jwt()
  );
