import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { readIntegrationEnvFlag } from '@open-mercato/core/helpers/integration/standaloneEnv';
import {
  createWebhookFixture,
  deleteWebhookIfExists,
  getDeliveryDetail,
} from './helpers/fixtures';

/**
 * TC-WEBHOOK-015: a retried webhook delivery is sent once even when its job runs more than once
 * Source: open-mercato/open-mercato#ISSUE
 *
 * The delivery worker claims a delivery (`pending` → `sending`) atomically before sending and ignores
 * jobs for deliveries that already finished, so a queue that runs a job twice cannot send the event
 * twice. In the integration env the app process starts an in-process local-queue worker on enqueue
 * while AUTO_SPAWN_WORKERS also runs the webhook worker; on main retried jobs were seen running twice.
 * Each delivery here fails its synchronous test send with a non-retryable 400, is retried once, and
 * must reach the receiver exactly once more. Needs OM_WEBHOOKS_ALLOW_PRIVATE_URLS (enabled in the integration env)
 * because the receiver listens on loopback.
 */
const PRIVATE_URLS_ALLOWED = readIntegrationEnvFlag('OM_WEBHOOKS_ALLOW_PRIVATE_URLS');
const DELIVERY_COUNT = 3;
const SETTLE_AFTER_DELIVERY_MS = 8_000;

type Receiver = {
  server: Server;
  baseUrl: string;
  statuses: (path: string) => number[];
};

async function startReceiver(): Promise<Receiver> {
  const sentByPath = new Map<string, number[]>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on('end', () => {
      const path = req.url ?? '';
      const sent = sentByPath.get(path) ?? [];
      const status = sent.length === 0 ? 400 : 200;
      sentByPath.set(path, [...sent, status]);
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: status === 200 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    statuses: (path: string) => [...(sentByPath.get(path) ?? [])],
  };
}

test.describe('TC-WEBHOOK-015: delivery jobs do not send a delivery twice', () => {
  test('each retried delivery reaches the receiver exactly once more', async ({ request }) => {
    test.skip(!PRIVATE_URLS_ALLOWED, 'The loopback receiver needs OM_WEBHOOKS_ALLOW_PRIVATE_URLS');
    test.setTimeout(120_000);
    const token = await getAuthToken(request);
    const receiver = await startReceiver();
    const webhookIds: string[] = [];

    try {
      const deliveries: Array<{ path: string; deliveryId: string }> = [];
      for (let index = 0; index < DELIVERY_COUNT; index += 1) {
        const path = `/tc-webhook-015-${index}`;
        const created = await createWebhookFixture(request, token, {
          name: `Webhook delivery claim ${index} ${Date.now()}`,
          url: `${receiver.baseUrl}${path}`,
          subscribedEvents: ['catalog.product.updated'],
        });
        webhookIds.push(created.id);
        const testResponse = await apiRequest(request, 'POST', `/api/webhooks/${created.id}/test`, { token, data: {} });
        expect(testResponse.status()).toBe(200);
        const testBody = await readJsonSafe<{ delivery: { id: string; status: string } }>(testResponse);
        expect(testBody?.delivery.status).toBe('expired');
        deliveries.push({ path, deliveryId: testBody?.delivery.id as string });
      }

      const retries = await Promise.all(deliveries.map(({ deliveryId }) =>
        apiRequest(request, 'POST', `/api/webhooks/deliveries/${deliveryId}/retry`, { token })));
      for (const retry of retries) expect(retry.status()).toBe(200);

      for (const { deliveryId } of deliveries) {
        await expect.poll(async () => (await getDeliveryDetail(request, token, deliveryId)).status, { timeout: 30_000 }).toBe('delivered');
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_AFTER_DELIVERY_MS));

      for (const { path, deliveryId } of deliveries) {
        expect(receiver.statuses(path)).toEqual([400, 200]);
        expect((await getDeliveryDetail(request, token, deliveryId)).attemptNumber).toBe(2);
      }
    } finally {
      for (const webhookId of webhookIds) await deleteWebhookIfExists(request, token, webhookId);
      await new Promise<void>((resolve) => receiver.server.close(() => resolve()));
    }
  });
});
