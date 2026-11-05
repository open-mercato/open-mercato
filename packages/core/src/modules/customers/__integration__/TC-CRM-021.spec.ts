import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CRM-021: Pipeline CRUD API
 * Tests create, list, update (including set-default), and delete of pipelines.
 */
test.describe('TC-CRM-021: Pipeline CRUD API', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request);
  });

  test('should create a pipeline and return its id', async ({ request }) => {
    const name = `TC-CRM-021 Pipeline ${Date.now()}`;
    let pipelineId: string | null = null;
    try {
      const res = await apiRequest(request, 'POST', '/api/customers/pipelines', {
        token,
        data: { name, isDefault: false },
      });
      expect(res.ok(), `POST /api/customers/pipelines failed: ${res.status()}`).toBeTruthy();
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body.id).toBe('string');
      pipelineId = body.id as string;
    } finally {
      if (pipelineId) {
        await apiRequest(request, 'DELETE', '/api/customers/pipelines', {
          token,
          data: { id: pipelineId },
        }).catch(() => {});
      }
    }
  });

  test('should list pipelines and include created one', async ({ request }) => {
    const name = `TC-CRM-021 List ${Date.now()}`;
    let pipelineId: string | null = null;
    try {
      const createRes = await apiRequest(request, 'POST', '/api/customers/pipelines', {
        token,
        data: { name, isDefault: false },
      });
      const createBody = await createRes.json() as Record<string, unknown>;
      pipelineId = createBody.id as string;

      const listRes = await apiRequest(request, 'GET', '/api/customers/pipelines', { token });
      expect(listRes.ok()).toBeTruthy();
      const listBody = await listRes.json() as Record<string, unknown>;
      expect(Array.isArray(listBody.items)).toBeTruthy();
      const items = listBody.items as Array<Record<string, unknown>>;
      const found = items.find((p) => p.id === pipelineId);
      expect(found, 'Created pipeline should appear in list').toBeTruthy();
      expect(found?.name).toBe(name);
    } finally {
      if (pipelineId) {
        await apiRequest(request, 'DELETE', '/api/customers/pipelines', {
          token,
          data: { id: pipelineId },
        }).catch(() => {});
      }
    }
  });

  test('should update a pipeline name', async ({ request }) => {
    const originalName = `TC-CRM-021 Update ${Date.now()}`;
    const updatedName = `TC-CRM-021 Updated ${Date.now()}`;
    let pipelineId: string | null = null;
    try {
      const createRes = await apiRequest(request, 'POST', '/api/customers/pipelines', {
        token,
        data: { name: originalName, isDefault: false },
      });
      const createBody = await createRes.json() as Record<string, unknown>;
      pipelineId = createBody.id as string;

      const updateRes = await apiRequest(request, 'PUT', '/api/customers/pipelines', {
        token,
        data: { id: pipelineId, name: updatedName },
      });
      expect(updateRes.ok(), `PUT /api/customers/pipelines failed: ${updateRes.status()}`).toBeTruthy();

      const listRes = await apiRequest(request, 'GET', '/api/customers/pipelines', { token });
      const listBody = await listRes.json() as Record<string, unknown>;
      const items = listBody.items as Array<Record<string, unknown>>;
      const found = items.find((p) => p.id === pipelineId);
      expect(found?.name).toBe(updatedName);
    } finally {
      if (pipelineId) {
        await apiRequest(request, 'DELETE', '/api/customers/pipelines', {
          token,
          data: { id: pipelineId },
        }).catch(() => {});
      }
    }
  });

  test('should set a pipeline as default and unset previous default', async ({ request }) => {
    let pipeline1Id: string | null = null;
    let pipeline2Id: string | null = null;
    try {
      const res1 = await apiRequest(request, 'POST', '/api/customers/pipelines', {
        token,
        data: { name: `TC-CRM-021 Default1 ${Date.now()}`, isDefault: true },
      });
      pipeline1Id = ((await res1.json()) as Record<string, unknown>).id as string;

      const res2 = await apiRequest(request, 'POST', '/api/customers/pipelines', {
        token,
        data: { name: `TC-CRM-021 Default2 ${Date.now()}`, isDefault: true },
      });
      pipeline2Id = ((await res2.json()) as Record<string, unknown>).id as string;

      const listRes = await apiRequest(request, 'GET', '/api/customers/pipelines', { token });
      const listBody = await listRes.json() as Record<string, unknown>;
      const items = listBody.items as Array<Record<string, unknown>>;
      const p1 = items.find((p) => p.id === pipeline1Id);
      const p2 = items.find((p) => p.id === pipeline2Id);
      expect(p2?.isDefault).toBe(true);
      expect(p1?.isDefault).toBe(false);
    } finally {
      if (pipeline1Id) {
        await apiRequest(request, 'DELETE', '/api/customers/pipelines', { token, data: { id: pipeline1Id } }).catch(() => {});
      }
      if (pipeline2Id) {
        await apiRequest(request, 'DELETE', '/api/customers/pipelines', { token, data: { id: pipeline2Id } }).catch(() => {});
      }
    }
  });

  test('should delete a pipeline with no active deals', async ({ request }) => {
    const createRes = await apiRequest(request, 'POST', '/api/customers/pipelines', {
      token,
      data: { name: `TC-CRM-021 ToDelete ${Date.now()}`, isDefault: false },
    });
    expect(createRes.ok()).toBeTruthy();
    const createBody = await createRes.json() as Record<string, unknown>;
    const pipelineId = createBody.id as string;

    const deleteRes = await apiRequest(request, 'DELETE', '/api/customers/pipelines', {
      token,
      data: { id: pipelineId },
    });
    expect(deleteRes.ok(), `DELETE /api/customers/pipelines failed: ${deleteRes.status()}`).toBeTruthy();

    const listRes = await apiRequest(request, 'GET', '/api/customers/pipelines', { token });
    const listBody = await listRes.json() as Record<string, unknown>;
    const items = listBody.items as Array<Record<string, unknown>>;
    const found = items.find((p) => p.id === pipelineId);
    expect(found, 'Deleted pipeline should not appear in list').toBeFalsy();
  });

  test('should block pipeline deletion when it has active deals', async ({ request }) => {
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    let dealId: string | null = null;
    try {
      const pRes = await apiRequest(request, 'POST', '/api/customers/pipelines', {
        token,
        data: { name: `TC-CRM-021 Blocked ${Date.now()}`, isDefault: false },
      });
      pipelineId = ((await pRes.json()) as Record<string, unknown>).id as string;

      const sRes = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', {
        token,
        data: { pipelineId, label: 'TC-CRM-021 Stage' },
      });
      stageId = ((await sRes.json()) as Record<string, unknown>).id as string;

      const dRes = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: { title: `TC-CRM-021 Deal ${Date.now()}`, pipelineId, pipelineStageId: stageId },
      });
      expect(dRes.ok(), `deal creation failed: ${dRes.status()}`).toBeTruthy();
      dealId = ((await dRes.json()) as Record<string, unknown>).id as string;

      const deleteRes = await apiRequest(request, 'DELETE', '/api/customers/pipelines', {
        token,
        data: { id: pipelineId },
      });
      expect(deleteRes.status()).toBe(409);
    } finally {
      if (dealId) {
        await apiRequest(request, 'DELETE', '/api/customers/deals', { token, data: { id: dealId } }).catch(() => {});
      }
      if (pipelineId) {
        await apiRequest(request, 'DELETE', '/api/customers/pipelines', { token, data: { id: pipelineId } }).catch(() => {});
      }
    }
  });
});
