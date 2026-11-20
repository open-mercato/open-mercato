import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

type PerspectiveDto = { id?: string; name?: string; settings?: { pageSize?: number } };
type SaveResponse = { perspective?: PerspectiveDto };
type StateResponse = { perspectives?: PerspectiveDto[] };

/**
 * TC-PERSP-PAGESIZE-001 (#3882): a saved perspective never persists a page size above 100.
 *
 * Oversized values sent by older clients are normalized to the project-wide cap of 100 so
 * existing views stay saveable; in-range values round-trip unchanged and non-positive values
 * are still rejected by validation.
 */
test.describe('TC-PERSP-PAGESIZE-001: perspective pageSize is capped at 100', () => {
  test('normalizes 500 to 100, keeps 50, and rejects 0', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-persp-pagesize-${stamp}`;
    const base = `/api/perspectives/${encodeURIComponent(tableId)}`;
    const oversizedName = `QA PageSize 500 ${stamp}`;
    const inRangeName = `QA PageSize 50 ${stamp}`;
    const rejectedName = `QA PageSize 0 ${stamp}`;
    const createdIds: string[] = [];

    try {
      const oversizedRes = await apiRequest(request, 'POST', base, {
        token,
        data: { name: oversizedName, settings: { pageSize: 500 } },
      });
      expect(oversizedRes.status(), 'save with pageSize 500').toBe(200);
      const oversized = await readJsonSafe<SaveResponse>(oversizedRes);
      if (oversized?.perspective?.id) createdIds.push(oversized.perspective.id);
      expect(oversized?.perspective?.settings?.pageSize, 'returned pageSize is clamped').toBe(100);

      const inRangeRes = await apiRequest(request, 'POST', base, {
        token,
        data: { name: inRangeName, settings: { pageSize: 50 } },
      });
      expect(inRangeRes.status(), 'save with pageSize 50').toBe(200);
      const inRange = await readJsonSafe<SaveResponse>(inRangeRes);
      if (inRange?.perspective?.id) createdIds.push(inRange.perspective.id);
      expect(inRange?.perspective?.settings?.pageSize).toBe(50);

      const rejectedRes = await apiRequest(request, 'POST', base, {
        token,
        data: { name: rejectedName, settings: { pageSize: 0 } },
      });
      expect(rejectedRes.status(), 'save with pageSize 0').toBe(400);

      const stateRes = await apiRequest(request, 'GET', base, { token });
      expect(stateRes.status()).toBe(200);
      const state = await readJsonSafe<StateResponse>(stateRes);
      const byName = new Map((state?.perspectives ?? []).map((item): [string | undefined, PerspectiveDto] => [item.name, item]));
      expect(byName.get(oversizedName)?.settings?.pageSize, 'stored pageSize is clamped').toBe(100);
      expect(byName.get(inRangeName)?.settings?.pageSize, 'stored pageSize round-trips').toBe(50);
      expect(byName.has(rejectedName), 'rejected save persisted nothing').toBe(false);
    } finally {
      for (const id of createdIds) {
        await apiRequest(request, 'DELETE', `${base}/${id}`, { token }).catch(() => {});
      }
    }
  });
});
