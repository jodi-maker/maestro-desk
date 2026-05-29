-- Pivot canned_responses + ticket_templates RLS from current_workspace_id()
-- to is_workspace_member(), so the two CRUD routes can move to the
-- user-scoped client. Same pattern as the KB pivot, also carrying
-- forward the OR-platform-admin broadening from 20260522140100.

drop policy if exists canned_responses_ws on canned_responses;
drop policy if exists ticket_templates_ws on ticket_templates;

create policy canned_responses_ws on canned_responses
  for all to authenticated
  using      (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt())
  with check (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt());

create policy ticket_templates_ws on ticket_templates
  for all to authenticated
  using      (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt())
  with check (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt());
