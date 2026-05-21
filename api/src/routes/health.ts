import { Hono } from 'hono';
import { supabaseAdmin } from '../lib/supabase.ts';

export const health = new Hono();

// Cheap liveness probe — no DB roundtrip.
health.get('/', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// Readiness — proves the API can reach Supabase + the schema is the one we expect.
health.get('/ready', async (c) => {
  const { count, error } = await supabaseAdmin
    .from('workspaces')
    .select('*', { count: 'exact', head: true });
  if (error) return c.json({ ok: false, error: error.message }, 503);
  return c.json({ ok: true, workspaces: count ?? 0 });
});
