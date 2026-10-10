import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createRoleFixture, deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

type PerspectiveDto = { id?: string; settings?: Record<string, unknown> };
type SaveResponse = { perspective?: PerspectiveDto; rolePerspectives?: Array<PerspectiveDto & { roleId?: string }> };
type StateResponse = { perspectives?: PerspectiveDto[] };

/**
 * TC-PERSP-LEGACY-FILTERS-001: a view saved from a page on the flat FilterBar keeps its filters.
 *
 * DataTable pages that are not wired to the advanced-filter tree save `settings.filters` as the
 * flat FilterValues record (`{ status: ['open'] }`). The read path must return that record as
 * stored — personal perspectives through GET, role perspectives through the save response —
 * instead of dropping it for not being a `{ v: 2, root }` tree.
 */
test.describe('TC-PERSP-LEGACY-FILTERS-001: flat FilterValues record round-trips', () => {
  test('POST then GET keeps a flat filter record on personal and role perspectives', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-persp-legacy-filters-${stamp}`;
    const filters = { status: ['open'], channel: ['web'] };
    const settings = { pageSize: 25, filters };

    let personalId: string | null = null;
    let roleId: string | null = null;

    try {
      roleId = await createRoleFixture(request, token, { name: `TC-PERSP-LEGACY-FILTERS-001 ${stamp}` });

      const saveRes = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name: `QA Legacy Filters ${stamp}`, settings, applyToRoles: [roleId] },
      });
      expect(saveRes.status(), 'save perspective').toBe(200);
      const saved = await readJsonSafe<SaveResponse>(saveRes);
      personalId = saved?.perspective?.id ?? null;
      expect(saved?.perspective?.settings?.filters).toEqual(filters);
      const rolePerspective = (saved?.rolePerspectives ?? []).find((entry) => entry.roleId === roleId);
      expect(rolePerspective?.settings?.filters, 'role perspective keeps the flat record').toEqual(filters);

      const stateRes = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token });
      expect(stateRes.status()).toBe(200);
      const state = await readJsonSafe<StateResponse>(stateRes);
      const reread = (state?.perspectives ?? []).find((perspective) => perspective.id === personalId);
      expect(reread, 'saved perspective is listed').toBeTruthy();
      expect(reread!.settings?.filters, 'GET returns the flat record as stored').toEqual(filters);
    } finally {
      if (personalId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${personalId}`, { token }).catch(() => {});
      }
      if (roleId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/roles/${roleId}`, { token }).catch(() => {});
      }
      await deleteRoleIfExists(request, token, roleId);
    }
  });
});
