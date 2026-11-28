import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

type ListBody = { items?: Array<{ id: string }>; total?: number; totalPages?: number };

/**
 * TC-DIR-024: Tenant list pages cover every tenant exactly once when names tie
 * Covers: GET /api/directory/tenants?search=…&sortField=name&sortDir=…&page=…&pageSize=…
 *
 * Tenants that share a name must not repeat on one page and disappear from another when a
 * super administrator walks the list page by page.
 */
test.describe('TC-DIR-024: Tenant list paging over tied names', () => {
  test('returns every same-named tenant exactly once across pages', async ({ request }) => {
    test.setTimeout(180_000);
    const token = await getAuthToken(request, 'superadmin');
    const sharedName = `QA TC-DIR-024 ${Date.now()}`;
    const tenantIds: string[] = [];
    try {
      for (let index = 0; index < 30; index += 1) {
        const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
          token,
          data: { name: sharedName },
        });
        const body = await readJsonSafe<{ id?: string }>(response);
        if (body?.id) tenantIds.push(body.id);
        expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
        expectId(body?.id, 'Tenant creation response should include id');
      }
      const expectedIds = [...tenantIds].sort();

      for (const sortDir of ['asc', 'desc']) {
        const walkedIds: string[] = [];
        for (let page = 1; page <= 6; page += 1) {
          const response = await apiRequest(
            request,
            'GET',
            `/api/directory/tenants?search=${encodeURIComponent(sharedName)}&sortField=name&sortDir=${sortDir}&page=${page}&pageSize=5`,
            { token },
          );
          expect(response.status(), `page ${page} (${sortDir}) should return 200`).toBe(200);
          const body = await readJsonSafe<ListBody>(response);
          expect(body?.total).toBe(30);
          expect(body?.totalPages).toBe(6);
          walkedIds.push(...(body?.items ?? []).map((item) => item.id));
        }
        expect(walkedIds, `walking all pages (${sortDir})`).toHaveLength(30);
        expect([...walkedIds].sort(), `every tenant exactly once (${sortDir})`).toEqual(expectedIds);
      }
    } finally {
      for (const tenantId of tenantIds) {
        await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId);
      }
    }
  });
});
