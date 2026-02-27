import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CRM-022: Pipeline Stage CRUD + Reorder API
 * Tests create, list, update, delete, and reorder of pipeline stages.
 */
test.describe('TC-CRM-022: Pipeline Stage CRUD and Reorder', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request);
  });

  async function createTestPipeline(request: Parameters<typeof apiRequest>[0], t: string): Promise<string> {
    const res = await apiRequest(request, 'POST', '/api/customers/pipelines', {
      token: t,
      data: { name: `TC-CRM-022 Pipeline ${Date.now()}`, isDefault: false },
    });
    const body = await res.json() as Record<string, unknown>;
    return body.id as string;
  }

  async function deletePipeline(request: Parameters<typeof apiRequest>[0], t: string, id: string): Promise<void> {
    await apiRequest(request, 'DELETE', '/api/customers/pipelines', { token: t, data: { id } }).catch(() => {});
  }

  test('should create a pipeline stage', async ({ request }) => {
    let pipelineId: string | null = null;
    try {
      pipelineId = await createTestPipeline(request, token);
      const res = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', {
        token,
        data: { pipelineId, label: 'Prospecting' },
      });
      expect(res.ok(), `POST stage failed: ${res.status()}`).toBeTruthy();
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body.id).toBe('string');
    } finally {
      if (pipelineId) await deletePipeline(request, token, pipelineId);
    }
  });

  test('should list stages for a pipeline sorted by order', async ({ request }) => {
    let pipelineId: string | null = null;
    try {
      pipelineId = await createTestPipeline(request, token);
      await apiRequest(request, 'POST', '/api/customers/pipeline-stages', { token, data: { pipelineId, label: 'Stage A' } });
      await apiRequest(request, 'POST', '/api/customers/pipeline-stages', { token, data: { pipelineId, label: 'Stage B' } });

      const listRes = await apiRequest(request, 'GET', `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`, { token });
      expect(listRes.ok()).toBeTruthy();
      const body = await listRes.json() as Record<string, unknown>;
      expect(Array.isArray(body.items)).toBeTruthy();
      const items = body.items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThanOrEqual(2);
      const orders = items.map((s) => s.order as number);
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
      }
    } finally {
      if (pipelineId) await deletePipeline(request, token, pipelineId);
    }
  });

  test('should update a stage label', async ({ request }) => {
    let pipelineId: string | null = null;
    try {
      pipelineId = await createTestPipeline(request, token);
      const createRes = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', {
        token,
        data: { pipelineId, label: 'Old Label' },
      });
      const stageId = ((await createRes.json()) as Record<string, unknown>).id as string;

      const updateRes = await apiRequest(request, 'PUT', '/api/customers/pipeline-stages', {
        token,
        data: { id: stageId, label: 'New Label' },
      });
      expect(updateRes.ok(), `PUT stage failed: ${updateRes.status()}`).toBeTruthy();

      const listRes = await apiRequest(request, 'GET', `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`, { token });
      const listBody = await listRes.json() as Record<string, unknown>;
      const items = listBody.items as Array<Record<string, unknown>>;
      const found = items.find((s) => s.id === stageId);
      expect(found?.label).toBe('New Label');
    } finally {
      if (pipelineId) await deletePipeline(request, token, pipelineId);
    }
  });

  test('should delete a stage with no active deals', async ({ request }) => {
    let pipelineId: string | null = null;
    try {
      pipelineId = await createTestPipeline(request, token);
      const createRes = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', {
        token,
        data: { pipelineId, label: 'To Delete' },
      });
      const stageId = ((await createRes.json()) as Record<string, unknown>).id as string;

      const deleteRes = await apiRequest(request, 'DELETE', '/api/customers/pipeline-stages', {
        token,
        data: { id: stageId },
      });
      expect(deleteRes.ok(), `DELETE stage failed: ${deleteRes.status()}`).toBeTruthy();

      const listRes = await apiRequest(request, 'GET', `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`, { token });
      const listBody = await listRes.json() as Record<string, unknown>;
      const items = listBody.items as Array<Record<string, unknown>>;
      const found = items.find((s) => s.id === stageId);
      expect(found, 'Deleted stage should not appear in list').toBeFalsy();
    } finally {
      if (pipelineId) await deletePipeline(request, token, pipelineId);
    }
  });

  test('should block stage deletion when it has active deals', async ({ request }) => {
    let pipelineId: string | null = null;
    let dealId: string | null = null;
    try {
      pipelineId = await createTestPipeline(request, token);
      const stageRes = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', {
        token,
        data: { pipelineId, label: 'Blocked Stage' },
      });
      const stageId = ((await stageRes.json()) as Record<string, unknown>).id as string;

      const dealRes = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: { title: `TC-CRM-022 Deal ${Date.now()}`, pipelineId, pipelineStageId: stageId },
      });
      expect(dealRes.ok(), `deal creation failed: ${dealRes.status()}`).toBeTruthy();
      dealId = ((await dealRes.json()) as Record<string, unknown>).id as string;

      const deleteRes = await apiRequest(request, 'DELETE', '/api/customers/pipeline-stages', {
        token,
        data: { id: stageId },
      });
      expect(deleteRes.status()).toBe(409);
    } finally {
      if (dealId) {
        await apiRequest(request, 'DELETE', '/api/customers/deals', { token, data: { id: dealId } }).catch(() => {});
      }
      if (pipelineId) await deletePipeline(request, token, pipelineId);
    }
  });

  test('should reorder stages within a pipeline', async ({ request }) => {
    let pipelineId: string | null = null;
    try {
      pipelineId = await createTestPipeline(request, token);
      const s1Res = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', { token, data: { pipelineId, label: 'First' } });
      const s2Res = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', { token, data: { pipelineId, label: 'Second' } });
      const s3Res = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', { token, data: { pipelineId, label: 'Third' } });
      const s1Id = ((await s1Res.json()) as Record<string, unknown>).id as string;
      const s2Id = ((await s2Res.json()) as Record<string, unknown>).id as string;
      const s3Id = ((await s3Res.json()) as Record<string, unknown>).id as string;

      const reorderRes = await apiRequest(request, 'POST', '/api/customers/pipeline-stages/reorder', {
        token,
        data: {
          stages: [
            { id: s3Id, order: 0 },
            { id: s1Id, order: 1 },
            { id: s2Id, order: 2 },
          ],
        },
      });
      expect(reorderRes.ok(), `POST reorder failed: ${reorderRes.status()}`).toBeTruthy();

      const listRes = await apiRequest(request, 'GET', `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`, { token });
      const listBody = await listRes.json() as Record<string, unknown>;
      const items = listBody.items as Array<Record<string, unknown>>;
      const sortedIds = items.map((s) => s.id);
      expect(sortedIds[0]).toBe(s3Id);
      expect(sortedIds[1]).toBe(s1Id);
      expect(sortedIds[2]).toBe(s2Id);
    } finally {
      if (pipelineId) await deletePipeline(request, token, pipelineId);
    }
  });
});
