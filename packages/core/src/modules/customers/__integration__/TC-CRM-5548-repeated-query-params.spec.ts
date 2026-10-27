import { expect, test } from '@playwright/test';
import { createDealFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CRM-5548: makeCrudRoute list routes honour repeated query parameters
 * Source: https://github.com/open-mercato/open-mercato/issues/5548
 *
 * The CRUD factory built its query object with
 * `Object.fromEntries(url.searchParams.entries())`, which keeps only the LAST value
 * of a repeated key. `?status=open&status=in_progress` therefore reached the route
 * schema as `'in_progress'` and every earlier selection was silently discarded —
 * while the CRUD response cache keyed the same two requests order-insensitively, so
 * the rows you got back also depended on which ordering warmed the cache first.
 *
 * This spec pins the three properties the fix owes callers: a repeated param keeps
 * every value, the repeated and comma forms are equivalent, and the two orderings of
 * the same filter return the same rows.
 */
type DealListPayload = { items?: Array<{ id?: string }>; total?: number } | null;

test.describe('TC-CRM-5548: repeated list query parameters', () => {
  test('deals list keeps every value of a repeated status filter, in either ordering', async ({ request }) => {
    let token: string | null = null;
    let openDealId: string | null = null;
    let inProgressDealId: string | null = null;
    let wonDealId: string | null = null;

    const stamp = Date.now();

    const listDealIds = async (query: string): Promise<string[]> => {
      const response = await apiRequest(request, 'GET', `/api/customers/deals?${query}`, { token: token as string });
      expect(response.status(), `GET /api/customers/deals?${query} returned ${response.status()}`).toBe(200);
      const payload = (await readJsonSafe(response)) as DealListPayload;
      return (payload?.items ?? [])
        .map((item) => item?.id)
        .filter((value): value is string => typeof value === 'string');
    };

    try {
      token = await getAuthToken(request);
      openDealId = await createDealFixture(request, token, { title: `QA TC-CRM-5548 Open ${stamp}`, status: 'open' });
      inProgressDealId = await createDealFixture(request, token, { title: `QA TC-CRM-5548 InProgress ${stamp}`, status: 'in_progress' });
      wonDealId = await createDealFixture(request, token, { title: `QA TC-CRM-5548 Won ${stamp}`, status: 'win' });

      // 1) The repeated form keeps BOTH selections. Before the fix only the last
      //    value survived, so the `open` deal was missing from this response.
      const repeated = await listDealIds('pageSize=100&status=open&status=in_progress');
      expect(repeated, 'repeated status filter must keep the first selection').toContain(openDealId);
      expect(repeated, 'repeated status filter must keep the last selection').toContain(inProgressDealId);
      expect(repeated, 'a status outside the filter must not be returned').not.toContain(wonDealId);

      // 2) The comma form and the repeated form describe the same filter, so they
      //    must return the same rows.
      const comma = await listDealIds('pageSize=100&status=open,in_progress');
      expect(comma, 'comma form must keep the first selection').toContain(openDealId);
      expect(comma, 'comma form must keep the last selection').toContain(inProgressDealId);
      expect(comma, 'a status outside the filter must not be returned').not.toContain(wonDealId);

      // 3) The response cache keys repeated values order-insensitively. That is only
      //    correct once the two orderings genuinely resolve to the same filter —
      //    before the fix they resolved to `in_progress` and `open` respectively and
      //    collided in the cache.
      const reversed = await listDealIds('pageSize=100&status=in_progress&status=open');
      expect(reversed, 'reversed ordering must keep the `open` deal').toContain(openDealId);
      expect(reversed, 'reversed ordering must keep the `in_progress` deal').toContain(inProgressDealId);
      expect(reversed, 'a status outside the filter must not be returned').not.toContain(wonDealId);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', openDealId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', inProgressDealId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', wonDealId);
    }
  });

  test('deals list honours a repeated ids filter instead of dropping it', async ({ request }) => {
    let token: string | null = null;
    let firstDealId: string | null = null;
    let secondDealId: string | null = null;
    let excludedDealId: string | null = null;

    const stamp = Date.now();

    try {
      token = await getAuthToken(request);
      firstDealId = await createDealFixture(request, token, { title: `QA TC-CRM-5548 Ids A ${stamp}`, status: 'open' });
      secondDealId = await createDealFixture(request, token, { title: `QA TC-CRM-5548 Ids B ${stamp}`, status: 'open' });
      excludedDealId = await createDealFixture(request, token, { title: `QA TC-CRM-5548 Ids C ${stamp}`, status: 'open' });

      // Repeated `?ids=` used to reach `parseIdsParam` as a single string (the last
      // value), narrowing the response to one record. It must resolve to both ids —
      // and must never widen to the unfiltered list.
      const response = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?pageSize=100&ids=${firstDealId}&ids=${secondDealId}`,
        { token },
      );
      expect(response.status(), `GET /api/customers/deals with a repeated ids filter returned ${response.status()}`).toBe(200);
      const payload = (await readJsonSafe(response)) as DealListPayload;
      const ids = (payload?.items ?? [])
        .map((item) => item?.id)
        .filter((value): value is string => typeof value === 'string');

      expect(ids.slice().sort(), 'repeated ids filter must resolve to exactly the requested records').toEqual(
        [firstDealId, secondDealId].sort(),
      );
      expect(ids, 'the ids filter must not widen to unrequested records').not.toContain(excludedDealId);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', firstDealId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', secondDealId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', excludedDealId);
    }
  });
});
