import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { getDb } from '../lib/db.js';
import { workerFetch, workerMaestroConfigured } from '../lib/maestro.js';

// Migration to Neon — Step 3. Member-level, workspace-scoped via getDb().
export const customers = new Hono();

customers.use('*', requireAuth);

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

// Create (or find) a local customer from a live Maestro player — so an agent can
// proactively open a conversation with someone who has NEVER contacted support
// (and therefore has no local record yet). The caller passes one lookup key; we
// re-fetch the authoritative player with the app token (never trust client PII),
// upsert by email within the workspace, and return the customer id. The SPA then
// opens a ticket against it via the normal POST /api/v1/tickets path.
customers.post('/from-player', async (c) => {
  const sql = getDb();
  const workspaceId = c.get('workspaceId');
  if (!workerMaestroConfigured()) return c.json({ error: 'Player lookup is not configured.' }, 503);
  const brandId = c.req.header('X-Brand-Id');
  if (!brandId) return c.json({ error: 'X-Brand-Id header required.' }, 400);

  const body = (await c.req.json().catch(() => null)) as
    | { email?: string; memberId?: string; maestroUserId?: string }
    | null;
  const key = body?.email
    ? { email: body.email }
    : body?.memberId
      ? { memberId: body.memberId }
      : body?.maestroUserId
        ? { maestroUserId: body.maestroUserId }
        : null;
  if (!key) return c.json({ error: 'Provide one of email, memberId or maestroUserId.' }, 400);

  let m: Record<string, unknown>;
  try {
    m = await workerFetch<Record<string, unknown>>('/api/v1/proxy/member/lookup', { brandId, query: key });
  } catch {
    return c.json({ error: 'Could not reach Maestro to resolve the player.' }, 502);
  }
  if (!m || m.success === false || m.errorCode === 101) {
    return c.json({ error: 'No matching player found.' }, 404);
  }

  const email = str(m.email);
  if (!email) return c.json({ error: 'Player has no email on file; cannot start a conversation.' }, 422);

  const existing = await sql<{ id: string }[]>`
    select id from customers
    where workspace_id = ${workspaceId} and email = ${email} and deleted_at is null
    limit 1
  `;
  if (existing.length) return c.json({ customer: { id: existing[0].id }, created: false });

  const displayId = `M${String(Math.floor(Math.random() * 9000 + 1000))}`;
  const [created] = await sql<{ id: string }[]>`
    insert into customers
      (workspace_id, display_id, first_name, last_name, username, email, mobile, vip_tier, jurisdiction, kyc_status)
    values
      (${workspaceId}, ${displayId}, ${str(m.firstName)}, ${str(m.lastName)}, ${str(m.username)},
       ${email}, ${str(m.mobile)}, ${str(m.vipLevel)}, ${str(m.country)}, ${str(m.kycStatus)})
    returning id
  `;
  return c.json({ customer: { id: created.id }, created: true }, 201);
});

// List customers in the active workspace. Returns the raw DB shape; the SPA
// remaps to its camelCase view model. No pagination yet (small in v1).
customers.get('/', async (c) => {
  const sql = getDb();
  const workspaceId = c.get('workspaceId');

  const rows = await sql`
    select id, display_id, first_name, last_name, username, email, mobile, brand, vip_tier,
           jurisdiction, consent, kyc_status, since, backoffice_url, erased_at, created_at,
           email_bounce_state, email_last_bounce_type, email_last_bounce_at, email_bounce_count
    from customers
    where workspace_id = ${workspaceId} and deleted_at is null
    order by display_id asc
  `;
  return c.json({ customers: rows });
});
