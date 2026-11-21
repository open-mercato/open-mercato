import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPromotionFixture, deletePromotionIfExists, PROMOTIONS_PATH, uniqueStamp } from './helpers';

type TagsOperator = 'has_any_of' | 'has_all_of' | 'has_none_of';

type PromotionListBody = { items?: Array<{ id?: string; tags?: string[] }>; total?: number };

/**
 * TC-PROM-085: the advanced filter's `tags` operators (#7459) filter a multi-valued
 * column end to end. `promotions.tags` is a Postgres `text[]` column; the list route
 * receives the advanced filter through the CRUD factory's `filter[...]` query params.
 *
 * Before the fix `has_all_of` compiled to `$contains`, which the query engine dropped
 * (every row matched), and `has_any_of` / `has_none_of` compiled to `$in` / `$nin`,
 * which do not apply to array columns. Every fixture name carries a unique stamp that
 * the route's `search` param scopes to, so the assertions compare exact id sets and do
 * not depend on seeded or concurrently created promotions.
 */
test.describe('TC-PROM-085: advanced filter tags operators on promotions.tags', () => {
  async function listIds(
    request: APIRequestContext,
    token: string,
    stamp: string,
    condition: { operator: TagsOperator; values: string[] } | null,
  ): Promise<string[]> {
    const params = new URLSearchParams({ search: stamp, pageSize: '100' });
    if (condition) {
      params.set('filter[logic]', 'and');
      params.set('filter[conditions][0][field]', 'tags');
      params.set('filter[conditions][0][op]', condition.operator);
      params.set('filter[conditions][0][value]', JSON.stringify(condition.values));
    }
    const response = await apiRequest(request, 'GET', `${PROMOTIONS_PATH}?${params.toString()}`, { token });
    expect(response.status(), `GET ${PROMOTIONS_PATH} should return 200`).toBe(200);
    const body = await readJsonSafe<PromotionListBody>(response);
    return (body?.items ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string')
      .sort();
  }

  test('has_any_of, has_all_of and has_none_of return exactly the matching promotions', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const vip = `vip_${stamp}`;
    const eu = `eu_${stamp}`;
    const us = `us_${stamp}`;
    const createdIds: string[] = [];

    try {
      const vipEu = await createPromotionFixture(request, token, { name: `QA PROM 085 A ${stamp}`, tags: [vip, eu] });
      createdIds.push(vipEu.id);
      const vipOnly = await createPromotionFixture(request, token, { name: `QA PROM 085 B ${stamp}`, tags: [vip] });
      createdIds.push(vipOnly.id);
      const usOnly = await createPromotionFixture(request, token, { name: `QA PROM 085 C ${stamp}`, tags: [us] });
      createdIds.push(usOnly.id);
      const untagged = await createPromotionFixture(request, token, { name: `QA PROM 085 D ${stamp}`, tags: [] });
      createdIds.push(untagged.id);

      const sorted = (ids: string[]) => [...ids].sort();

      expect(await listIds(request, token, stamp, null), 'baseline: search scopes to the four fixtures').toEqual(
        sorted(createdIds),
      );

      expect(
        await listIds(request, token, stamp, { operator: 'has_any_of', values: [vip] }),
        'has_any_of [vip] matches the promotions tagged vip',
      ).toEqual(sorted([vipEu.id, vipOnly.id]));

      expect(
        await listIds(request, token, stamp, { operator: 'has_any_of', values: [eu, us] }),
        'has_any_of [eu, us] matches either tag',
      ).toEqual(sorted([vipEu.id, usOnly.id]));

      expect(
        await listIds(request, token, stamp, { operator: 'has_all_of', values: [vip, eu] }),
        'has_all_of [vip, eu] matches only the promotion carrying both tags, not every row',
      ).toEqual([vipEu.id]);

      expect(
        await listIds(request, token, stamp, { operator: 'has_all_of', values: [vip, us] }),
        'has_all_of with a tag combination nobody carries matches nothing',
      ).toEqual([]);

      expect(
        await listIds(request, token, stamp, { operator: 'has_none_of', values: [vip] }),
        'has_none_of [vip] excludes every promotion tagged vip',
      ).toEqual(sorted([usOnly.id, untagged.id]));

      expect(
        await listIds(request, token, stamp, { operator: 'has_none_of', values: [vip, us] }),
        'has_none_of [vip, us] keeps only the untagged promotion',
      ).toEqual([untagged.id]);
    } finally {
      for (const id of createdIds) {
        await deletePromotionIfExists(request, token, id);
      }
    }
  });
});
