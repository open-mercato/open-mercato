import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-077: Person-company link lifecycle (link, list, unlink).
 * Issue: https://github.com/open-mercato/open-mercato/issues/2458
 *
 * Verified-against-source contract:
 * - `POST /api/customers/people/[id]/companies` body `{ companyId }` → 200
 *   `{ ok: true, result: { id, companyId, displayName, isPrimary } }` (the link id is `result.id`).
 * - `GET /api/customers/people/[id]/companies` → `{ items: [{ id, companyId, displayName, isPrimary }] }`.
 * - `DELETE /api/customers/people/[id]/companies/[linkId]` → 200 `{ ok: true }` (soft-deletes the link only).
 */
test.describe('TC-CRM-077: Person-company link lifecycle', () => {
  test('links a company to a person and unlinks it without deleting the person', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      companyId = await createCompanyFixture(request, token, `TC-CRM-077 Co ${stamp}`);
      personId = await createPersonFixture(request, token, { firstName: 'Lena', lastName: 'Link', displayName: `TC-CRM-077 P ${stamp}` });

      // Link company → person.
      const linkResp = await apiRequest(request, 'POST', `/api/customers/people/${personId}/companies`, { token, data: { companyId } });
      expect(linkResp.status(), 'POST person-company link returns 200').toBe(200);
      const linkBody = await readJsonSafe<{ ok: boolean; result: { id: string; companyId: string } }>(linkResp);
      expect(linkBody?.ok).toBe(true);
      const linkId = linkBody?.result.id ?? '';
      expect(linkId.length > 0, 'link response carries a link id').toBe(true);
      expect(linkBody?.result.companyId).toBe(companyId);

      // The link appears in the list.
      const listBefore = await apiRequest(request, 'GET', `/api/customers/people/${personId}/companies`, { token });
      expect(listBefore.status()).toBe(200);
      const beforeItems = (await readJsonSafe<{ items: Array<{ id: string; companyId: string }> }>(listBefore))?.items ?? [];
      expect(beforeItems.some((entry) => entry.companyId === companyId)).toBe(true);

      // Unlink.
      const unlink = await apiRequest(request, 'DELETE', `/api/customers/people/${personId}/companies/${linkId}`, { token });
      expect(unlink.status(), 'DELETE link returns 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(unlink))?.ok).toBe(true);

      // The link is gone from the list.
      const listAfter = await apiRequest(request, 'GET', `/api/customers/people/${personId}/companies`, { token });
      const afterItems = (await readJsonSafe<{ items: Array<{ companyId: string }> }>(listAfter))?.items ?? [];
      expect(afterItems.some((entry) => entry.companyId === companyId)).toBe(false);

      // The person itself remains readable (only the link was removed).
      const personDetail = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token });
      expect(personDetail.status(), 'person remains readable after unlink').toBe(200);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
