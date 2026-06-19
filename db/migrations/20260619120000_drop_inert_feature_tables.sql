-- Schema cleanup: drop the tables left inert by the Phase 1 slim-down PRs.
--
-- These tables are no longer read or written by any runtime code:
--   * workflows / workflow_runs   — the workflow engine was removed (PR #350)
--   * permissions / role_permissions — the granular permission grid was
--                                      collapsed to the is_admin flag (PR #351)
--   * stripe_integrations / shopify_integrations — the player-commerce
--                                      integrations were removed (PR #352)
--
-- One runtime dependency remains: provision_brand() still seeds role_permissions
-- for each new brand. We must redefine the function to stop doing that BEFORE
-- dropping the table, or brand provisioning would fail. Roles themselves (with
-- the is_admin flag that actually governs access) are unchanged.

-- ─── 1. Redefine provision_brand without the role_permissions grants ────────
-- Reproduced verbatim from 20260604120000_provision_brand_igaming_categories.sql
-- except: the old "section 3 — role permissions" block and the now-unused
-- per-role id lookups/declarations are removed. Everything else is identical.
create or replace function public.provision_brand(
  p_name                          text,
  p_slug                          text,
  p_domain                        text     default null,
  p_logo_url                      text     default null,
  p_primary_color                 text     default null,
  p_support_email_display_name    text     default null,
  p_ai_credits_micro              bigint   default 0,
  p_auto_reply_min_confidence     smallint default null,
  p_auto_reply_categories         text[]   default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
begin
  -- 1. Workspace row.
  insert into workspaces (
    slug, name, plan, ai_credits_micro,
    logo_url, primary_color, support_email_display_name,
    auto_reply_min_confidence, auto_reply_categories
  )
  values (
    p_slug, p_name, 'trial', p_ai_credits_micro,
    p_logo_url, p_primary_color, p_support_email_display_name,
    p_auto_reply_min_confidence, p_auto_reply_categories
  )
  returning id into v_workspace_id;

  -- 2. Roles. Names + is_admin flag mirror the demo seed. Access is governed
  -- by the is_admin flag alone (the granular permission grid was removed).
  insert into roles (workspace_id, name, is_admin) values
    (v_workspace_id, 'Admin',        true),
    (v_workspace_id, 'Senior Agent', false),
    (v_workspace_id, 'Read Only',    false);

  -- 3. Lookup tables — statuses/priorities match the demo seed; categories use
  -- the iGaming default set.
  insert into ticket_statuses (workspace_id, key, label, color, sort_order, is_terminal) values
    (v_workspace_id, 'open',      'Open',      'var(--cyan)',  10, false),
    (v_workspace_id, 'escalated', 'Escalated', 'var(--red)',   20, false),
    (v_workspace_id, 'pending',   'Pending',   'var(--amber)', 30, false),
    (v_workspace_id, 'gdpr',      'GDPR',      'var(--red)',   40, false),
    (v_workspace_id, 'resolved',  'Resolved',  'var(--green)', 90, true);

  insert into ticket_priorities (workspace_id, key, label, sort_order) values
    (v_workspace_id, 'low',    'Low',    10),
    (v_workspace_id, 'normal', 'Normal', 20),
    (v_workspace_id, 'high',   'High',   30),
    (v_workspace_id, 'urgent', 'Urgent', 40);

  insert into ticket_categories (workspace_id, key, label) values
    (v_workspace_id, 'Account',       'Account'),
    (v_workspace_id, 'Payments',      'Payments'),
    (v_workspace_id, 'DueDiligence',  'Due Diligence'),
    (v_workspace_id, 'General',       'General'),
    (v_workspace_id, 'Complaints',    'Complaints'),
    (v_workspace_id, 'Product',       'Product'),
    (v_workspace_id, 'Data',          'Data'),
    (v_workspace_id, 'RG',            'Responsible Gaming'),
    (v_workspace_id, 'Promotions',    'Promotions'),
    (v_workspace_id, 'Fraud',         'Fraud'),
    (v_workspace_id, 'Marketing',     'Marketing');

  -- 4. Business hours — Mon–Fri 9–18, Sat/Sun disabled.
  insert into business_hours (workspace_id, enabled, days, holidays) values (
    v_workspace_id, true,
    '[
      {"label":"Mon","enabled":true, "start":"09:00","end":"18:00"},
      {"label":"Tue","enabled":true, "start":"09:00","end":"18:00"},
      {"label":"Wed","enabled":true, "start":"09:00","end":"18:00"},
      {"label":"Thu","enabled":true, "start":"09:00","end":"18:00"},
      {"label":"Fri","enabled":true, "start":"09:00","end":"18:00"},
      {"label":"Sat","enabled":false,"start":"09:00","end":"18:00"},
      {"label":"Sun","enabled":false,"start":"09:00","end":"18:00"}
    ]'::jsonb,
    '{}'
  );

  -- 5. Email domain mapping (optional).
  if p_domain is not null and length(trim(p_domain)) > 0 then
    insert into workspace_email_domains (workspace_id, domain)
      values (v_workspace_id, p_domain);
  end if;

  return v_workspace_id;
end;
$$;

-- ─── 2. Drop the inert tables (dependency order; cascade as a safety net) ────
drop table if exists workflow_runs        cascade;  -- FK -> workflows
drop table if exists workflows            cascade;
drop table if exists role_permissions     cascade;  -- FK -> permissions, roles
drop table if exists permissions          cascade;
drop table if exists stripe_integrations  cascade;
drop table if exists shopify_integrations cascade;
