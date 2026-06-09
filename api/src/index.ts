import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { HTTPException } from 'hono/http-exception';
import { auth } from './lib/auth.ts';
import { health } from './routes/health.ts';
import { me } from './routes/me.ts';
import { workspace } from './routes/workspace.ts';
import { savedSearches } from './routes/saved-searches.ts';
import { tickets } from './routes/tickets.ts';
import { triage } from './routes/triage.ts';
import { webhooks } from './routes/webhooks.ts';
import { god } from './routes/god.ts';
import { whoami } from './routes/whoami.ts';
import { customers } from './routes/customers.ts';
import { agents } from './routes/agents.ts';
import { inbox } from './routes/inbox.ts';
import { channels } from './routes/channels.ts';
import { workflows } from './routes/workflows.ts';
import { slaPolicies } from './routes/sla-policies.ts';
import { tags } from './routes/tags.ts';
import { kb } from './routes/kb.ts';
import { cannedResponses } from './routes/canned-responses.ts';
import { ticketTemplates } from './routes/ticket-templates.ts';
import { customFields } from './routes/custom-fields.ts';
import { assignRules } from './routes/assign-rules.ts';
import { roles } from './routes/roles.ts';
import { permissions } from './routes/permissions.ts';
import { customValues } from './routes/custom-values.ts';
import { publicRoutes } from './routes/public.ts';
import { integrations } from './routes/integrations.ts';
import { presence } from './routes/presence.ts';
import { categories } from './routes/categories.ts';
import { pubby } from './routes/pubby.ts';
import { cron } from './routes/cron.ts';

const app = new Hono();

app.use('*', logger());
app.use('*', cors({
  origin: '*',  // Tighten before exposing publicly. For local dev, * is fine.
  allowHeaders: ['Authorization', 'Content-Type', 'X-Workspace-Id'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Better Auth handler (migration to Neon — Step 2). Serves sign-in, session,
// and account endpoints under /api/auth/*. Mounted before the v1 routes; the
// v1 auth middleware will verify Better Auth sessions once the cutover lands.
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.route('/api/v1/health', health);
app.route('/api/v1/me', me);
app.route('/api/v1/workspace', workspace);
app.route('/api/v1/saved-searches', savedSearches);
app.route('/api/v1/whoami', whoami);
app.route('/api/v1/tickets', tickets);
app.route('/api/v1/tickets/:id/triage', triage);
app.route('/api/v1/customers', customers);
app.route('/api/v1/agents', agents);
app.route('/api/v1/inbox', inbox);
app.route('/api/v1/channels', channels);
app.route('/api/v1/workflows', workflows);
app.route('/api/v1/sla-policies', slaPolicies);
app.route('/api/v1/tags', tags);
app.route('/api/v1/categories', categories);
app.route('/api/v1/kb-articles', kb);
app.route('/api/v1/canned-responses', cannedResponses);
app.route('/api/v1/ticket-templates', ticketTemplates);
app.route('/api/v1/custom-fields', customFields);
app.route('/api/v1/assign-rules', assignRules);
app.route('/api/v1/roles', roles);
app.route('/api/v1/permissions', permissions);
app.route('/api/v1/custom-values', customValues);
app.route('/api/v1/public', publicRoutes);
app.route('/api/v1/integrations', integrations);
app.route('/api/v1/presence', presence);
app.route('/api/v1/pubby', pubby);
app.route('/api/v1/cron', cron);
app.route('/api/v1/webhooks', webhooks);
app.route('/api/v1/god', god);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  // Log the full error server-side; return a generic message to the client.
  // The DB error text (table/column/constraint names) is an information-leak
  // vector, so it stays in the log, not the response.
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Hosting (Step 6): export the Hono app as the default. Vercel auto-detects
// this (`src/index.ts` + `export default app`) and turns the routes into
// serverless functions — no Bun.serve, no always-on process. The background
// workers do NOT run here: on Vercel they're driven by Vercel Cron
// (routes/cron.ts) + inline delivery (lib/outgoing-webhooks waitUntil); for
// local Bun dev, src/dev.ts wraps this app in Bun.serve and starts the
// in-process workers.
export default app;
