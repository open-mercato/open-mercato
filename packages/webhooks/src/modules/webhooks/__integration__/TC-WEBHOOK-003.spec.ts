import { expect, test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';

test.describe('TC-WEBHOOK-003: Inbound webhook receiver', () => {
  test('should accept valid inbound webhooks, mark duplicates, and reject invalid endpoints or signatures', async ({ request }) => {
    const messageId = `msg-${Date.now()}`;
    const payload = {
      type: 'mock.inbound.received',
      timestamp: new Date().toISOString(),
      data: {
        externalId: `ext-${Date.now()}`,
      },
    };

    const firstResponse = await request.fetch(`${BASE_URL}/api/webhooks/inbound/mock_inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-webhook-signature': 'valid',
        'webhook-id': messageId,
        'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'webhook-signature': 'v1,mock',
      },
      data: JSON.stringify(payload),
    });
    expect(firstResponse.status()).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({ ok: true });

    const duplicateResponse = await request.fetch(`${BASE_URL}/api/webhooks/inbound/mock_inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-webhook-signature': 'valid',
        'webhook-id': messageId,
        'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'webhook-signature': 'v1,mock',
      },
      data: JSON.stringify(payload),
    });
    expect(duplicateResponse.status()).toBe(200);
    await expect(duplicateResponse.json()).resolves.toEqual({ ok: true, duplicate: true });

    const invalidSignatureResponse = await request.fetch(`${BASE_URL}/api/webhooks/inbound/mock_inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-webhook-signature': 'invalid',
      },
      data: JSON.stringify(payload),
    });
    expect(invalidSignatureResponse.status()).toBe(400);
    await expect(invalidSignatureResponse.json()).resolves.toEqual({ error: 'Verification failed' });

    const unknownEndpointResponse = await request.fetch(`${BASE_URL}/api/webhooks/inbound/missing_endpoint`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-webhook-signature': 'valid',
      },
      data: JSON.stringify(payload),
    });
    expect(unknownEndpointResponse.status()).toBe(404);
    await expect(unknownEndpointResponse.json()).resolves.toEqual({ error: 'Webhook endpoint not found' });
  });
});
