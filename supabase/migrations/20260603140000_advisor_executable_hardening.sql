-- Security Advisor hardening (WARN): lock down SECURITY DEFINER function EXECUTE
-- grants and drop the brand-assets listing policy.
--
-- Postgres grants EXECUTE to PUBLIC by default on function creation, so even
-- functions "granted to service_role" stayed callable by anon/authenticated —
-- that's what tripped `{anon,authenticated}_security_definer_function_executable`.

-- ── Mutating, service-role-only RPCs ────────────────────────────────────────
-- deduct_ai_credits: called only via service-role (api/src/lib/budget.ts, from
-- triage/sentiment/kb-suggest — all pass the service-role client).
-- provision_brand: called only via service-role (api/src/routes/god.ts, behind
-- requirePlatformAdmin → supabaseAdmin).
-- Neither is referenced in any RLS policy, so revoking PUBLIC is safe.
revoke execute on function public.deduct_ai_credits(uuid, bigint) from public;
revoke execute on function public.provision_brand(
  text, text, text, text, text, text, bigint, smallint, text[]
) from public;
grant  execute on function public.deduct_ai_credits(uuid, bigint) to service_role;
grant  execute on function public.provision_brand(
  text, text, text, text, text, text, bigint, smallint, text[]
) to service_role;

-- ── Read-only check helpers used INSIDE RLS policies ────────────────────────
-- is_platform_admin() / is_workspace_admin() are SECURITY DEFINER (they read
-- RLS-protected catalogue tables without recursing) and are evaluated inside
-- policies as the querying role, so `authenticated` MUST keep EXECUTE. anon
-- never needs them, so revoke the implicit PUBLIC grant. The remaining
-- `authenticated` executability is inherent to using them in policies — that
-- WARN is expected and can be acknowledged in the advisor.
revoke execute on function public.is_platform_admin()      from public;
revoke execute on function public.is_workspace_admin(uuid) from public;
grant  execute on function public.is_platform_admin()      to authenticated, service_role;
grant  execute on function public.is_workspace_admin(uuid) to authenticated, service_role;

-- ── brand-assets bucket listing ─────────────────────────────────────────────
-- The bucket is public: object bytes are served via getPublicUrl() (CDN, no
-- RLS), uploads/cleanup run via the service-role API (api/src/routes/workspace.ts).
-- The brand_assets_public_read SELECT policy only granted anon/authenticated the
-- ability to LIST objects — which nothing legitimately needs and which trips
-- `public_bucket_allows_listing`. Dropping it leaves public-URL reads unaffected.
drop policy if exists "brand_assets_public_read" on storage.objects;
