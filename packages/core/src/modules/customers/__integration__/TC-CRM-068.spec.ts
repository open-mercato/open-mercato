import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createCompanyFixture,
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader';
import { createRequestContainer } from '@open-mercato/shared/lib/di/container';
import { createQueue } from '@open-mercato/queue';

const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 30_000;

const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim();
const APP_ROOT = TEST_APP_ROOT
  ? path.resolve(TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato');
const APP_QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue');

if (!TEST_APP_ROOT) {
  // Mirror TC-CRM-028: ensure the in-process queue helper writes/reads the same dir the
  // Next.js server uses. Without this, the local file-based queue defaults to cwd-relative
  // `.mercato/queue/`, which doesn't exist in the Playwright runner's working directory and
  // the worker handler never finds the queued jobs.
  process.env.QUEUE_BASE_DIR = APP_QUEUE_BASE_DIR;
}

/**
 * Drains a local file-based queue in-process by running the registered worker handler
 * against every available job. CI's integration test harness does not run separate worker
 * processes — the Next.js server only enqueues jobs, so without this helper the bulk
 * `customers.deals.bulk_update_*` jobs stay `pending` forever and the progress-poll loop
 * below times out. Copied (and adapted) from TC-CRM-028's `drainQueue` helper.
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

async function waitForProgressJob(
  request: APIRequestContext,
  token: string,
  jobId: string,
  queueName?: string,
): Promise<Record<string, unknown>> {
  // Process any queued jobs before polling so the job transitions out of `pending`
  // immediately on the first poll. The route enqueues to a local file-based queue but
  // there is no separate worker process in CI — without this drain the job never starts.
  if (queueName) {
    await drainQueue(queueName);
  }
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const response = await apiRequest(request, 'GET', `/api/progress/jobs/${jobId}`, { token });
    if (response.ok()) {
      const body = (await response.json()) as Record<string, unknown>;
      last = body;
      const status = body.status as string | undefined;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        return body;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Progress job ${jobId} did not finish within ${POLL_TIMEOUT_MS}ms (last status: ${JSON.stringify(last)})`);
}

/**
 * TC-CRM-068: Bulk update deal pipeline stage (SPEC-048 Phase 1d)
 *
 * Verifies the async bulk-update-stage flow end-to-end:
 *   - POST /api/customers/deals/bulk-update-stage returns 202 + progressJobId
 *   - The progress job transitions to `completed`
 *   - Both target deals end up on the new stage; the unrelated deal is untouched
 *   - Schema validation rejects invalid payloads (empty ids, non-UUID stage)
 */
test.describe('TC-CRM-068: Bulk update deal stage', () => {
  test('moves selected deals to the new stage via the async queue worker', async ({ request }) => {
    test.slow();

    const token = await getAuthToken(request);
    const companyName = `TC-CRM-068 Co ${Date.now()}`;
    const pipelineName = `TC-CRM-068 Pipeline ${Date.now()}`;

    let companyId: string | null = null;
    let pipelineId: string | null = null;
    let openStageId: string | null = null;
    let winStageId: string | null = null;
    let dealAId: string | null = null;
    let dealBId: string | null = null;
    let dealCId: string | null = null;

    try {
      companyId = await createCompanyFixture(request, token, companyName);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      openStageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Open', order: 0 });
      winStageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Win', order: 1 });

      dealAId = await createDealFixture(request, token, {
        title: `TC-CRM-068 Deal A ${Date.now()}`,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: openStageId,
      });
      dealBId = await createDealFixture(request, token, {
        title: `TC-CRM-068 Deal B ${Date.now()}`,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: openStageId,
      });
      dealCId = await createDealFixture(request, token, {
        title: `TC-CRM-068 Deal C ${Date.now()}`,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: openStageId,
      });

      // Target only A + B; C should stay on the Open stage.
      const enqueueResponse = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-stage', {
        token,
        data: { ids: [dealAId, dealBId], pipelineStageId: winStageId },
      });
      expect(enqueueResponse.status(), `POST /bulk-update-stage status: ${enqueueResponse.status()}`).toBe(202);
      const enqueueBody = (await enqueueResponse.json()) as { ok?: boolean; progressJobId?: string };
      expect(enqueueBody.ok).toBe(true);
      expect(typeof enqueueBody.progressJobId, 'response must carry a progressJobId').toBe('string');

      const finalJob = await waitForProgressJob(
        request,
        token,
        enqueueBody.progressJobId!,
        'customers-deals-bulk-update-stage',
      );
      expect(finalJob.status, `progress job final status: ${JSON.stringify(finalJob)}`).toBe('completed');
      const summary = finalJob.resultSummary as { affectedCount?: number; failedCount?: number } | undefined;
      expect(summary?.affectedCount).toBe(2);
      expect(summary?.failedCount).toBe(0);

      const baseQuery = `pipelineId=${encodeURIComponent(pipelineId)}`;
      const winListResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?${baseQuery}&pipelineStageId=${encodeURIComponent(winStageId)}`,
        { token },
      );
      const winBody = (await winListResponse.json()) as { items?: Array<Record<string, unknown>> };
      const winIds = new Set((winBody.items ?? []).map((row) => row.id as string));
      expect(winIds.has(dealAId!)).toBe(true);
      expect(winIds.has(dealBId!)).toBe(true);
      expect(winIds.has(dealCId!), 'Untouched deal must NOT have moved').toBe(false);

      const openListResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?${baseQuery}&pipelineStageId=${encodeURIComponent(openStageId)}`,
        { token },
      );
      const openBody = (await openListResponse.json()) as { items?: Array<Record<string, unknown>> };
      const openIds = new Set((openBody.items ?? []).map((row) => row.id as string));
      expect(openIds.has(dealCId!), 'Untouched deal stays on Open').toBe(true);
      expect(openIds.has(dealAId!), 'Moved deal removed from Open').toBe(false);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealAId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealBId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealCId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', winStageId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', openStageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });

  test('rejects empty ids and non-UUID payloads with 400', async ({ request }) => {
    const token = await getAuthToken(request);

    const emptyResponse = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-stage', {
      token,
      data: { ids: [], pipelineStageId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(emptyResponse.status(), 'Empty ids must be rejected').toBe(400);

    const invalidIdResponse = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-stage', {
      token,
      data: { ids: ['not-a-uuid'], pipelineStageId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(invalidIdResponse.status(), 'Non-UUID ids must be rejected').toBe(400);

    const invalidStageResponse = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-stage', {
      token,
      data: { ids: ['11111111-1111-4111-8111-111111111111'], pipelineStageId: 'not-a-uuid' },
    });
    expect(invalidStageResponse.status(), 'Non-UUID pipelineStageId must be rejected').toBe(400);
  });
});
