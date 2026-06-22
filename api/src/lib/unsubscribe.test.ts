import { describe, expect, it } from 'bun:test';
import { makeUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl } from './unsubscribe.js';

const WS = '11111111-1111-1111-1111-111111111111';
const WS2 = '22222222-2222-2222-2222-222222222222';
const CUST = '33333333-3333-3333-3333-333333333333';

describe('unsubscribe tokens', () => {
  it('round-trips a valid token back to the customer id', () => {
    const token = makeUnsubscribeToken(WS, CUST);
    expect(verifyUnsubscribeToken(WS, token)).toBe(CUST);
  });

  it('rejects a token minted for a different workspace (brand binding)', () => {
    const token = makeUnsubscribeToken(WS, CUST);
    expect(verifyUnsubscribeToken(WS2, token)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = makeUnsubscribeToken(WS, CUST);
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    expect(verifyUnsubscribeToken(WS, tampered)).toBeNull();
  });

  it('rejects a swapped customer id under the same signature', () => {
    const token = makeUnsubscribeToken(WS, CUST);
    const sig = token.slice(token.indexOf('.') + 1);
    const forged = `${Buffer.from('victim-id', 'utf8').toString('base64url')}.${sig}`;
    expect(verifyUnsubscribeToken(WS, forged)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyUnsubscribeToken(WS, '')).toBeNull();
    expect(verifyUnsubscribeToken(WS, 'nodot')).toBeNull();
    expect(verifyUnsubscribeToken(WS, '.sigonly')).toBeNull();
    expect(verifyUnsubscribeToken(WS, 'idonly.')).toBeNull();
  });

  it('builds an absolute one-click URL on the API origin', () => {
    const url = unsubscribeUrl('acme', makeUnsubscribeToken(WS, CUST));
    expect(url).toContain('/api/v1/public/acme/unsubscribe?u=');
    expect(url.startsWith('http')).toBe(true);
  });
});
