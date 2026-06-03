-- Follow-up to 20260603140000. That migration did `revoke execute … from public`,
-- which removed only the PUBLIC-pseudo-role grant (it cleared anon). But Supabase's
-- default privileges grant EXECUTE on new public-schema functions to `authenticated`
-- EXPLICITLY — so `authenticated` retained EXECUTE on the two mutating RPCs.
-- Confirmed against the live DB: has_function_privilege('authenticated', …) was
-- still true for deduct_ai_credits and provision_brand after 20260603140000.
--
-- Revoke from `authenticated` explicitly so they are service-role-only. Both are
-- invoked only via the service-role client (budget.ts; god.ts → supabaseAdmin)
-- and are not used in any RLS policy, so this is safe. service_role keeps its
-- own explicit grant.
--
-- (is_platform_admin / is_workspace_admin are deliberately NOT revoked from
-- authenticated — they're evaluated inside RLS policies as the querying role and
-- would break if authenticated lost EXECUTE. Their authenticated WARN is inherent.)

revoke execute on function public.deduct_ai_credits(uuid, bigint) from anon, authenticated;
revoke execute on function public.provision_brand(
  text, text, text, text, text, text, bigint, smallint, text[]
) from anon, authenticated;
