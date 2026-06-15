// Player-context enrichment for the headless AI-draft pipeline (capability B).
//
// When the triage worker drafts a reply, it can pull the customer's live player
// record from Maestro — balance, VIP tier, KYC/RG status, recent bonuses — so
// the draft is grounded in real account state instead of guessing. This runs
// with the app's `mh_live_*` API token (no signed-in user) + X-Brand-Id, via
// lib/maestro.ts workerFetch.
//
// Everything here is BEST-EFFORT and additive: if Maestro isn't configured, the
// player can't be resolved, or any call fails, we return null and triage
// proceeds exactly as before. Player data must never block a support reply.

import { workerFetch, workerMaestroConfigured, MaestroError } from './maestro.js';

interface PlayerLookup {
  email?: string | null;
  username?: string | null;
  /** Override the install's default brand (MAESTRO_BRAND_ID) when known. */
  brandId?: string | null;
}

// Maestro member records are deliberately loosely typed here — the gateway owns
// the canonical shape and we only read a curated, defensive subset.
type Member = Record<string, unknown>;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function pick(obj: Member, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = str(obj[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Resolve the player and return a compact, prompt-ready context block, or null
 * if nothing usable could be fetched. The block is plain text designed to drop
 * straight into the triage user message.
 */
export async function buildPlayerContext(lookup: PlayerLookup): Promise<string | null> {
  if (!workerMaestroConfigured()) return null;
  if (!lookup.email && !lookup.username) return null;

  let member: Member | null = null;
  try {
    const res = await workerFetch<{ members?: Member[]; data?: Member[] } | Member[]>(
      '/api/v1/proxy/members',
      {
        brandId: lookup.brandId ?? null,
        query: { email: lookup.email ?? undefined, username: lookup.username ?? undefined, limit: 1 },
      },
    );
    const list = Array.isArray(res) ? res : (res.members ?? res.data ?? []);
    member = list[0] ?? null;
  } catch (err) {
    // 404 (no such player) is expected and quiet; log anything else once.
    if (err instanceof MaestroError && err.status !== 404) {
      console.warn('[player-context] member lookup failed:', err.status, err.message);
    }
    return null;
  }
  if (!member) return null;

  const lines: string[] = [];
  const id = pick(member, 'id', 'memberId', 'playerId');
  const status = pick(member, 'status', 'accountStatus');
  const vip = pick(member, 'vipTier', 'vipLevel', 'tier');
  const kyc = pick(member, 'kycStatus', 'kyc');
  const reg = pick(member, 'registeredAt', 'createdAt', 'since');

  // Balance may be nested ({ balance: { amount, currency } }) or flat.
  const balObj = (member.balance ?? member.wallet) as Member | undefined;
  const balance =
    pick(member, 'balance', 'walletBalance') ??
    (balObj && typeof balObj === 'object'
      ? [str(balObj.amount), str(balObj.currency)].filter(Boolean).join(' ') || null
      : null);

  if (status) lines.push(`Account status: ${status}`);
  if (vip) lines.push(`VIP tier: ${vip}`);
  if (balance) lines.push(`Balance: ${balance}`);
  if (kyc) lines.push(`KYC: ${kyc}`);
  if (reg) lines.push(`Registered: ${reg}`);

  // Responsible-gambling state is high-signal for support tone — fetch it
  // separately (scope rg:read); ignore failures.
  if (id) {
    try {
      const rg = await workerFetch<Member>(`/api/v1/proxy/members/${encodeURIComponent(id)}/rg`, {
        brandId: lookup.brandId ?? null,
      });
      const selfExcluded = str(rg.selfExcluded ?? rg.self_excluded);
      const limits = str(rg.depositLimit ?? rg.limits);
      const rgStatus = pick(rg, 'status', 'rgStatus');
      if (selfExcluded === 'true') lines.push('RG: SELF-EXCLUDED — do not encourage further play');
      else if (rgStatus) lines.push(`RG status: ${rgStatus}`);
      if (limits) lines.push(`RG limits: ${limits}`);
    } catch {
      /* rg endpoint unavailable — skip */
    }
  }

  if (lines.length === 0) return null;
  return `PLAYER CONTEXT (live, from Maestro — use only what's relevant; never expose internal ids):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}
