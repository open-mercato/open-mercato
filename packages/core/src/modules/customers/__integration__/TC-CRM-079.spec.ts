import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCompanyFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  createDealFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue';

/**
 * TC-CRM-079: Bulk update deal stage and owner via the dedicated endpoints.
 * Issue: https://github.com/open-mercato/open-mercato/issues/2458
 *
 * Verified-against-source contract:
 * - `POST /api/customers/deals/bulk-update-stage` `{ ids, pipelineStageId }` and
 *   `POST /api/customers/deals/bulk-update-owner` `{ ids, ownerUserId }` are
 *   ASYNCHRONOUS: they enqueue a background job and return 202 `{ ok, progressJobId }`.
 *   The per-deal update happens in a worker, so we drain the queue and poll the
 *   deal detail until the change lands (portable across auto-spawn / CI lanes).
 * - An empty `ids` list fails validation (`min(1)`) → 400.
 */
const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato');

// Local (non-standalone) runs need QUEUE_BASE_DIR pointed at the app's queue dir so
// `drainIntegrationQueue` reads the same file-backed queue the app server writes to.
if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') });
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue');
}

const STAGE_QUEUE = 'customers-deals-bulk-update-stage';
const OWNER_QUEUE = 'customers-deals-bulk-update-owner';

async function drainAndPollDeals(
  request: APIRequestContext,
  token: string,
  queueName: string,
  dealIds: string[],
  predicate: (deal: Record<string, unknown>) => boolean,
): Promise<boolean> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await drainIntegrationQueue(queueName, { appRoot: APP_ROOT });
    const checks = await Promise.all(
      dealIds.map(async (id) => {
        const resp = await apiRequest(request, 'GET', `/api/customers/deals/${id}`, { token });
        if (!resp.ok()) return false;
        const body = await readJsonSafe<{ deal?: Record<string, unknown> }>(resp);
        return predicate(body?.deal ?? {});
      }),
    );
    if (checks.every(Boolean)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

test.describe('TC-CRM-079: Bulk update deal stage and owner', () => {
  test('bulk-updates stage and owner for multiple deals and rejects empty id lists', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    let token: string | null = null;
    let companyId: string | null = null;
    let pipelineId: string | null = null;
    const stageIds: string[] = [];
    const dealIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');
      const { userId } = getTokenScope(token);
      expect(userId.length > 0, 'admin token carries a user id').toBe(true);

      companyId = await createCompanyFixture(request, token, `TC-CRM-079 Co ${stamp}`);
      pipelineId = await createPipelineFixture(request, token, { name: `TC-CRM-079 Pipe ${stamp}` });
      const stageAId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Stage A', order: 0 });
      const stageBId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Stage B', order: 1 });
      stageIds.push(stageAId, stageBId);

      for (let index = 0; index < 3; index += 1) {
        const dealId = await createDealFixture(request, token, {
          title: `TC-CRM-079 Deal ${index} ${stamp}`,
          companyIds: [companyId],
          pipelineId,
          pipelineStageId: stageAId,
        });
        dealIds.push(dealId);
      }

      // Bulk move all deals to stage B (async → 202 + progress job).
      const stageResp = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-stage', { token, data: { ids: dealIds, pipelineStageId: stageBId } });
      expect(stageResp.status(), 'bulk-update-stage returns 202').toBe(202);
      const stageBody = await readJsonSafe<{ ok: boolean; progressJobId: string | null }>(stageResp);
      expect(stageBody?.ok).toBe(true);
      expect((stageBody?.progressJobId ?? '').length > 0, 'bulk-update-stage returns a progress job id').toBe(true);

      const stageApplied = await drainAndPollDeals(request, token, STAGE_QUEUE, dealIds, (deal) => deal.pipelineStageId === stageBId);
      expect(stageApplied, 'all deals moved to stage B after the bulk job drains').toBe(true);

      // Bulk reassign owner (async → 202 + progress job).
      const ownerResp = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-owner', { token, data: { ids: dealIds, ownerUserId: userId } });
      expect(ownerResp.status(), 'bulk-update-owner returns 202').toBe(202);
      const ownerBody = await readJsonSafe<{ ok: boolean; progressJobId: string | null }>(ownerResp);
      expect(ownerBody?.ok).toBe(true);
      expect((ownerBody?.progressJobId ?? '').length > 0, 'bulk-update-owner returns a progress job id').toBe(true);

      const ownerApplied = await drainAndPollDeals(request, token, OWNER_QUEUE, dealIds, (deal) => deal.ownerUserId === userId);
      expect(ownerApplied, 'all deals reassigned to the new owner after the bulk job drains').toBe(true);

      // Empty ids list is rejected.
      const emptyResp = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-stage', { token, data: { ids: [], pipelineStageId: stageBId } });
      expect(emptyResp.status(), 'empty ids list is rejected with 400').toBe(400);
    } finally {
      // Soft-delete the deals before the stages so stage deletion is not blocked (409) by active deals.
      for (const id of dealIds) await deleteEntityIfExists(request, token, '/api/customers/deals', id);
      for (const id of stageIds) await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', id);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
