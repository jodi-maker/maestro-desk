import { z } from 'zod';

const Env = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  ANTHROPIC_API_KEY: z.string().min(20),
  // Basic-Auth credentials Postmark uses on the inbound webhook. Embed in the
  // webhook URL: https://<user>:<pass>@<tunnel-host>/api/v1/webhooks/postmark/inbound
  POSTMARK_INBOUND_USER: z.string().min(1),
  POSTMARK_INBOUND_PASS: z.string().min(8),
  PORT: z.coerce.number().int().positive().default(3001),
});

export const env = Env.parse(process.env);
export type Env = z.infer<typeof Env>;
