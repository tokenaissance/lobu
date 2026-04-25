/**
 * Install tokens — short-lived HMAC-signed claims that authorize installing
 * a specific template agent into a specific user's personal org via a
 * non-web channel (e.g. inbound WhatsApp message containing the token).
 *
 * Format:
 *   install:<base64url(payload)>.<base64url(hmac-sha256)>
 * Payload (JSON): { u: userId, t: templateAgentId, e: expiryEpochSeconds }
 *
 * Stateless — no DB row. Re-using a token within the expiry window is fine
 * (idempotent install). Once the token expires the user gets a fresh one
 * from the landing page.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_PREFIX = 'install:';
const TOKEN_TTL_SECONDS = 15 * 60;

interface TokenPayload {
  u: string; // userId
  t: string; // templateAgentId
  e: number; // expiry, epoch seconds
}

function getSecret(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is required to mint install tokens');
  }
  // Domain-separate from the encryption key by hashing once with a label.
  return createHmac('sha256', raw).update('install-token:v1').digest();
}

function base64UrlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64url');
}

function base64UrlDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function mintInstallToken(params: {
  userId: string;
  templateAgentId: string;
  ttlSeconds?: number;
}): string {
  const ttl = params.ttlSeconds ?? TOKEN_TTL_SECONDS;
  const payload: TokenPayload = {
    u: params.userId,
    t: params.templateAgentId,
    e: Math.floor(Date.now() / 1000) + ttl,
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', getSecret()).update(payloadEncoded).digest();
  return `${TOKEN_PREFIX}${payloadEncoded}.${base64UrlEncode(sig)}`;
}

interface VerifyOk {
  ok: true;
  userId: string;
  templateAgentId: string;
  expiresAt: number;
}
interface VerifyErr {
  ok: false;
  error: 'malformed' | 'bad_signature' | 'expired';
}

export function verifyInstallToken(input: string): VerifyOk | VerifyErr {
  if (!input.startsWith(TOKEN_PREFIX)) return { ok: false, error: 'malformed' };
  const body = input.slice(TOKEN_PREFIX.length).trim();
  const [payloadEncoded, sigEncoded] = body.split('.');
  if (!payloadEncoded || !sigEncoded) return { ok: false, error: 'malformed' };

  const expected = createHmac('sha256', getSecret()).update(payloadEncoded).digest();
  let provided: Buffer;
  try {
    provided = base64UrlDecode(sigEncoded);
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (provided.length !== expected.length) return { ok: false, error: 'bad_signature' };
  if (!timingSafeEqual(provided, expected)) return { ok: false, error: 'bad_signature' };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadEncoded).toString('utf8')) as TokenPayload;
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (
    typeof payload.u !== 'string' ||
    typeof payload.t !== 'string' ||
    typeof payload.e !== 'number'
  ) {
    return { ok: false, error: 'malformed' };
  }

  if (Math.floor(Date.now() / 1000) >= payload.e) {
    return { ok: false, error: 'expired' };
  }
  return {
    ok: true,
    userId: payload.u,
    templateAgentId: payload.t,
    expiresAt: payload.e,
  };
}

/** True when an inbound chat message looks like an install token claim. */
export function isInstallTokenMessage(text: string): boolean {
  return text.trim().startsWith(TOKEN_PREFIX);
}
