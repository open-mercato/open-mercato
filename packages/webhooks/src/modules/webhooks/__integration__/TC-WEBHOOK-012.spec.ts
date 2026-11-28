import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { readIntegrationEnvFlag } from '@open-mercato/core/helpers/integration/standaloneEnv';
import {
  createWebhookFixture,
  deleteWebhookIfExists,
  type WebhookTestDeliveryResponse,
} from './helpers/fixtures';

/**
 * TC-WEBHOOK-012: Outbound delivery bounds the receiver's response body
 * Source: https://github.com/open-mercato/open-mercato/issues/7226
 *
 * The delivery timeout covers reading the response body: a receiver that stalls
 * after its headers is classified by its status, with the body received so far.
 * Only the first 4 KiB of the body is read before the rest is cancelled.
 *
 * Requires the app to run as a host process with OM_WEBHOOKS_ALLOW_PRIVATE_URLS=1
 * so it can reach the loopback receiver hosted by this worker. Each test first
 * delivers to the receiver's /ping route and skips when the app cannot reach it.
 */
const RESPONSE_BODY_LIMIT_BYTES = 4096;
const LARGE_BODY_BYTES = 64 * 1024 * 1024;
const LARGE_BODY_CHUNK = Buffer.alloc(64 * 1024, 'x');
const DELIVERY_TIMEOUT_MS = 1_000;

type ReceiverState = {
  largeBodyBytesWritten: number;
  largeBodyCompleted: boolean;
  largeBodyClosed: Promise<void>;
};

async function startReceiver(): Promise<{ server: http.Server; baseUrl: string; state: ReceiverState }> {
  let markLargeBodyClosed: () => void = () => undefined;
  const state: ReceiverState = {
    largeBodyBytesWritten: 0,
    largeBodyCompleted: false,
    largeBodyClosed: new Promise<void>((resolve) => {
      markLargeBodyClosed = resolve;
    }),
  };

  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/ping') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('pong');
      return;
    }

    if (req.url === '/stall') {
      res.writeHead(200, { 'content-type': 'text/plain', 'x-receiver': 'stall' });
      res.write('partial');
      return;
    }

    if (req.url === '/large') {
      res.writeHead(200, { 'content-type': 'text/plain', 'x-receiver': 'large' });
      res.on('close', () => markLargeBodyClosed());
      const writeMore = () => {
        while (state.largeBodyBytesWritten < LARGE_BODY_BYTES) {
          state.largeBodyBytesWritten += LARGE_BODY_CHUNK.length;
          if (!res.write(LARGE_BODY_CHUNK)) {
            res.once('drain', writeMore);
            return;
          }
        }
        state.largeBodyCompleted = true;
        res.end();
      };
      writeMore();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, state };
}

async function stopReceiver(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function skipUnlessAppReachesReceiver(
  request: APIRequestContext,
  token: string,
  baseUrl: string,
): Promise<void> {
  let probeId: string | null = null;
  try {
    const probe = await createWebhookFixture(request, token, {
      name: `Webhook Receiver Probe ${Date.now()}`,
      url: `${baseUrl}/ping`,
      timeoutMs: 5_000,
      autoDisableThreshold: 0,
    });
    probeId = probe.id;
    const response = await apiRequest(request, 'POST', `/api/webhooks/${probe.id}/test`, {
      token,
      data: {},
      timeout: 20_000,
      retryTransport: false,
    });
    const body = await readJsonSafe<WebhookTestDeliveryResponse>(response);
    test.skip(body?.delivery.responseBody !== 'pong', 'The app cannot reach a loopback receiver hosted by the Playwright worker');
  } finally {
    await deleteWebhookIfExists(request, token, probeId);
  }
}

test.describe('TC-WEBHOOK-012: Outbound delivery bounds the response body read', () => {
  test.skip(!readIntegrationEnvFlag('OM_WEBHOOKS_ALLOW_PRIVATE_URLS'), 'Requires loopback webhook delivery (OM_WEBHOOKS_ALLOW_PRIVATE_URLS=1)');

  test('classifies a delivery by its status when the receiver stalls the body past the timeout', async ({ request }) => {
    test.setTimeout(60_000);
    const token = await getAuthToken(request);
    const { server, baseUrl } = await startReceiver();
    let webhookId: string | null = null;

    try {
      await skipUnlessAppReachesReceiver(request, token, baseUrl);
      const created = await createWebhookFixture(request, token, {
        name: `Webhook Stalled Body ${Date.now()}`,
        url: `${baseUrl}/stall`,
        timeoutMs: DELIVERY_TIMEOUT_MS,
        autoDisableThreshold: 0,
      });
      webhookId = created.id;

      const startedAt = Date.now();
      const response = await apiRequest(request, 'POST', `/api/webhooks/${created.id}/test`, {
        token,
        data: {},
        timeout: 20_000,
        retryTransport: false,
      });
      const elapsedMs = Date.now() - startedAt;

      expect(response.status()).toBe(200);
      const body = await readJsonSafe<WebhookTestDeliveryResponse>(response);
      expect(elapsedMs).toBeLessThan(DELIVERY_TIMEOUT_MS + 5_000);
      expect(body?.delivery.status).toBe('delivered');
      expect(body?.delivery.deliveredAt).not.toBeNull();
      expect(body?.delivery.responseStatus).toBe(200);
      expect(body?.delivery.responseBody).toBe('partial');
      expect(body?.delivery.responseHeaders?.['x-receiver']).toBe('stall');
      expect(body?.delivery.errorMessage).toBeNull();
      expect(body?.delivery.attemptNumber).toBe(1);
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
      await stopReceiver(server);
    }
  });

  test('stores at most 4 KiB and stops downloading a large response body', async ({ request }) => {
    test.setTimeout(60_000);
    const token = await getAuthToken(request);
    const { server, baseUrl, state } = await startReceiver();
    let webhookId: string | null = null;

    try {
      await skipUnlessAppReachesReceiver(request, token, baseUrl);
      const created = await createWebhookFixture(request, token, {
        name: `Webhook Large Body ${Date.now()}`,
        url: `${baseUrl}/large`,
        timeoutMs: 10_000,
        autoDisableThreshold: 0,
      });
      webhookId = created.id;

      const response = await apiRequest(request, 'POST', `/api/webhooks/${created.id}/test`, {
        token,
        data: {},
        timeout: 30_000,
        retryTransport: false,
      });

      expect(response.status()).toBe(200);
      const body = await readJsonSafe<WebhookTestDeliveryResponse>(response);
      expect(body?.delivery.status).toBe('delivered');
      expect(body?.delivery.responseStatus).toBe(200);
      expect(body?.delivery.responseHeaders?.['x-receiver']).toBe('large');
      const storedBody = body?.delivery.responseBody ?? '';
      expect(storedBody.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(storedBody, 'utf8')).toBeLessThanOrEqual(RESPONSE_BODY_LIMIT_BYTES);

      const connectionClosed = await Promise.race([
        state.largeBodyClosed.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
      ]);
      expect(connectionClosed).toBe(true);
      expect(state.largeBodyCompleted).toBe(false);
      expect(state.largeBodyBytesWritten).toBeLessThan(LARGE_BODY_BYTES);
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
      await stopReceiver(server);
    }
  });
});
