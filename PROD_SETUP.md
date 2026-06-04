# Production setup — internal cutover (clean-slate)

Standing up Maestro Desk for **internal use** (your team replaces Zoho Desk). Clean-slate: new tickets start here; old Zoho tickets stay in Zoho until they close out. No data migration.

Stack: **Supabase** (new prod project) · **Fly.io** (Bun/Hono API) · **Cloudflare Pages** (SPA) · **Postmark** (email). Domain: **maestro-desk.com** — `desk.maestro-desk.com` (agent app) · `help.maestro-desk.com` (portal) · `support@maestro-desk.com` (email).

> Legend: 🤖 = Claude can do it (Supabase Management API / repo) · 👤 = you (billing, DNS, account auth).

## Status (prod stood up 2026-06-03)
Prod Supabase project: **`maestro-desk-prod`** · ref **`lswyvrohumwbszegmybx`** · eu-central-1 · Free.
**Done:** project created · all migrations applied (incl. the two 2026-06-04 category migrations, recorded in `schema_migrations`) · `site_url` + redirect allow-list set · Custom Access Token Hook enabled · DB password reset (2026-06-04) · **real workspace `Maestro-Desk` provisioned** (slug `maestro-desk`, id `6b3639f5-a511-489a-b5e4-5e9451c7be59`, 11 iGaming categories) · **`jodi@weezboo.com` created as platform admin + workspace Admin** (auth uid `058de714-b946-4780-b8a6-4757cf88a6f6`; hook-claim injection verified). jodi has **no password yet** — set it via a recovery link once the SPA is deployed (step 4/5; redirect host must be live first).
**Pending:** agent invites · Fly deploy · Cloudflare Pages domain wiring · Postmark domain + DNS.
**Cleanup note:** prod also contains the seeded **`demo`** workspace (TK-001 etc.) from the initial migration set — harmless (separate workspace) but can be purged later if a truly clean prod is wanted.

## 1. Supabase prod project ✅
- [x] 🤖 Project created via Management API — ref `lswyvrohumwbszegmybx`, region eu-central-1, Free.
- [x] 🤖 Migrations applied (`supabase db push --db-url …`) — 52 tables, 56 policies.
- [x] 🤖 `site_url` → `https://desk.maestro-desk.com` + redirect allow-list for `desk.`/`help.`.
- [x] 🤖 Custom Access Token Hook enabled → `pg-functions://postgres/public/custom_access_token_hook`. **(RLS depends on this — done via API, not the dashboard.)**
- [x] 👤 Reset the prod DB password (Dashboard → Settings → Database) — done 2026-06-04. Upgrade to Pro when you want daily backups + HIBP.
- [x] 🤖 Pushed the two 2026-06-04 category migrations to prod via the Management API query endpoint + recorded `schema_migrations` ledger rows (the local CLI is linked to dev, and the new DB password isn't held here, so `db push --linked` couldn't target prod).

## 2. Bootstrap your real workspace (clean-slate, not the demo seed)
- [x] 🤖 Created workspace via `provision_brand('Maestro-Desk','maestro-desk')` — id `6b3639f5-a511-489a-b5e4-5e9451c7be59`; 3 roles, 5 statuses, 4 priorities, 11 categories.
- [x] 🤖 `is_platform_admin = true` on `jodi@weezboo.com` (auth uid `058de714-…`) + added as workspace **Admin**. Hook-claim injection verified (`workspace_ids` + `is_platform_admin`).
- [ ] 👤 Invite your support agents (auth users) → 🤖 add them to `workspace_members` with the Agent/Admin role.
- [x] 🤖 Did **not** load the demo seed into the real workspace. (A separate seeded `demo` workspace exists from the initial migration set — see cleanup note in Status.)

## 3. API on Fly.io
- [ ] 👤 `fly auth login` (your Fly account).
- [ ] 👤 From `api/`: `fly launch --no-deploy` (uses the committed `fly.toml`/`Dockerfile`; don't let it overwrite them).
- [ ] 👤 Set secrets (values from prod Supabase + Anthropic + Postmark):
  ```sh
  fly secrets set \
    SUPABASE_URL=https://lswyvrohumwbszegmybx.supabase.co \
    SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
    ANTHROPIC_API_KEY=... \
    POSTMARK_INBOUND_SECRET=<random 16+ chars> \
    POSTMARK_SERVER_TOKEN=... POSTMARK_OUTBOUND_FROM=support@maestro-desk.com \
    POSTMARK_ACCOUNT_TOKEN=... POSTMARK_INBOUND_REPLY_ADDRESS=...@inbound.postmarkapp.com \
    PORTAL_BASE_URL=https://help.maestro-desk.com/portal.html
  ```
- [ ] 👤 `fly deploy` → note the app URL (`https://maestro-desk-api.fly.dev`). Verify `GET /api/v1/health` = 200 and `/health/ready` proves DB connectivity.
- [ ] 👤 (optional) Point `api.maestro-desk.com` at the Fly app.

## 4. Frontend (Cloudflare Pages)
- [ ] 👤 Point the existing Pages project at prod: the SPA reads `GET /api/v1/config` for `supabase_url`/`anon_key`, so set the **API base URL** it calls to the Fly app (or `api.maestro-desk.com`).
- [ ] 👤 Bind the domain → `desk.maestro-desk.com` (app) and serve `portal.html` at `help.maestro-desk.com`.
- [ ] 👤 Redeploy; confirm agent login works end-to-end (real Supabase auth, not demo persona).

## 5. Email (Postmark) + DNS
- [ ] 👤 In Postmark, add your sending **Domain** (not just a signature) → it returns DKIM + Return-Path records.
- [ ] 👤 Add DNS records on `maestro-desk.com`:
  - **DKIM** + **Return-Path (CNAME)** — from Postmark
  - **SPF (TXT @):** `v=spf1 a mx include:spf.mtasv.net ~all`
  - **DMARC (TXT _dmarc):** `v=DMARC1; p=none; pct=100; rua=mailto:rua@dmarc.postmarkapp.com` (monitoring; tighten after ~2 weeks)
  - **MX** on your support domain → Postmark inbound (`inbound.postmarkapp.com`) so inbound mail hits the webhook
  - **CNAMEs** for `desk` / `help` → Cloudflare Pages; `api` → Fly (if used)
- [ ] 👤 Verify the domain in Postmark (DKIM + Return-Path) — DNS can take minutes–hours.
- [ ] 👤 Configure Postmark inbound webhook URL → `https://<api>/api/v1/webhooks/postmark/inbound?secret=<POSTMARK_INBOUND_SECRET>`.
- [ ] 🤖 Add your support domain to the workspace (`workspace_email_domains`) so inbound routes to it (not the unrouted bucket).

## 6. Smoke + pilot
- [ ] 👤 Send a test email to `support@maestro-desk.com` → confirm a ticket appears, auto-triage populates summary/draft.
- [ ] 👤 Agent logs in at `desk.maestro-desk.com`, opens the ticket, replies → customer receives it from `support@maestro-desk.com`.
- [ ] 👤 Run a few real tickets through before flipping your public support address.
- [ ] 👤 **Cutover:** change where `support@…` mail is delivered from Zoho to Postmark; leave Zoho read-only until open tickets there close.

## Notes
- The API must run as **one always-on machine** (background workers) — don't scale to zero or past 1 (see `fly.toml`).
- HIBP leaked-password protection requires Supabase **Pro**.
- Migrations are validated on Docker PG 17 before any push (see `CLAUDE.md`).
