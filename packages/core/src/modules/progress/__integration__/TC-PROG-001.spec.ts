import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-PROG-001: Progress Job Lifecycle
 * Covers: create, list active, update progress, cancel
 */
test.describe('TC-PROG-001: Progress Job Lifecycle', () => {
  test('should create, list, update, and cancel a progress job', async ({ request }) => {
    let token: string | null = null;
    let jobId: string | null = null;

    try {
      token = await getAuthToken(request);

      // 1. Create a job via POST /api/progress/jobs
      const createRes = await apiRequest(request, 'POST', '/api/progress/jobs', {
        token,
        data: {
          jobType: 'integration-test',
          name: `QA TC-PROG-001 ${Date.now()}`,
          totalCount: 200,
          cancellable: true,
        },
      });
      expect(createRes.status()).toBe(201);
      const createBody = await createRes.json();
      expect(createBody.id).toBeTruthy();
      jobId = createBody.id;

      // 2. Verify it appears in GET /api/progress/active
      const activeRes = await apiRequest(request, 'GET', '/api/progress/active', { token });
      expect(activeRes.ok()).toBeTruthy();
      const activeBody = await activeRes.json();
      const activeIds = activeBody.active.map((j: { id: string }) => j.id);
      expect(activeIds).toContain(jobId);

      // 3. Update progress via PUT /api/progress/jobs/:id
      const updateRes = await apiRequest(request, 'PUT', `/api/progress/jobs/${jobId}`, {
        token,
        data: { processedCount: 80, totalCount: 200 },
      });
      expect(updateRes.ok()).toBeTruthy();
      const updateBody = await updateRes.json();
      expect(updateBody.ok).toBe(true);
      expect(updateBody.progressPercent).toBe(40);

      // 4. Cancel job via DELETE /api/progress/jobs/:id
      const cancelRes = await apiRequest(request, 'DELETE', `/api/progress/jobs/${jobId}`, { token });
      expect(cancelRes.ok()).toBeTruthy();
      const cancelBody = await cancelRes.json();
      expect(cancelBody.ok).toBe(true);

      // 5. Verify the job is now cancelled (pending jobs cancel immediately)
      const detailRes = await apiRequest(request, 'GET', `/api/progress/jobs/${jobId}`, { token });
      expect(detailRes.ok()).toBeTruthy();
      const detailBody = await detailRes.json();
      expect(detailBody.status).toBe('cancelled');
    } finally {
      // Jobs are soft state — no explicit cleanup needed.
      // If the test created a job that wasn't cancelled, cancel it to keep state clean.
      if (token && jobId) {
        await apiRequest(request, 'DELETE', `/api/progress/jobs/${jobId}`, { token }).catch(() => {});
      }
    }
  });
});
