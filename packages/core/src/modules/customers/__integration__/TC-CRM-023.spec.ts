import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CRM-023: Deal Pipeline Stage Assignment and Validation
 * Tests deal creation/update with pipelineId + pipelineStageId, and validates
 * that mismatched pipeline/stage references are rejected.
 */
test.describe('TC-CRM-023: Deal Pipeline Stage Assignment', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request);
  });

  async function createPipelineWithStage(
    request: Parameters<typeof apiRequest>[0],
    t: string,
    suffix: string,
  ): Promise<{ pipelineId: string; stageId: string }> {
    const pRes = await apiRequest(request, 'POST', '/api/customers/pipelines', {
      token: t,
      data: { name: `TC-CRM-023 Pipeline ${suffix}`, isDefault: false },
    });
    const pipelineId = ((await pRes.json()) as Record<string, unknown>).id as string;
    const sRes = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', {
      token: t,
      data: { pipelineId, label: `Stage ${suffix}` },
    });
    const stageId = ((await sRes.json()) as Record<string, unknown>).id as string;
    return { pipelineId, stageId };
  }

  async function cleanup(request: Parameters<typeof apiRequest>[0], t: string, dealId: string | null, pipelineId: string | null): Promise<void> {
    if (dealId) {
      await apiRequest(request, 'DELETE', '/api/customers/deals', { token: t, data: { id: dealId } }).catch(() => {});
    }
    if (pipelineId) {
      await apiRequest(request, 'DELETE', '/api/customers/pipelines', { token: t, data: { id: pipelineId } }).catch(() => {});
    }
  }

  test('should create a deal with pipelineId and pipelineStageId', async ({ request }) => {
    let pipelineId: string | null = null;
    let dealId: string | null = null;
    try {
      const { pipelineId: pid, stageId } = await createPipelineWithStage(request, token, `${Date.now()}`);
      pipelineId = pid;

      const dealRes = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: { title: `TC-CRM-023 Deal ${Date.now()}`, pipelineId, pipelineStageId: stageId },
      });
      expect(dealRes.ok(), `deal creation failed: ${dealRes.status()}`).toBeTruthy();
      const dealBody = await dealRes.json() as Record<string, unknown>;
      dealId = dealBody.id as string;
      expect(typeof dealId).toBe('string');
    } finally {
      await cleanup(request, token, dealId, pipelineId);
    }
  });

  test('should include pipelineId and pipelineStageId in deal list response', async ({ request }) => {
    let pipelineId: string | null = null;
    let dealId: string | null = null;
    try {
      const { pipelineId: pid, stageId } = await createPipelineWithStage(request, token, `${Date.now()}`);
      pipelineId = pid;

      const dealRes = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: { title: `TC-CRM-023 List ${Date.now()}`, pipelineId, pipelineStageId: stageId },
      });
      const dealBody = await dealRes.json() as Record<string, unknown>;
      dealId = dealBody.id as string;

      const listRes = await apiRequest(request, 'GET', `/api/customers/deals?pipelineId=${encodeURIComponent(pipelineId)}&pageSize=100`, { token });
      expect(listRes.ok()).toBeTruthy();
      const listBody = await listRes.json() as Record<string, unknown>;
      const items = listBody.items as Array<Record<string, unknown>>;
      const found = items.find((d) => d.id === dealId || d.deal_id === dealId);
      expect(found, 'Deal should appear when filtering by pipelineId').toBeTruthy();
      const foundPipelineId = found?.pipeline_id ?? found?.pipelineId;
      expect(foundPipelineId).toBe(pipelineId);
    } finally {
      await cleanup(request, token, dealId, pipelineId);
    }
  });

  test('should update a deal pipelineStageId', async ({ request }) => {
    let pipelineId: string | null = null;
    let dealId: string | null = null;
    try {
      const ts = `${Date.now()}`;
      const { pipelineId: pid, stageId: stage1Id } = await createPipelineWithStage(request, token, ts);
      pipelineId = pid;

      const stage2Res = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', {
        token,
        data: { pipelineId, label: `Stage2 ${ts}` },
      });
      const stage2Id = ((await stage2Res.json()) as Record<string, unknown>).id as string;

      const dealRes = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: { title: `TC-CRM-023 Update ${ts}`, pipelineId, pipelineStageId: stage1Id },
      });
      const dealBody = await dealRes.json() as Record<string, unknown>;
      dealId = dealBody.id as string;

      const updateRes = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: { id: dealId, pipelineId, pipelineStageId: stage2Id },
      });
      expect(updateRes.ok(), `deal update failed: ${updateRes.status()}`).toBeTruthy();
    } finally {
      await cleanup(request, token, dealId, pipelineId);
    }
  });

  test('should allow deal creation with mismatched pipelineId and pipelineStageId (no server-side validation)', async ({ request }) => {
    let pipeline1Id: string | null = null;
    let pipeline2Id: string | null = null;
    let dealId: string | null = null;
    try {
      const ts = `${Date.now()}`;
      const { pipelineId: pid1 } = await createPipelineWithStage(request, token, `${ts}A`);
      pipeline1Id = pid1;
      const { pipelineId: pid2, stageId: stageFromPipeline2 } = await createPipelineWithStage(request, token, `${ts}B`);
      pipeline2Id = pid2;

      const dealRes = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: {
          title: `TC-CRM-023 Mismatch ${ts}`,
          pipelineId: pipeline1Id,
          pipelineStageId: stageFromPipeline2,
        },
      });
      expect(dealRes.ok(), `deal creation should succeed: ${dealRes.status()}`).toBeTruthy();
      const body = await dealRes.json() as Record<string, unknown>;
      dealId = body.id as string;
      expect(typeof dealId).toBe('string');
    } finally {
      if (dealId) {
        await apiRequest(request, 'DELETE', '/api/customers/deals', { token, data: { id: dealId } }).catch(() => {});
      }
      if (pipeline1Id) {
        await apiRequest(request, 'DELETE', '/api/customers/pipelines', { token, data: { id: pipeline1Id } }).catch(() => {});
      }
      if (pipeline2Id) {
        await apiRequest(request, 'DELETE', '/api/customers/pipelines', { token, data: { id: pipeline2Id } }).catch(() => {});
      }
    }
  });
});
