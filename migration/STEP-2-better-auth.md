# Step 2 — Replace login with Better Auth

**Branch:** `migrate/step-2-better-auth`
**Goal in one line:** Move agent + platform-admin sign-in off Supabase Auth onto **Better Auth**, with its tables living in Neon — without locking anyone out.

---

## What I found (current state)
- **Agent/admin login** uses Supabase Auth: the SPA (`js/core/auth-client.js`) POSTs email/password straight to `…/auth/v1/token`, gets a JWT, and sends it as `Bearer`. The API verifies it with `supabaseAdmin.auth.getUser(jwt)` in just **4 files**: `middleware/auth.ts`, `middleware/platform-admin.ts`, `routes/config.ts`, `routes/god.ts`.
- **Passwords live in Supabase Auth** (`auth.users`), not in our `users.password_hash` (that column is vestigial). New owners are created via `sb.auth.admin.generateLink({type:'invite'})` in `god.ts`.
- **`users.id` == Supabase `auth.users.id`** — and every table FKs to `users.id` (workspace_members, tickets, …). Preserving these ids is critical.
- **Customer portal login is NOT Supabase Auth** — it's a self-contained magic-link system (`lib/portal-auth.ts`, `portal_magic_links` + `portal_sessions`, `randomBytes` tokens). **Out of scope here**; its DB calls move to Neon in Step 3.

---

## In scope
- Stand up Better Auth in the Hono API, storing its tables in **Neon**.
- Map Better Auth onto the **existing `users` table** (preserve ids → all FKs stay intact) + add its own `session`/`account`/`verification` tables.
- Switch the SPA login + the 4 backend files from Supabase Auth → Better Auth.
- Replace the owner-invite flow in `god.ts` with Better Auth's equivalent.
- A **targeted** copy of just the auth-relevant rows into Neon (users, workspace_members, roles, role_permissions) so login works against Neon.

## Out of scope (deferred)
- Customer portal magic-link auth (Step 3 moves its DB calls only).
- The bulk data copy and the RLS→middleware authorization rewrite (**Step 3**). Step 2 keeps the *existing* membership checks; it only changes *how identity is proven*.
- Removing `@supabase/supabase-js` entirely (it's still the DB client until Step 3).

---

## Decisions — LOCKED ✅
1. **Password migration → Re-invite / reset.** No hash export. Each agent sets a new password via invite/reset email. Fits the clean-slate internal go-live.
2. **Better Auth driver → `pg` Pool.** App keeps `postgres` (porsager) for raw SQL; Better Auth gets its own `pg` Pool (approved client, native support).
3. **Session transport → Bearer token.** Use Better Auth's bearer plugin to keep the SPA's `Authorization: Bearer` + `sessionStorage` pattern. Minimal frontend churn.
4. **User table → map onto existing `users`.** Point Better Auth at the existing table, keep uuid ids, add its required columns. All existing FKs stay intact.

---

## The checklist (draft — finalised once decisions above are made)

### A. Set up Better Auth in the API  ✅ DONE
- [x] Add `better-auth@1.6.14` + `pg@8.21` to `api/package.json`.
- [x] Create `api/src/lib/auth.ts` — instance with pg Pool, email/password, bearer plugin, mapped to `users` (snake_case field map), `generateId:false` for uuid ids.
- [x] Mount handler in `api/src/index.ts` at `/api/auth/*`.
- [x] Add `BETTER_AUTH_SECRET` (optional) + `BETTER_AUTH_URL` to `env.ts` + `.env.example`; real secret in `api/.env`.
- [x] `bun run typecheck` green (validates BA option names against real types).

### B. Schema for Better Auth  ✅ DONE
- [x] `users` gets `email_verified boolean not null default false` + `image text`.
- [x] `session`/`account`/`verification` created — generated via `@better-auth/cli`, then fixed: BA-owned ids → `uuid default gen_random_uuid()` so `userId` FKs match `users.id uuid`; `email_verified` got a default (table has rows).
- [x] Applied via `bun run migrate`; verified tables + uuid FK types on Neon.
- [x] **Proven end-to-end:** sign-up + sign-in via `/api/auth/*` returned bearer tokens; user row landed in `users`, `account` holds the password hash, `session` rows created (test user then deleted).

### C / D / E — the login cutover → **MOVED TO STEP 3** (decision below)

**Why moved:** the cutover (switch the login token + the auth middleware + the
frontend) cannot be cleanly separated from Step 3. **23 feature routes** read
the DB through the Supabase **user token + RLS** (`c.get('sbUser')`). A Better
Auth token is not a Supabase JWT, so flipping the login token breaks all 23 at
once unless they're rewritten to raw SQL on Neon with per-route authorization —
which **is** Step 3. (Every one of the 23 also self-scopes by `workspace_id`,
so RLS was a second layer, not the only one.)

Rather than introduce a transitional window where those routes run on
service-role with **no RLS**, we keep Step 2 scoped to "Better Auth stood up
and proven," and do the actual switch in Step 3 as one cutover:
**token switch + 23 routes → Neon raw SQL + per-route authz middleware**,
landing together with no security gap.

So Step 3 absorbs the original C/D/E:
- Targeted auth-data copy (users/memberships) into Neon, preserving ids.
- Re-invite/reset flow for agents (no hash export).
- `middleware/auth.ts`, `middleware/platform-admin.ts`, `whoami.ts` → verify Better Auth session + read identity/membership from Neon.
- `routes/config.ts` → serve Better Auth base path instead of Supabase keys.
- `routes/god.ts` → Better Auth invite/create-user instead of `auth.admin.generateLink`.
- `js/core/auth-client.js` → sign in via Better Auth, keep the Bearer pattern.

### F. Ship Step 2 (A+B) ✅
- [x] `bun run typecheck` green.
- [ ] PR `Step 2: stand up Better Auth on Neon` → `/cem-pr-loop` to 4+/5.
- [x] Better Auth is purely additive here — mounted alongside Supabase, nothing switched, so nothing can break.

---

## Risks / notes
- **Auth + Step 3 are one cutover.** Confirmed by the 23 `sbUser` routes — see above. Step 2 deliberately stops short of flipping the token.
- **Better Auth is dormant until Step 3.** It's stood up, schema on Neon, login proven on seed data — but no live traffic uses it yet.
- No production cutover in this step.

---
*Status: A+B DONE + verified on Neon. C/D/E folded into Step 3. Decisions locked. Branch off the merged Step 1 `main`.*
