-- Pivot workflows / workflow_runs / sla_policies / assign_rules RLS to
-- is_workspace_member, carrying forward the OR-platform-admin
-- broadening from 20260522140100 as is_platform_admin_jwt.
--
-- workflow_runs is included because the workflows.ts route reads from
-- it directly (the "recent runs" panel); other lib code that writes
-- workflow_runs (workflow-engine.ts) keeps using service-role and
-- bypasses RLS, so its behaviour is unchanged.

drop policy if exists workflows_ws     on workflows;
drop policy if exists workflow_runs_ws on workflow_runs;
drop policy if exists sla_policies_ws  on sla_policies;
drop policy if exists assign_rules_ws  on assign_rules;

create policy workflows_ws on workflows
  for all to authenticated
  using      (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt())
  with check (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt());

create policy workflow_runs_ws on workflow_runs
  for all to authenticated
  using      (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt())
  with check (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt());

create policy sla_policies_ws on sla_policies
  for all to authenticated
  using      (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt())
  with check (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt());

create policy assign_rules_ws on assign_rules
  for all to authenticated
  using      (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt())
  with check (public.is_workspace_member(workspace_id) or public.is_platform_admin_jwt());
