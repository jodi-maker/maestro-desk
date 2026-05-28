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

// Full ticket detail — the row itself plus all of its child collections.
// Used by the SPA's ticket-detail view to populate the conversation thread,
// tags, AI tags, and time entries that aren't returned by the list endpoint.
//
// 4 parallel queries instead of one big embedded select — clearer to read
// and to debug, with no measurable latency cost at v1 scale.
tickets.get('/:id', async (c) => {
  const sb = c.get('sb');
  const workspaceId = c.get('workspaceId');
  const ticketId = c.req.param('id');

  const { data: ticket, error: tErr } = await sb
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle();
  if (tErr) return c.json({ error: tErr.message }, 500);
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  const [msgsRes, tagsRes, aiTagsRes, timeRes] = await Promise.all([
    sb.from('ticket_messages')
      .select('id, role, author_user_id, author_label, body, mentions, created_at')
      .eq('ticket_id', ticketId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
    sb.from('ticket_tags')
      .select('tag')
      .eq('ticket_id', ticketId),
    sb.from('ticket_ai_tags')
      .select('tag, confidence, accepted')
      .eq('ticket_id', ticketId)
      .order('confidence', { ascending: false }),
    sb.from('time_entries')
      .select('id, user_id, minutes, note, billable, created_at, users(name)')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false }),
  ]);

  const firstErr = [msgsRes, tagsRes, aiTagsRes, timeRes].find((r) => r.error);
  if (firstErr?.error) return c.json({ error: firstErr.error.message }, 500);

  return c.json({
    ticket: {
      ...ticket,
      messages:     msgsRes.data || [],
      tags:         (tagsRes.data || []).map((r: any) => r.tag),
      ai_tags:      aiTagsRes.data || [],
      time_entries: (timeRes.data || []).map((te: any) => ({
        id:         te.id,
        user_id:    te.user_id,
        user_name:  te.users?.name || null,
        minutes:    te.minutes,
        note:       te.note,
        billable:   te.billable,
        created_at: te.created_at,
      })),
    },
  });
});

// ─── PATCH /:id — update status / priority / assignment / category ───────
//
// All fields optional; only provided ones are written. Empty body is a
// 400 (probably a client bug, fail loudly). assigned_user_id may be null
// to unassign.
const PatchTicket = z.object({
  status_key:       z.string().optional(),
  priority_key:     z.string().optional(),
  category_key:     z.string().nullable().optional(),
  assigned_user_id: z.string().uuid().nullable().optional(),
}).strict();

tickets.patch('/:id', async (c) => {
  const sb = c.get('sb');
  const workspaceId = c.get('workspaceId');
  const ticketId = c.req.param('id');

  const body = await c.req.json().catch(() => null);
  const parsed = PatchTicket.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  // Workspace-scope check before the update so an attacker with a valid
  // ticket UUID from another workspace can't blind-write through the
  // service-role client. The update's .eq('workspace_id') below makes the
  // write a no-op in that case anyway, but the explicit 404 is clearer.
  const { data: existing, error: lookupErr } = await sb
    .from('tickets')
    .select('id')
    .eq('id', ticketId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle();
  if (lookupErr) return c.json({ error: lookupErr.message }, 500);
  if (!existing)  return c.json({ error: 'Ticket not found' }, 404);

  const { data: updated, error: updErr } = await sb
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .eq('workspace_id', workspaceId)
    .select('id, display_id, status_key, priority_key, category_key, assigned_user_id, sla_state, updated_at')
    .single();
  if (updErr) return c.json({ error: updErr.message }, 500);

  return c.json({ ticket: updated });
});

// ─── POST /:id/messages — agent reply or internal note ───────────────────
const PostMessage = z.object({
  role:     z.enum(['agent', 'note']),
  body:     z.string().min(1),
  mentions: z.array(z.string().uuid()).optional(),
});

tickets.post('/:id/messages', async (c) => {
  const sb = c.get('sb');
  const workspaceId = c.get('workspaceId');
  const userId = c.get('userId');
  const ticketId = c.req.param('id');

  const reqBody = await c.req.json().catch(() => null);
  const parsed = PostMessage.safeParse(reqBody);
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  const { data: ticket, error: tErr } = await sb
    .from('tickets')
    .select('id')
    .eq('id', ticketId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle();
  if (tErr) return c.json({ error: tErr.message }, 500);
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  // Resolve author display name from public.users so the row carries the
  // canonical name without trusting the client.
  const { data: user, error: uErr } = await sb
    .from('users')
    .select('name, email')
    .eq('id', userId)
    .maybeSingle();
  if (uErr) return c.json({ error: uErr.message }, 500);
  const authorLabel = user?.name || user?.email || 'Agent';

  const { data: message, error: mErr } = await sb
    .from('ticket_messages')
    .insert({
      workspace_id:   workspaceId,
      ticket_id:      ticketId,
      role:           input.role,
      author_user_id: userId,
      author_label:   authorLabel,
      body:           input.body,
      mentions:       input.mentions || [],
    })
    .select('id, role, author_user_id, author_label, body, mentions, created_at')
    .single();
  if (mErr) return c.json({ error: mErr.message }, 500);

  return c.json({ message }, 201);
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
