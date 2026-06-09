import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import { Pool } from 'pg';
import { env } from './env.ts';
import { sendEmail, isPostmarkConfigured } from './postmark-outbound.ts';

// Better Auth (migration to Neon — Step 2). Owns sign-in, sessions, and the
// users/account/session/verification tables in Neon. Replaces Supabase Auth.
//
// Decisions (see migration/STEP-2-better-auth.md):
//   - Driver: a dedicated `pg` Pool here. The rest of the API uses the
//     `postgres` (porsager) client for raw SQL; Better Auth gets its own pool.
//   - Session transport: bearer tokens (matches the SPA's existing
//     `Authorization: Bearer` + sessionStorage pattern).
//   - User table: mapped onto the EXISTING `users` table so every existing FK
//     (workspace_members, tickets, …) keeps pointing at the same uuid ids.
//     New users get their id from the table's `gen_random_uuid()` default
//     (generateId: false), keeping ids uuid like the legacy Supabase ones.
// Better Auth is now the LIVE auth system (Step 3 cutover). BETTER_AUTH_SECRET
// is required by env.ts, so the only soft check left is the DB connection.
if (!env.DATABASE_URL) {
  console.warn('[auth] DATABASE_URL is not set — Better Auth cannot reach Neon.');
}

// Reuse a single pg Pool across `bun --hot` reloads — without this, each hot
// reload would leak a fresh Pool (and its connections). Stashing it on
// globalThis keeps one pool for the process lifetime.
const g = globalThis as unknown as { __maestroBetterAuthPool?: Pool };
const pool = (g.__maestroBetterAuthPool ??= new Pool({ connectionString: env.DATABASE_URL }));

export const auth = betterAuth({
  database: pool,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // The SPA is served from a different origin than the API (e.g. :5173 → :3001
  // in dev; desk.maestro-desk.com → the API host in prod). Trust it so sign-in
  // and password-reset accept it.
  trustedOrigins: [env.APP_BASE_URL],
  emailAndPassword: {
    enabled: true,
    // Emailed when a user requests (or is sent) a password reset — the only
    // way invited agents/owners set their first password (no password carried
    // over from Supabase). We bypass Better Auth's default reset URL and link
    // straight to the SPA with the token, so the SPA can collect the new
    // password and POST /api/auth/reset-password itself.
    sendResetPassword: async ({ user, token }) => {
      if (!isPostmarkConfigured()) {
        console.warn('[auth] sendResetPassword skipped — Postmark outbound not configured');
        return;
      }
      const link = `${env.APP_BASE_URL}/?reset_token=${encodeURIComponent(token)}`;
      await sendEmail({
        to: user.email,
        subject: 'Set your Maestro Desk password',
        textBody:
          `You've been invited to Maestro Desk.\n\n` +
          `Set your password using the link below (valid for 1 hour):\n${link}\n\n` +
          `If you weren't expecting this, you can ignore this email.`,
        fromEmail: env.POSTMARK_OUTBOUND_FROM,
        fromName: 'Maestro Desk',
      });
    },
  },
  plugins: [bearer()],
  user: {
    modelName: 'users',
    // Map Better Auth's camelCase fields onto our snake_case columns.
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  advanced: {
    database: {
      // Defer id generation to the DB (`users.id` defaults to
      // gen_random_uuid()), so new users keep uuid ids.
      generateId: false,
    },
  },
});
