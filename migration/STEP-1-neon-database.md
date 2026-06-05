# Step 1 — Move the database to Neon (foundation)

**Branch:** `migrate/step-1-neon-database`
**Goal in one line:** Stand up Neon as the new database, get the schema and data into it, and give the code a clean way to run SQL against it — **without unplugging Supabase yet**, so the app keeps working.

---

## Decisions locked for this step
- **Postgres client:** `postgres` (porsager) — tagged-template SQL, no ORM.
- **Neon setup:** walk-through (project not created yet).
- **New migrations live in:** `db/migrations/` (old `supabase/migrations/` stays untouched for reference).

---

## In scope (this step)
- Create the Neon project + connection string.
- Add the `postgres` client and a small `db` helper to the API.
- Port **only the structural schema** to `db/migrations/`: tables, columns, indexes, functions, triggers, extensions.
- Copy existing data into Neon.
- Prove the API can read/write Neon via a health check.

## Out of scope (deliberately deferred — avoids breakage)
- **RLS policies, role grants, `authenticated`/`anon`/`service_role`** → handled in **Step 3** (security moves into API middleware).
- **`auth.users` / `auth.uid()` / the custom access token hook** → handled in **Step 2** (Better Auth owns users).
- **Rewriting the 28 files that query via the Supabase client** → rides along with **Step 3**.
- Supabase stays fully wired up this whole step. We are *adding* Neon alongside it, not removing anything.

---

## The checklist

### A. Set up Neon  *(your actions — I'll guide each one)*  ✅ DONE
- [x] Create a free Neon account and a new **project**.
- [x] Pick the region (eu-west-2 / London).
- [x] Copy the **connection string** (pooled, database `neondb`).
- [ ] *(optional, later)* Add a dedicated `dev` branch in Neon — currently pointed at the default branch. Fine for now.
- [x] Connection string stored in `api/.env` as `DATABASE_URL` (git-ignored, never committed).

### B. Wire up the client code  *(my actions)*  ✅ DONE
- [x] Add the `postgres` package to `api/package.json` (installed: `postgres@3.4.9`).
- [x] Add `DATABASE_URL` to `api/src/lib/env.ts` (optional for now) and to `.env.example`.
- [x] Create `api/src/lib/db.ts` — lazy, memoised `postgres` connection (SSL, small pool, `prepare:false` for Neon's pooler).
- [x] Create the migration runner (`api/scripts/migrate.ts`) + `bun run migrate` script.
- [x] **Proven against real Neon:** runner connects, created `schema_migrations`, `select version()` → PostgreSQL 18.4.
- [x] Safety: fixed `.gitignore` so `.env` files can never be committed.

### C. Port the structural schema  *(my actions)*
- [ ] Create the `db/migrations/` folder.
- [ ] Produce **Neon-compatible** versions of the schema, in order, containing **only**: `create extension` (pgcrypto, citext), tables, indexes, the `trigger_set_updated_at` helper, and the updated-at triggers.
- [ ] **Strip out** for now: all `enable row level security`, `create policy`, `grant ... to authenticated/anon/service_role`, `auth.uid()`, `auth.users`, the custom-access-token hook, and `storage.*` references. (These come back differently in Steps 2–3.)
- [ ] For the `users` reference: stand up a minimal placeholder `users` table so foreign keys hold, with a note that Better Auth replaces it in Step 2. *(Open question below.)*
- [ ] Apply the migrations to the Neon **dev** branch with the runner; fix any errors until it applies cleanly from empty.

### D. Migrate the data  *(my actions, with your go-ahead)*
- [ ] Dump the current data from Supabase (`pg_dump --data-only`, or per-table CSV for the big tables).
- [ ] Load it into Neon dev and check row counts match.
- [ ] Note: this is a **copy** — Supabase is untouched and still live.

### E. Prove it works  *(my actions)*
- [ ] Add a read+write check to the existing health route (`api/src/routes/health.ts`) that runs a trivial query against Neon and reports OK.
- [ ] Run the API locally (`cd api; bun run dev`) and confirm the health check passes against Neon.
- [ ] `bun run typecheck` stays green.

### F. Wrap up the branch
- [ ] Commit in small, labelled chunks.
- [ ] Open a PR titled `Step 1: stand up Neon database (foundation)`.
- [ ] PR description lists exactly what's deferred to Steps 2–3 so reviewers don't expect the query rewrite here.
- [ ] **Do not merge** until the health check is green and data counts are verified.

---

## Open questions / risks (worth a quick decision before/while we build)
1. **Placeholder users table.** The schema references a users table that today lives in Supabase auth. For Step 1 we either (a) create a minimal placeholder so foreign keys work and let Better Auth replace it in Step 2, or (b) port users-with-data now and adapt in Step 2. I lean (a) — cleaner. Confirm when we get there.
2. **Data freshness.** The data copy is a point-in-time snapshot. If the live app keeps changing data during the migration, we'll do a final fresh copy right before the real cutover (much later). For now, a snapshot for dev is fine.
3. **Extensions.** Neon supports `pgcrypto` and `citext` — no action needed, just confirming.
4. **No production cutover in this step.** Production keeps running on Supabase/current host until later steps are done and verified.

---

*Status: checklist ready. Next action: Section A — set up the Neon project (I'll walk you through it).*
