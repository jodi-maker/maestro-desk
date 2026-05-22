import { env } from './env.ts';

// ─── Postmark Domains API ────────────────────────────────────────────────
//
// Domain-level DKIM + Return-Path verification. Once a brand verifies their
// domain (acme.com), ANY sender on that domain (support@, billing@, …) can
// send via Postmark with proper authentication. This is the right primitive
// for white-label — verify once, send from anything.
//
// API base:    https://api.postmarkapp.com
// Auth header: X-Postmark-Account-Token (NOT X-Postmark-Server-Token —
//              Domains/Senders are account-level resources, not per-server)
// Docs:        https://postmarkapp.com/developer/api/domains-api
//
// Endpoints used:
//   POST   /domains                          create
//   GET    /domains/:id                      get (includes DNS records + verification state)
//   PUT    /domains/:id/verifyDkim           trigger DKIM check against DNS
//   PUT    /domains/:id/verifyReturnPath     trigger Return-Path check against DNS
//   DELETE /domains/:id                      delete (offboard a brand)
//
// Verification is two-step from the brand's perspective:
//   1. We POST /domains → returns DNS records (DKIM TXT + Return-Path CNAME).
//   2. Brand pastes those records into their DNS.
//   3. Brand (or god UI) hits our verify endpoint → we PUT verifyDkim +
//      verifyReturnPath → Postmark queries DNS → returns updated flags.

const ENDPOINT = 'https://api.postmarkapp.com';

// Postmark Domain object shape — subset of fields we care about. The full
// response also includes DKIMPendingHost/TextValue, etc. for key-rotation
// flows; we ignore those for v1.
export interface PostmarkDomain {
  ID: number;
  Name: string;
  // DKIM
  DKIMVerified: boolean;
  DKIMHost: string;          // e.g. "20231115._domainkey"
  DKIMTextValue: string;     // the long TXT record value
  // Return-Path
  ReturnPathDomain: string;        // e.g. "pm-bounces.acme.com"
  ReturnPathDomainVerified: boolean;
  ReturnPathDomainCNAMEValue: string;  // e.g. "pm.mtasv.net"
}

export class PostmarkAccountError extends Error {
  constructor(message: string, public httpStatus: number, public code?: number) {
    super(message);
  }
}

export class PostmarkAccountNotConfiguredError extends Error {
  constructor() {
    super('Postmark Domains API is not configured (POSTMARK_ACCOUNT_TOKEN is empty)');
  }
}

export function isPostmarkAccountConfigured(): boolean {
  return Boolean(env.POSTMARK_ACCOUNT_TOKEN);
}

async function pmFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  if (!isPostmarkAccountConfigured()) {
    throw new PostmarkAccountNotConfiguredError();
  }
  const res = await fetch(`${ENDPOINT}${path}`, {
    ...init,
    headers: {
      'X-Postmark-Account-Token': env.POSTMARK_ACCOUNT_TOKEN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as { Message?: string; ErrorCode?: number };
  if (!res.ok) {
    throw new PostmarkAccountError(
      `Postmark Domains API ${res.status}: ${body.Message ?? res.statusText}`,
      res.status,
      body.ErrorCode,
    );
  }
  return body;
}

/** Create a domain. Postmark returns DNS records for the brand to set up. */
export async function createDomain(name: string): Promise<PostmarkDomain> {
  return (await pmFetch('/domains', {
    method: 'POST',
    body: JSON.stringify({ Name: name }),
  })) as PostmarkDomain;
}

/** Fetch current state (DNS records + verification flags). */
export async function getDomain(id: number): Promise<PostmarkDomain> {
  return (await pmFetch(`/domains/${id}`)) as PostmarkDomain;
}

/**
 * Trigger DNS verification for both DKIM and Return-Path. Postmark queries
 * the brand's DNS; the returned object reflects the post-check state. Run
 * in sequence (not parallel) — both calls hit the same domain object and
 * Postmark's API can race if they overlap.
 */
export async function verifyDomain(id: number): Promise<PostmarkDomain> {
  await pmFetch(`/domains/${id}/verifyDkim`, { method: 'PUT' });
  return (await pmFetch(`/domains/${id}/verifyReturnPath`, { method: 'PUT' })) as PostmarkDomain;
}

/** Delete the domain at Postmark. Used when a brand offboards. */
export async function deleteDomain(id: number): Promise<void> {
  await pmFetch(`/domains/${id}`, { method: 'DELETE' });
}

/** A domain is "fully verified" only when BOTH DKIM and Return-Path resolve. */
export function isFullyVerified(d: PostmarkDomain): boolean {
  return d.DKIMVerified && d.ReturnPathDomainVerified;
}
