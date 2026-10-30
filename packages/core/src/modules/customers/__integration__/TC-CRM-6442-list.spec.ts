import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  createDealFixture,
  deleteEntityByBody,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader';
import { createRequestContainer } from '@open-mercato/shared/lib/di/container';
import { createQueue } from '@open-mercato/queue';

const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 30_000;
const BULK_OWNER_QUEUE = 'customers-deals-bulk-update-owner';

const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim();
const APP_ROOT = TEST_APP_ROOT
  ? path.resolve(TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato');
const APP_QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue');

if (!TEST_APP_ROOT) {
  process.env.QUEUE_BASE_DIR = APP_QUEUE_BASE_DIR;
}

/**
 * Drains the local file-based queue in-process. CI's integration harness does not start worker
 * processes, so without this the bulk owner job stays `pending` forever. Mirrors TC-CRM-069,
 * which documents the full rationale.
 */
async function drainQueue(queueName: string): Promise<number> {
  const data = await bootstrapFromAppRoot(APP_ROOT);
  const worker = data.modules
    .flatMap((module) => module.workers ?? [])
    .find((entry) => entry.queue === queueName);
  if (!worker) return 0;

  const container = await createRequestContainer();
  const queue = createQueue(queueName, 'local', { baseDir: APP_QUEUE_BASE_DIR, concurrency: 1 });
  const resolve = <T = unknown>(name: string): T => container.resolve(name) as T;

  try {
    let processedJobs = 0;
    while (true) {
      const result = await queue.process(
        async (job, ctx) => {
          await Promise.resolve(worker.handler(job, { ...ctx, resolve }));
        },
        { limit: 100 },
      );
      const handled = result.processed + result.failed;
      processedJobs += handled;
      if (handled === 0) return processedJobs;
    }
  } finally {
    await queue.close();
  }
}

async function ownerOf(request: Parameters<typeof apiRequest>[0], token: string, dealId: string): Promise<string | null> {
  const payload = await readJsonSafe(await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token }));
  const owner = (payload as { deal?: { ownerUserId?: string | null } })?.deal?.ownerUserId;
  return typeof owner === 'string' ? owner : null;
}

/**
 * Deals list → bulk owner reassignment.
 *
 * Spec: .ai/specs/2026-09-24-crm-deal-owner-assignment.md (D3, D4, D6), implementation step 13.
 *
 * The list posts the operator's selection to the existing queued `bulk-update-owner` endpoint,
 * so this asserts the endpoint as the list calls it — every selected deal ends up owned by the
 * chosen user once the job drains — plus the authorization boundary the action relies on.
 */
test.describe('CRM deal owner — deals list bulk reassignment', () => {
  const createdDealIds: string[] = [];
  let token = '';
  let targetOwnerId = '';

  // Purpose-built principal for the 403 case: every seeded role (admin via `customers.*`,
  // employee explicitly) already grants `customers.deals.manage`, so the denial cannot be
  // expressed without a role that deliberately omits it.
  let viewerRoleId: string | null = null;
  let viewerUserId: string | null = null;
  let viewerToken = '';
  const viewerEmail = `tc-crm-6442-viewer-${Date.now()}@example.com`;
  const viewerPassword = 'Str0ng-Test-Pass!';

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');

    const me = await readJsonSafe(
      await apiRequest(request, 'POST', '/api/auth/feature-check', { token, data: { features: [] } }),
    );
    targetOwnerId = typeof (me as { userId?: unknown })?.userId === 'string'
      ? (me as { userId: string }).userId
      : '';
    expect(targetOwnerId, 'Could not resolve a user id to reassign to').toBeTruthy();

    const orgsPayload = await readJsonSafe(
      await apiRequest(request, 'GET', '/api/directory/organizations?page=1&pageSize=1', { token }),
    );
    const organizationId = (orgsPayload as { items?: Array<{ id?: string }> })?.items?.[0]?.id ?? '';

    if (organizationId) {
      viewerRoleId = await createRoleFixture(request, token, { name: `tc-crm-6442-viewer-${Date.now()}` });
      // View but NOT manage — the exact shape the bulk endpoint must reject.
      await setRoleAclFeatures(request, token, {
        roleId: viewerRoleId,
        features: ['customers.deals.view'],
      });
      viewerUserId = await createUserFixture(request, token, {
        email: viewerEmail,
        password: viewerPassword,
        organizationId,
        roles: [viewerRoleId],
      });
      viewerToken = await getAuthToken(request, viewerEmail, viewerPassword);
    }
  });

  test.afterAll(async ({ request }) => {
    for (const dealId of createdDealIds) {
      await deleteEntityByBody(request, token, '/api/customers/deals', dealId);
    }
    await deleteUserIfExists(request, token, viewerUserId);
    await deleteRoleIfExists(request, token, viewerRoleId);
  });

  test('reassigns every selected deal to the chosen owner', async ({ request }) => {
    const stamp = Date.now();
    const ids: string[] = [];
    for (const suffix of ['a', 'b', 'c']) {
      const id = await createDealFixture(request, token, { title: `TC-CRM-6442-list ${stamp} ${suffix}` });
      ids.push(id);
      createdDealIds.push(id);
    }

    const response = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-owner', {
      token,
      data: { ids, ownerUserId: targetOwnerId },
    });
    expect(response.ok(), `Bulk reassign failed: ${response.status()}`).toBeTruthy();
    const body = await readJsonSafe(response);
    expect((body as { ok?: boolean })?.ok).toBe(true);
    // The list relies on this id to track the job in the top bar.
    expect((body as { progressJobId?: string | null })?.progressJobId).toBeTruthy();

    await drainQueue(BULK_OWNER_QUEUE);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let owners: Array<string | null> = [];
    while (Date.now() < deadline) {
      owners = await Promise.all(ids.map((id) => ownerOf(request, token, id)));
      if (owners.every((owner) => owner === targetOwnerId)) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    expect(owners).toEqual(ids.map(() => targetOwnerId));
  });

  test('rejects a caller without customers.deals.manage', async ({ request }) => {
    test.skip(!viewerToken, 'Could not provision a view-only principal in this environment');

    const dealId = await createDealFixture(request, token, { title: `TC-CRM-6442-list denied ${Date.now()}` });
    createdDealIds.push(dealId);

    const denied = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-owner', {
      token: viewerToken,
      data: { ids: [dealId], ownerUserId: targetOwnerId },
    });
    expect(denied.status(), 'A view-only principal must not be able to reassign owners').toBe(403);

    // And the deal is untouched.
    expect(await ownerOf(request, token, dealId)).toBeNull();
  });
});
