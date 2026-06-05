import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import { Pool } from 'pg';
import { env } from './env.ts';

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
export const auth = betterAuth({
  database: new Pool({ connectionString: env.DATABASE_URL }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
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
