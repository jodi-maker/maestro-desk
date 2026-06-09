import { Hono } from 'hono';
import { env } from '../lib/env.ts';
import { processPendingDeliveries } from '../lib/outgoing-webhooks.ts';
import { processCsatReminders } from '../lib/csat-survey.ts';

// Vercel Cron endpoints (Step 6). Vercel invokes these with a GET on the
// schedule in vercel.json and sends `Authorization: Bearer ${CRON_SECRET}`;
// we reject anything without the matching secret. On the Hobby plan crons fire
// once/day, so webhook FIRST attempts go out inline at the event
// (lib/outgoing-webhooks) — these endpoints are the retry sweep + the daily
// CSAT reminder pass. The underlying processX functions claim work with
// FOR UPDATE SKIP LOCKED / a conditional UPDATE, so a duplicate invocation is
// safe.
export const cron = new Hono();

cron.use('*', async (c, next) => {
  const secret = env.CRON_SECRET;
  // No secret configured → endpoint is closed (local dev uses the in-process
  // worker instead). With a secret, require the exact bearer Vercel sends.
  if (!secret || c.req.header('Authorization') !== `Bearer ${secret}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

cron.get('/webhook-retry', async (c) => {
  const { processed } = await processPendingDeliveries(null);
  return c.json({ ok: true, processed });
});

cron.get('/csat-reminders', async (c) => {
  const sent = await processCsatReminders(null);
  return c.json({ ok: true, sent });
});
