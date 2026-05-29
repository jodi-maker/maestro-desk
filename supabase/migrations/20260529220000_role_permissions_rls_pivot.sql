-- Pivot role_permissions RLS from current_workspace_id() to
-- is_workspace_member(). The policy gates by joining through
-- roles (role_permissions doesn't carry workspace_id directly).
--
-- roles itself was pivoted in 20260529140000; the permissions table
-- policy is permissive (SELECT for any authenticated, no workspace
-- scope — it's a global catalog) and doesn't need touching.

drop policy if exists role_permissions_via_role on role_permissions;

create policy role_permissions_via_role on role_permissions
  for all to authenticated
  using (
    role_id in (
      select id from roles
      where public.is_workspace_member(roles.workspace_id)
         or public.is_platform_admin_jwt()
    )
  )
  with check (
    role_id in (
      select id from roles
      where public.is_workspace_member(roles.workspace_id)
         or public.is_platform_admin_jwt()
    )
  );
