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

### C. Migrate the auth data (targeted slice)  ⏳ NEXT — start of the cutover
- [ ] Copy `users`, `workspace_members`, `roles`, `role_permissions` from Supabase → Neon, **preserving ids**.
- [ ] Per decision #1: either import password hashes into Better Auth's `account` table, or trigger invite/reset for each agent.
- [ ] Verify a test agent + a platform admin can sign in.

### D. Switch the backend (4 files)
- [ ] `middleware/auth.ts` + `middleware/platform-admin.ts`: verify the Better Auth session instead of `supabaseAdmin.auth.getUser`; resolve `userId`. (Membership/`is_platform_admin` lookups move to Neon here, since that's where Better Auth's users now live.)
- [ ] `routes/config.ts`: stop shipping `supabase_url`/`anon_key` for login (serve Better Auth's base path instead).
- [ ] `routes/god.ts`: replace `auth.admin.generateLink` invite with Better Auth's invite/create-user flow.

### E. Switch the frontend
- [ ] `js/core/auth-client.js`: `signIn` calls Better Auth's sign-in endpoint instead of the Supabase token URL; keep storing the returned token for `api-client` to attach as Bearer.
- [ ] Confirm `rehydrateUser`, `signOut`, platform-admin path still work.

### F. Prove it + wrap up
- [ ] Local: backend up, sign in as agent (workspace auto-pick) and as platform admin (god panel); `/whoami` works.
- [ ] `bun run typecheck` green; CI smokes green.
- [ ] Small commits → PR `Step 2: replace login with Better Auth` → `/cem-pr-loop` to 4+/5.
- [ ] **Don't merge** until a real sign-in works end-to-end against Neon.

---

## Risks / notes
- **Don't lock anyone out:** keep the Supabase login path working until Better Auth sign-in is proven, then cut over. The targeted data copy + id preservation is what makes the membership checks keep working.
- **Split-brain guard:** once Better Auth users live in Neon, the membership lookups in the auth middleware must also read Neon (small, included in D) — otherwise identity (Neon) and membership (Supabase) disagree.
- No production cutover in this step.

---
*Status: checklist drafted, pending the 4 decisions above. Branch created off the merged Step 1 `main`.*
