import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.ts';

// Service-role client: bypasses RLS. Use ONLY for trusted server-side work
// (workspace lookups, system tasks, signup). Never expose its key to the
// frontend or include it in error responses.
//
// Once the Supabase Custom Access Token Hook is configured to inject a
// workspace_id claim into user JWTs, we'll add a userClient(jwt) factory
// here that returns a per-request anon-key client carrying the user's JWT,
// and switch the routes to use it. RLS would then enforce isolation rather
// than app-layer scoping. See middleware/auth.ts for the rationale.
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
