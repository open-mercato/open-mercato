import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createCompanyFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 30_000;

async function waitForProgressJob(
  request: APIRequestContext,
  token: string,
  jobId: string,
): Promise<Record<string, unknown>> {
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

async function pickAssignableUserId(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/auth/users?page=1&pageSize=10', { token });
  expect(response.ok(), `GET /api/auth/users failed: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { items?: Array<{ id?: unknown }> };
  const id = (body.items ?? []).map((row) => row.id).find((value): value is string => typeof value === 'string' && value.length > 0);
  expect(id, '/api/auth/users must return at least one user we can assign as owner').toBeTruthy();
  return id as string;
}

async function createDealWithOwner(
  request: APIRequestContext,
  token: string,
  input: { title: string; pipelineId: string; pipelineStageId: string; companyId: string; ownerUserId: string | null },
): Promise<string> {
  const data: Record<string, unknown> = {
    title: input.title,
    pipelineId: input.pipelineId,
    pipelineStageId: input.pipelineStageId,
    companyIds: [input.companyId],
  };
  if (input.ownerUserId) data.ownerUserId = input.ownerUserId;
  const response = await apiRequest(request, 'POST', '/api/customers/deals', { token, data });
  expect(response.ok(), `POST /api/customers/deals failed: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as Record<string, unknown>;
  const id = (body.dealId ?? body.id) as string | undefined;
  expect(id, 'Deal create must return an id').toBeTruthy();
  return id as string;
}

/**
 * TC-CRM-069: Bulk reassign deal owner (SPEC-048 Phase 1d)
 *
 * Verifies the async bulk-update-owner flow end-to-end and the null-clears-owner case.
 */
test.describe('TC-CRM-069: Bulk reassign deal owner', () => {
  test('reassigns selected deals to a new owner via the async queue worker', async ({ request }) => {
    test.slow();

    const token = await getAuthToken(request);
    const ownerUserId = await pickAssignableUserId(request, token);
    const companyName = `TC-CRM-069 Co ${Date.now()}`;
    const pipelineName = `TC-CRM-069 Pipeline ${Date.now()}`;

    let companyId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    let dealAId: string | null = null;
    let dealBId: string | null = null;

    try {
      companyId = await createCompanyFixture(request, token, companyName);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Open', order: 0 });

      dealAId = await createDealWithOwner(request, token, {
        title: `TC-CRM-069 Deal A ${Date.now()}`,
        pipelineId,
        pipelineStageId: stageId,
        companyId,
        ownerUserId: null,
      });
      dealBId = await createDealWithOwner(request, token, {
        title: `TC-CRM-069 Deal B ${Date.now()}`,
        pipelineId,
        pipelineStageId: stageId,
        companyId,
        ownerUserId: null,
      });

      const enqueueResponse = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-owner', {
        token,
        data: { ids: [dealAId, dealBId], ownerUserId },
      });
      expect(enqueueResponse.status(), `POST /bulk-update-owner status: ${enqueueResponse.status()}`).toBe(202);
      const enqueueBody = (await enqueueResponse.json()) as { ok?: boolean; progressJobId?: string };
      expect(enqueueBody.ok).toBe(true);
      expect(typeof enqueueBody.progressJobId, 'response must carry a progressJobId').toBe('string');

      const finalJob = await waitForProgressJob(request, token, enqueueBody.progressJobId!);
      expect(finalJob.status, `progress job final status: ${JSON.stringify(finalJob)}`).toBe('completed');
      const summary = finalJob.resultSummary as { affectedCount?: number; failedCount?: number } | undefined;
      expect(summary?.affectedCount).toBe(2);
      expect(summary?.failedCount).toBe(0);

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?pipelineId=${encodeURIComponent(pipelineId)}&pipelineStageId=${encodeURIComponent(stageId)}`,
        { token },
      );
      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> };
      const byId = new Map<string, Record<string, unknown>>();
      for (const row of listBody.items ?? []) byId.set(row.id as string, row);
      expect(byId.get(dealAId!)?.owner_user_id).toBe(ownerUserId);
      expect(byId.get(dealBId!)?.owner_user_id).toBe(ownerUserId);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealAId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealBId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });

  test('clears ownership when ownerUserId is null', async ({ request }) => {
    test.slow();

    const token = await getAuthToken(request);
    const ownerUserId = await pickAssignableUserId(request, token);
    const companyName = `TC-CRM-069 NullCo ${Date.now()}`;
    const pipelineName = `TC-CRM-069 NullPipeline ${Date.now()}`;

    let companyId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    let dealId: string | null = null;

    try {
      companyId = await createCompanyFixture(request, token, companyName);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Open', order: 0 });

      dealId = await createDealWithOwner(request, token, {
        title: `TC-CRM-069 Deal Owned ${Date.now()}`,
        pipelineId,
        pipelineStageId: stageId,
        companyId,
        ownerUserId,
      });

      const enqueueResponse = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-owner', {
        token,
        data: { ids: [dealId], ownerUserId: null },
      });
      expect(enqueueResponse.status()).toBe(202);
      const enqueueBody = (await enqueueResponse.json()) as { ok?: boolean; progressJobId?: string };
      expect(enqueueBody.ok).toBe(true);

      const finalJob = await waitForProgressJob(request, token, enqueueBody.progressJobId!);
      expect(finalJob.status).toBe('completed');

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?pipelineId=${encodeURIComponent(pipelineId)}&pipelineStageId=${encodeURIComponent(stageId)}`,
        { token },
      );
      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> };
      const found = (listBody.items ?? []).find((row) => row.id === dealId);
      expect(found?.owner_user_id ?? null).toBeNull();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });

  test('rejects empty ids with 400', async ({ request }) => {
    const token = await getAuthToken(request);
    const emptyResponse = await apiRequest(request, 'POST', '/api/customers/deals/bulk-update-owner', {
      token,
      data: { ids: [], ownerUserId: null },
    });
    expect(emptyResponse.status()).toBe(400);
  });
});
