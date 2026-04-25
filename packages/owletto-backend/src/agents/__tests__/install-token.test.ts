import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isInstallTokenMessage,
  mintInstallToken,
  verifyInstallToken,
} from '../install-token';

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

describe('install-token', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });
  afterAll(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  describe('mint + verify round-trip', () => {
    it('verifies a freshly minted token', () => {
      const token = mintInstallToken({
        userId: 'user_abc',
        templateAgentId: 'agent_xyz',
      });
      expect(token.startsWith('install:')).toBe(true);

      const result = verifyInstallToken(token);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.userId).toBe('user_abc');
        expect(result.templateAgentId).toBe('agent_xyz');
        expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      }
    });

    it('detects tampered payload via HMAC mismatch', () => {
      const token = mintInstallToken({
        userId: 'user_abc',
        templateAgentId: 'agent_xyz',
      });
      const [head, sig] = token.slice('install:'.length).split('.');
      const tamperedPayload = Buffer.from(
        JSON.stringify({ u: 'attacker', t: 'agent_xyz', e: Math.floor(Date.now() / 1000) + 600 })
      ).toString('base64url');
      const tampered = `install:${tamperedPayload}.${sig}`;
      const result = verifyInstallToken(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('bad_signature');
      expect(head).toBeTruthy();
    });

    it('rejects expired tokens', () => {
      const token = mintInstallToken({
        userId: 'user_abc',
        templateAgentId: 'agent_xyz',
        ttlSeconds: -1,
      });
      const result = verifyInstallToken(token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('expired');
    });

    it('rejects malformed tokens', () => {
      expect(verifyInstallToken('not a token').ok).toBe(false);
      expect(verifyInstallToken('install:').ok).toBe(false);
      expect(verifyInstallToken('install:abc').ok).toBe(false);
      expect(verifyInstallToken('install:abc.def').ok).toBe(false);
    });

    it('rejects tokens minted with a different secret', () => {
      const token = mintInstallToken({
        userId: 'user_abc',
        templateAgentId: 'agent_xyz',
      });
      const oldKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY =
        'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      const result = verifyInstallToken(token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('bad_signature');
      process.env.ENCRYPTION_KEY = oldKey;
    });
  });

  describe('isInstallTokenMessage', () => {
    it('accepts the canonical prefix', () => {
      expect(isInstallTokenMessage('install:abc.def')).toBe(true);
      expect(isInstallTokenMessage('   install:abc.def')).toBe(true);
    });

    it('rejects normal chat messages', () => {
      expect(isInstallTokenMessage('hello')).toBe(false);
      expect(isInstallTokenMessage('install me please')).toBe(false);
      expect(isInstallTokenMessage('install: foo')).toBe(true); // a malformed token still claims to be one
    });
  });
});
