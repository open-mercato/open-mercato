import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCompanyFixture,
  createPersonFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-076: Deal participant association (link/unlink people & companies).
 * Issue: https://github.com/open-mercato/open-mercato/issues/2458
 *
 * Verified-against-source deviations from the (auto-generated) issue surfaces:
 * - `/api/customers/deals/[id]/people` and `/api/customers/deals/[id]/companies`
 *   are GET-only; there are no POST/DELETE participant endpoints and deal
 *   participants carry no `role`. Associations are managed through the deal
 *   create/update payload (`personIds`/`companyIds`) with REPLACE semantics
 *   (full set replaces, omitted = untouched, duplicates de-duplicated), and are
 *   verified through `GET /api/customers/deals/[id]` (`counts` / `linkedPersonIds`).
 */
test.describe('TC-CRM-076: Deal participant association (link/unlink people & companies)', () => {
  test('links and unlinks people/companies on a deal via the deal payload', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    let token: string | null = null;
    let companyId: string | null = null;
    let person1Id: string | null = null;
    let person2Id: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const authToken = token; // non-null binding for the readDeal closure below
      companyId = await createCompanyFixture(request, token, `TC-CRM-076 Co ${stamp}`);
      person1Id = await createPersonFixture(request, token, { firstName: 'Dana', lastName: 'One', displayName: `TC-CRM-076 P1 ${stamp}` });
      person2Id = await createPersonFixture(request, token, { firstName: 'Evan', lastName: 'Two', displayName: `TC-CRM-076 P2 ${stamp}` });

      // Create a deal linked to the company and person1.
      dealId = await createDealFixture(request, token, {
        title: `TC-CRM-076 Deal ${stamp}`,
        companyIds: [companyId],
        personIds: [person1Id],
      });

      const readDeal = async () => {
        const resp = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token: authToken });
        expect(resp.status()).toBe(200);
        return readJsonSafe<{
          counts: { people: number; companies: number };
          linkedPersonIds: string[];
          linkedCompanyIds: string[];
        }>(resp);
      };

      // Initial associations.
      let detail = await readDeal();
      expect(detail?.counts.people).toBe(1);
      expect(detail?.counts.companies).toBe(1);
      expect(detail?.linkedPersonIds).toContain(person1Id);
      expect(detail?.linkedCompanyIds).toContain(companyId);

      // Add person2 (replace semantics — send the full desired set).
      const addP2 = await apiRequest(request, 'PUT', '/api/customers/deals', { token, data: { id: dealId, personIds: [person1Id, person2Id] } });
      expect(addP2.status()).toBe(200);
      detail = await readDeal();
      expect(detail?.counts.people).toBe(2);
      expect(detail?.linkedPersonIds).toEqual(expect.arrayContaining([person1Id, person2Id]));

      // Duplicate ids are de-duplicated (no double-link).
      const dup = await apiRequest(request, 'PUT', '/api/customers/deals', { token, data: { id: dealId, personIds: [person1Id, person1Id, person2Id] } });
      expect(dup.status()).toBe(200);
      detail = await readDeal();
      expect(detail?.counts.people).toBe(2);

      // Unlink person1 (send the reduced set).
      const removeP1 = await apiRequest(request, 'PUT', '/api/customers/deals', { token, data: { id: dealId, personIds: [person2Id] } });
      expect(removeP1.status()).toBe(200);
      detail = await readDeal();
      expect(detail?.counts.people).toBe(1);
      expect(detail?.linkedPersonIds).toEqual([person2Id]);

      // Unlink the company (empty set) — people stay untouched because companyIds-only update.
      const removeCo = await apiRequest(request, 'PUT', '/api/customers/deals', { token, data: { id: dealId, companyIds: [] } });
      expect(removeCo.status()).toBe(200);
      detail = await readDeal();
      expect(detail?.counts.companies).toBe(0);
      expect(detail?.counts.people).toBe(1);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', person1Id);
      await deleteEntityIfExists(request, token, '/api/customers/people', person2Id);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
