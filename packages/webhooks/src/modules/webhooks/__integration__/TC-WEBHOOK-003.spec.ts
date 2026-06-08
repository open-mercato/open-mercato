import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';

// Mirrors the create-app mock inbound webhook adapter, which verifies an HMAC-SHA256
// signature over the raw request body in the x-mock-webhook-signature header. The running
// app resolves its secret from MOCK_INBOUND_WEBHOOK_SECRET (exported by the CI workflow so
// it works even when `yarn start` forces NODE_ENV=production); we read the SAME env var here
// so the test signs with the same key. The dev fallback is only a local-default convenience.
const MOCK_INBOUND_WEBHOOK_SECRET =
  process.env.MOCK_INBOUND_WEBHOOK_SECRET?.trim() || 'open-mercato-mock-dev-inbound-webhook-secret';

function signMockInboundWebhook(rawBody: string): string {
  return createHmac('sha256', MOCK_INBOUND_WEBHOOK_SECRET).update(rawBody, 'utf-8').digest('hex');
}

test.describe('TC-WEBHOOK-003: Inbound webhook receiver', () => {
  test('should accept valid inbound webhooks, mark duplicates, and reject invalid endpoints or signatures', async ({ request }) => {
    const messageId = `msg-${Date.now()}`;
    const replayTimestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      type: 'mock.inbound.received',
      timestamp: new Date().toISOString(),
      data: {
        externalId: `ext-${Date.now()}`,
      },
    };
    const rawBody = JSON.stringify(payload);
    const validSignature = signMockInboundWebhook(rawBody);

    const firstResponse = await request.fetch(`${BASE_URL}/api/webhooks/inbound/mock_inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-webhook-signature': validSignature,
        'webhook-id': messageId,
        'webhook-timestamp': replayTimestamp,
        'webhook-signature': 'v1,mock',
      },
      data: rawBody,
    });
    expect(firstResponse.status()).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({ ok: true });

    const duplicateResponse = await request.fetch(`${BASE_URL}/api/webhooks/inbound/mock_inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-webhook-signature': validSignature,
        'webhook-id': messageId,
        'webhook-timestamp': replayTimestamp,
        'webhook-signature': 'v1,mock',
      },
      data: rawBody,
    });
    expect(duplicateResponse.status()).toBe(200);
    await expect(duplicateResponse.json()).resolves.toEqual({ ok: true, duplicate: true });

    const replayWithoutMessageIdResponse = await request.fetch(`${BASE_URL}/api/webhooks/inbound/mock_inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-webhook-signature': validSignature,
        'webhook-timestamp': replayTimestamp,
        'webhook-signature': 'v1,mock',
      },
      data: rawBody,
    });
    expect(replayWithoutMessageIdResponse.status()).toBe(200);
    await expect(replayWithoutMessageIdResponse.json()).resolves.toEqual({ ok: true });

    const replayWithoutMessageIdDuplicateResponse = await request.fetch(`${BASE_URL}/api/webhooks/inbound/mock_inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-webhook-signature': validSignature,
        'webhook-timestamp': replayTimestamp,
        'webhook-signature': 'v1,mock',
      },
      data: rawBody,
    });
    expect(replayWithoutMessageIdDuplicateResponse.status()).toBe(200);
    await expect(replayWithoutMessageIdDuplicateResponse.json()).resolves.toEqual({ ok: true, duplicate: true });

    const invalidSignatureResponse = await request.fetch(`${BASE_URL}/api/webhooks/inbound/mock_inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-webhook-signature': 'invalid',
      },
      data: rawBody,
    });
    expect(invalidSignatureResponse.status()).toBe(400);
    await expect(invalidSignatureResponse.json()).resolves.toEqual({ error: 'Verification failed' });

    const unknownEndpointResponse = await request.fetch(`${BASE_URL}/api/webhooks/inbound/missing_endpoint`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-webhook-signature': validSignature,
      },
      data: rawBody,
    });
    expect(unknownEndpointResponse.status()).toBe(404);
    await expect(unknownEndpointResponse.json()).resolves.toEqual({ error: 'Webhook endpoint not found' });
  });
});
