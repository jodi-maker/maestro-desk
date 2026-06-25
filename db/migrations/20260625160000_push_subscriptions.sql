-- Web Push subscriptions for offline-agent notifications (push stage 2). One
-- row per browser/device push endpoint, owned by a user. The send path
-- (lib/push.ts) looks subscriptions up by user_id and POSTs an encrypted,
-- VAPID-signed message to each endpoint; dead endpoints (404/410) are pruned.
create table if not exists push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  endpoint      text not null unique,        -- the browser's push service URL
  p256dh        text not null,               -- client public key (payload encryption)
  auth          text not null,               -- client auth secret (payload encryption)
  user_agent    text,                        -- for the agent to recognise the device in a future manage-devices UI
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists push_subscriptions_user on push_subscriptions (user_id);
