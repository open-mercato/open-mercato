import { expect, test } from '@playwright/test';
import {
  composeInternalMessage,
  decodeJwtSubject,
  deleteMessageAccessTokenIfExists,
  deleteMessageIfExists,
  readMessageAccessTokenUseCount,
  seedMessageAccessToken,
} from './helpers';

/**
 * TC-API-MSG-020: Public Token-Based Access to Message Detail
 * Surface: packages/core/src/modules/messages/api/token/[token]/route.ts (GET, requireAuth:false)
 *
 * Tokens are minted internally and stored hashed, so we seed rows directly with
 * the same HMAC hash the route derives from the URL token (the seed helper hashes
 * the raw sentinel; the run and app server share JWT_SECRET). This exercises the
 * DB-state-dependent lifecycle the route unit tests cannot: invalid (404), valid
 * consume (200 + use_count increment), expired (410), and exhausted (409). The
 * auth-preflight/recipient branches are covered by the route unit tests.
 */
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';
const MAX_TOKEN_USE_COUNT = 25;

test.describe('TC-API-MSG-020: Public Token-Based Access', () => {
  test('should enforce token validity, expiry, and usage limits', async ({ request }) => {
    const timestamp = Date.now();
    const validToken = `tc-api-msg-020-valid-${timestamp}`;
    const expiredToken = `tc-api-msg-020-expired-${timestamp}`;
    const exhaustedToken = `tc-api-msg-020-exhausted-${timestamp}`;

    let messageId: string | null = null;
    let adminToken: string | null = null;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-API-MSG-020 ${timestamp}`,
        body: `Token-accessible body ${timestamp}`,
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;
      const recipientUserId = decodeJwtSubject(fixture.recipientToken);

      await seedMessageAccessToken({
        messageId,
        recipientUserId,
        token: validToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      await seedMessageAccessToken({
        messageId,
        recipientUserId,
        token: expiredToken,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      await seedMessageAccessToken({
        messageId,
        recipientUserId,
        token: exhaustedToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        useCount: MAX_TOKEN_USE_COUNT,
      });

      // Unknown token -> 404.
      const invalid = await request.get(`${BASE_URL}/api/messages/token/tc-api-msg-020-missing-${timestamp}`);
      expect(invalid.status()).toBe(404);

      // Valid token -> 200 with message detail; no action-required objects so no auth needed.
      const valid = await request.get(`${BASE_URL}/api/messages/token/${validToken}`);
      expect(valid.status()).toBe(200);
      const validBody = (await valid.json()) as {
        id?: unknown;
        subject?: unknown;
        requiresAuth?: unknown;
        recipientUserId?: unknown;
      };
      expect(validBody.id).toBe(messageId);
      expect(typeof validBody.subject).toBe('string');
      expect(validBody.requiresAuth).toBe(false);
      expect(validBody.recipientUserId).toBe(recipientUserId);

      // The consume command incremented the usage counter.
      expect(await readMessageAccessTokenUseCount(validToken)).toBe(1);

      // Expired token -> 410.
      const expired = await request.get(`${BASE_URL}/api/messages/token/${expiredToken}`);
      expect(expired.status()).toBe(410);

      // Usage-exhausted token -> 409.
      const exhausted = await request.get(`${BASE_URL}/api/messages/token/${exhaustedToken}`);
      expect(exhausted.status()).toBe(409);
    } finally {
      await deleteMessageAccessTokenIfExists(validToken);
      await deleteMessageAccessTokenIfExists(expiredToken);
      await deleteMessageAccessTokenIfExists(exhaustedToken);
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
