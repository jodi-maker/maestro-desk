// Deploy-time migration hook (Vercel build step).
//
// Wired as the `vercel-build` script in package.json, so Vercel runs it during
// the build — BEFORE the new serverless function goes live — on every deploy.
// Applying pending migrations here (rather than out-of-band) keeps the prod
// Neon schema in lockstep with the code being deployed: the DB is migrated
// before the new code can serve a request against it.
//
// Why a wrapper around scripts/migrate.ts instead of calling it directly:
//   - Preview/non-prod builds do NOT have DATABASE_URL (it's a Production-only
//     env var), and the bare migrate runner exits 1 when it's missing — which
//     would FAIL those builds. Here we skip cleanly instead, so only builds
//     that actually have a database to migrate run migrations.
//   - When DATABASE_URL *is* present we defer entirely to migrate.ts (one
//     source of truth for the runner): it applies pending files in order, each
//     in a transaction, recording them in schema_migrations (idempotent — an
//     already-migrated DB is a no-op). A migration failure propagates a
//     non-zero exit code, which fails the build and aborts the deploy, so new
//     code never goes live against an un-migrated database.
if (!process.env.DATABASE_URL) {
  console.log(
    '↷ migrate-deploy: no DATABASE_URL in this build environment — skipping ' +
      '(expected for preview / non-production builds).',
  );
  process.exit(0);
}

console.log('▶ migrate-deploy: DATABASE_URL present — applying pending migrations…');
// Running migrate.ts executes its top-level main() and sets process.exitCode on
// failure; awaiting the dynamic import waits for its top-level await to settle.
await import('./migrate.ts');
