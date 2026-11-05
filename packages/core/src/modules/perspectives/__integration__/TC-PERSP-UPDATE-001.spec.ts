import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

type SaveResponse = {
  perspective?: { id?: string; name?: string; createdAt?: string; updatedAt?: string | null; settings?: { pageSize?: number } };
};
type StateResponse = { perspectives?: Array<{ id?: string; name?: string; settings?: { pageSize?: number } }> };

/**
 * TC-PERSP-UPDATE-001 (#2491): POST with perspectiveId updates the existing record in place
 * rather than creating a duplicate.
 *
 * saveUserPerspective() loads the row by id when perspectiveId is supplied and mutates it, so
 * the returned id is stable, createdAt is preserved, updatedAt advances, and the GET index
 * still lists exactly one record for that id.
 */
test.describe('TC-PERSP-UPDATE-001: perspectiveId updates the existing perspective', () => {
  test('updates name and settings on the same record without creating a duplicate', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-persp-update-001-${stamp}`;
    let perspectiveId: string | null = null;

    try {
      const created = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name: `Original ${stamp}`, settings: { pageSize: 10 } },
      });
      expect(created.status(), 'create perspective').toBe(200);
      const createdBody = await readJsonSafe<SaveResponse>(created);
      perspectiveId = createdBody?.perspective?.id ?? null;
      expect(typeof perspectiveId, 'create returns id').toBe('string');
      expect(createdBody?.perspective?.settings?.pageSize).toBe(10);
      const createdAt = createdBody?.perspective?.createdAt ?? null;
      const firstUpdatedAt = createdBody?.perspective?.updatedAt ?? null;

      const updated = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { perspectiveId, name: `Updated ${stamp}`, settings: { pageSize: 20 } },
      });
      expect(updated.status(), 'update perspective by id').toBe(200);
      const updatedBody = await readJsonSafe<SaveResponse>(updated);
      expect(updatedBody?.perspective?.id, 'same record id (no new row)').toBe(perspectiveId);
      expect(updatedBody?.perspective?.name).toBe(`Updated ${stamp}`);
      expect(updatedBody?.perspective?.settings?.pageSize).toBe(20);
      if (createdAt) {
        expect(updatedBody?.perspective?.createdAt, 'createdAt unchanged').toBe(createdAt);
      }
      if (firstUpdatedAt && updatedBody?.perspective?.updatedAt) {
        expect(
          new Date(updatedBody.perspective.updatedAt).getTime(),
          'updatedAt advanced after update',
        ).toBeGreaterThanOrEqual(new Date(firstUpdatedAt).getTime());
      }

      // Exactly one record with that id and the updated content.
      const state = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token });
      expect(state.status()).toBe(200);
      const stateBody = await readJsonSafe<StateResponse>(state);
      const matches = (stateBody?.perspectives ?? []).filter((perspective) => perspective.id === perspectiveId);
      expect(matches, 'exactly one record with the id').toHaveLength(1);
      expect(matches[0].name).toBe(`Updated ${stamp}`);
      expect(matches[0].settings?.pageSize).toBe(20);
      // The update reused the row, so this freshly-stamped table holds exactly one perspective (no duplicate).
      expect((stateBody?.perspectives ?? []).length, 'no duplicate row created for this table').toBe(1);
    } finally {
      if (perspectiveId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${perspectiveId}`, { token }).catch(() => {});
      }
    }
  });
});
