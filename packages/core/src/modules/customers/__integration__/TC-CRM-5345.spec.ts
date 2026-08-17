import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-5345: DealId-Only Comment Creation
 *
 * POST /api/customers/comments accepts dealId without entityId: the route derives the
 * timeline entity from the deal's links, preferring person links over company links
 * (mirroring the deal detail page's entity selector). A deal with no links yields a
 * clean 4xx instead of a stored comment.
 */
test.describe('TC-CRM-5345: DealId-Only Comment Creation', () => {
  test('should derive the comment entity from the deal links and reject link-less deals', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;
    let dealId: string | null = null;
    let linklessDealId: string | null = null;
    let commentId: string | null = null;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-5345 Company ${Date.now()}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TCCRM5345${Date.now()}`,
        displayName: `QA TC-CRM-5345 Person ${Date.now()}`,
        companyEntityId: companyId,
      });
      dealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-5345 Deal ${Date.now()}`,
        companyIds: [companyId],
        personIds: [personId],
      });
      linklessDealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-5345 Linkless Deal ${Date.now()}`,
      });

      const noteText = `QA dealId-only note ${Date.now()}`;
      const createResp = await apiRequest(request, 'POST', '/api/customers/comments', {
        token,
        data: { dealId, body: noteText },
      });
      expect(createResp.status(), `POST /api/customers/comments returned ${createResp.status()}`).toBe(201);
      const createPayload = await readJsonSafe(createResp);
      commentId =
        createPayload && typeof createPayload === 'object' && typeof (createPayload as Record<string, unknown>).id === 'string'
          ? ((createPayload as Record<string, unknown>).id as string)
          : null;
      expect(commentId, 'No comment id in create response').toBeTruthy();

      const listResp = await apiRequest(request, 'GET', `/api/customers/comments?dealId=${encodeURIComponent(dealId)}`, {
        token,
      });
      expect(listResp.ok(), `GET /api/customers/comments returned ${listResp.status()}`).toBeTruthy();
      const listPayload = await readJsonSafe(listResp);
      const items =
        listPayload && typeof listPayload === 'object' && Array.isArray((listPayload as Record<string, unknown>).items)
          ? ((listPayload as Record<string, unknown>).items as Array<Record<string, unknown>>)
          : [];
      const createdItem = items.find((item) => item.id === commentId);
      expect(createdItem, `Comment ${commentId} not found in deal-scoped listing`).toBeTruthy();
      expect(createdItem?.entity_id, 'Derived entity should be the linked person').toBe(personId);

      const linklessResp = await apiRequest(request, 'POST', '/api/customers/comments', {
        token,
        data: { dealId: linklessDealId, body: `QA linkless note ${Date.now()}` },
      });
      expect(linklessResp.status(), `Link-less deal returned ${linklessResp.status()}`).toBe(422);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/comments', commentId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', linklessDealId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
