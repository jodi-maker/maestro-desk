-- Fix the Custom Access Token Hook signature: Supabase expects the
-- modified `event` object back, not just `{claims: ...}`. With the
-- wrong shape, GoTrue logs "Error running hook URI" and refuses to
-- issue the token, blocking sign-in.
--
-- Also rename the local variable away from `user_id` to dodge any
-- plpgsql column-vs-variable ambiguity in the workspace_members
-- query.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  uid             uuid    := (event ->> 'user_id')::uuid;
  claims          jsonb   := coalesce(event -> 'claims', '{}'::jsonb);
  workspaces      text[];
  platform_admin  boolean;
begin
  select array_agg(workspace_id::text)
    into workspaces
    from workspace_members
    where workspace_members.user_id = uid
      and active = true;

  select coalesce(is_platform_admin, false)
    into platform_admin
    from users
    where id = uid;

  claims := claims
    || jsonb_build_object(
         'workspace_ids',     coalesce(to_jsonb(workspaces), '[]'::jsonb),
         'is_platform_admin', coalesce(platform_admin, false)
       );

  -- Return the full event with the modified claims field — that's the
  -- shape Supabase Auth expects from a Custom Access Token Hook.
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
