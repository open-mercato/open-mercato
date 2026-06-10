import { expect, test } from '@playwright/test';
import { createDealFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CRM-2939: deals list keeps reading customer_deals when stray doc-storage rows exist
 * Source: https://github.com/open-mercato/open-mercato/issues/2939
 *
 * `customers:customer_deal` is a table-backed ORM entity that is ALSO declared as a
 * module custom entity in ce.ts (for its custom-field set). Writing a record through
 * the generic entities records API stores a doc in `custom_entities_storage` for that
 * entity type. Before the fix, HybridQueryEngine re-classified the whole entity type as
 * doc-storage-backed as soon as one such row existed, so `/api/customers/deals` (list,
 * kanban lanes, MCP) returned only the stray doc rows while the aggregate endpoint kept
 * counting the real table rows.
 */
test.describe('TC-CRM-2939: deals list ignores stray doc-storage rows', () => {
  test('GET /api/customers/deals returns table-backed deals despite custom_entities_storage rows', async ({ request }) => {
    let token: string | null = null;
    let dealId: string | null = null;
    let strayRecordId: string | null = null;
    const dealTitle = `QA TC-CRM-2939 Deal ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      dealId = await createDealFixture(request, token, { title: dealTitle });

      const strayResponse = await apiRequest(request, 'POST', '/api/entities/records', {
        token,
        data: {
          entityId: 'customers:customer_deal',
          values: { competitive_risk: 'high' },
        },
      });
      expect(strayResponse.status(), `POST /api/entities/records returned ${strayResponse.status()}`).toBe(200);
      const strayPayload = (await readJsonSafe(strayResponse)) as { item?: { recordId?: string } } | null;
      strayRecordId = strayPayload?.item?.recordId ?? null;
      expect(strayRecordId, 'Expected stray doc record id in records response').toBeTruthy();

      const listResponse = await apiRequest(request, 'GET', '/api/customers/deals?pageSize=100&sortField=createdAt&sortDir=desc', { token });
      expect(listResponse.status(), `GET /api/customers/deals returned ${listResponse.status()}`).toBe(200);
      const listPayload = (await readJsonSafe(listResponse)) as { items?: Array<{ id?: string }>; total?: number } | null;
      const listedIds = (listPayload?.items ?? [])
        .map((item) => item?.id)
        .filter((value): value is string => typeof value === 'string');

      expect(listedIds, 'table-backed deal must stay visible in the deals list').toContain(dealId);
      expect(listedIds, 'stray doc-storage record must not surface in the deals list').not.toContain(strayRecordId);
    } finally {
      if (token && strayRecordId) {
        await apiRequest(request, 'DELETE', `/api/entities/records?entityId=customers:customer_deal&recordId=${strayRecordId}`, { token }).catch(() => undefined);
      }
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
    }
  });
});
