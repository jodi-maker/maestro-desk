import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.ts';

export const tickets = new Hono();

tickets.use('*', requireAuth);

// Pagination is offset-based for the skeleton; switch to keyset before
// ticket volumes get serious. Scoping is explicit because the API uses
// the service-role client (see comment in middleware/auth.ts).
tickets.get('/', async (c) => {
  const sb = c.get('sb');
  const workspaceId = c.get('workspaceId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const { data, error, count } = await sb
    .from('tickets')
    .select(
      'id, display_id, subject, status_key, priority_key, category_key, assigned_user_id, customer_id, sla_state, created_at, updated_at',
      { count: 'exact' },
    )
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ tickets: data, total: count ?? 0, limit, offset });
});

const CreateTicket = z.object({
  subject: z.string().min(1).max(500),
  customer_id: z.string().uuid(),
  status_key: z.string().default('open'),
  priority_key: z.string().default('normal'),
  category_key: z.string().optional(),
  initial_message: z.string().min(1).optional(),
});

tickets.post('/', async (c) => {
  const sb = c.get('sb');
  const workspaceId = c.get('workspaceId');
  const userId = c.get('userId');

  const body = await c.req.json().catch(() => null);
  const parsed = CreateTicket.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  // display_id allocation is a placeholder — replace with a per-workspace
  // sequence (or trigger) before this is exposed to real users.
  const displayId = `TK-${Math.floor(Math.random() * 900000 + 100000)}`;

  const { data: ticket, error: tErr } = await sb
    .from('tickets')
    .insert({
      workspace_id: workspaceId,
      display_id: displayId,
      subject: input.subject,
      customer_id: input.customer_id,
      status_key: input.status_key,
      priority_key: input.priority_key,
      category_key: input.category_key ?? null,
      assigned_user_id: userId,
    })
    .select('id, display_id')
    .single();
  if (tErr) return c.json({ error: tErr.message }, 500);

  if (input.initial_message) {
    const { error: mErr } = await sb.from('ticket_messages').insert({
      workspace_id: workspaceId,
      ticket_id: ticket.id,
      role: 'customer',
      author_label: 'API caller',
      body: input.initial_message,
    });
    if (mErr) return c.json({ error: mErr.message, ticket }, 500);
  }

  return c.json({ ticket }, 201);
});
