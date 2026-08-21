import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createResourceTypeFixture,
  deleteResourceTypeIfExists,
  createResourceTagFixture,
  deleteResourceTagIfExists,
  deleteResourceIfExists,
} from './helpers/resourcesFixtures';

export const integrationMeta = {
  dependsOnModules: ['resources'],
};

/**
 * TC-RESO-009 (issue #2461): Resource list search & filters + pagination.
 *
 * The resources list (`/api/resources/resources`) supports `search` (ILIKE on
 * name), `isActive`, `resourceTypeId`, and `tagIds` (comma-separated; matches ANY
 * tag) filters with AND semantics when combined, plus page/pageSize pagination.
 * Every fixture name embeds a unique stamp so the suite stays isolated from any
 * other data. Reads are query-index backed, so each assertion polls until the
 * index reflects the fixtures.
 */
type ResourceListBody = {
  items?: Array<Record<string, unknown>>;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

async function fetchList(request: APIRequestContext, token: string, query: string): Promise<ResourceListBody> {
  const res = await apiRequest(request, 'GET', `/api/resources/resources${query}`, { token });
  expect(res.ok(), `resources list ${query} should succeed (status ${res.status()})`).toBeTruthy();
  return (await readJsonSafe<ResourceListBody>(res)) ?? { items: [] };
}

function namesOf(body: ResourceListBody): string[] {
  return (body.items ?? [])
    .map((item) => item.name)
    .filter((name): name is string => typeof name === 'string')
    .sort((a, b) => a.localeCompare(b));
}

function idsOf(body: ResourceListBody): string[] {
  return (body.items ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string')
    .sort((a, b) => a.localeCompare(b));
}

async function createResource(
  request: APIRequestContext,
  token: string,
  data: { name: string; resourceTypeId?: string; isActive?: boolean; tags?: string[] },
): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/resources/resources', { token, data });
  expect(res.status(), `create resource "${data.name}" should return 201`).toBe(201);
  const id = (await readJsonSafe<{ id?: string }>(res))?.id ?? null;
  expect(id, 'created resource id returned').toBeTruthy();
  return id as string;
}

test.describe('TC-RESO-009: Resource list search & filters', () => {
  test('filters by search, isActive, resourceTypeId, tagIds, combines them (AND), and paginates', async ({ request }) => {
    test.slow();
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();

    let typeId: string | null = null;
    let tagId: string | null = null;
    const resourceIds: string[] = [];
    try {
      typeId = await createResourceTypeFixture(request, token, { name: `QA FilterType ${stamp}` });
      tagId = await createResourceTagFixture(request, token, { label: `QA FilterTag ${stamp}` });

      const warehouseA = `Warehouse A ${stamp}`;
      const warehouseB = `Warehouse B ${stamp}`;
      const storageCabinet = `Storage Cabinet ${stamp}`;
      const oldResource = `Old Resource ${stamp}`;
      const archivedItem = `Archived Item ${stamp}`;

      const whA = await createResource(request, token, { name: warehouseA, resourceTypeId: typeId, isActive: true, tags: [tagId] });
      const whB = await createResource(request, token, { name: warehouseB, resourceTypeId: typeId, isActive: true, tags: [tagId] });
      const storage = await createResource(request, token, {
        name: storageCabinet,
        resourceTypeId: typeId,
        isActive: true,
        tags: [tagId],
      });
      const oldR = await createResource(request, token, { name: oldResource, isActive: false });
      const archived = await createResource(request, token, { name: archivedItem, isActive: false });
      resourceIds.push(whA, whB, storage, oldR, archived);

      // Barrier: wait until all 5 fixtures are indexed (every name contains the stamp).
      await expect
        .poll(async () => namesOf(await fetchList(request, token, `?search=${stamp}&pageSize=100`)).length, {
          timeout: 10000,
          message: 'all 5 fixtures should be indexed',
        })
        .toBe(5);

      // search by name fragment
      await expect
        .poll(async () => namesOf(await fetchList(request, token, `?search=${encodeURIComponent(`Warehouse ${stamp}`)}&pageSize=100`)), {
          timeout: 8000,
          message: 'search should match both Warehouse rows',
        })
        .toEqual([warehouseA, warehouseB].sort((a, b) => a.localeCompare(b)));

      // isActive=true / false (scoped to our stamp)
      await expect
        .poll(async () => namesOf(await fetchList(request, token, `?search=${stamp}&isActive=true&pageSize=100`)), {
          timeout: 8000,
          message: 'isActive=true should return the 3 active rows',
        })
        .toEqual([warehouseA, warehouseB, storageCabinet].sort((a, b) => a.localeCompare(b)));
      await expect
        .poll(async () => namesOf(await fetchList(request, token, `?search=${stamp}&isActive=false&pageSize=100`)), {
          timeout: 8000,
          message: 'isActive=false should return the 2 inactive rows',
        })
        .toEqual([oldResource, archivedItem].sort((a, b) => a.localeCompare(b)));

      // resourceTypeId filter
      await expect
        .poll(async () => idsOf(await fetchList(request, token, `?resourceTypeId=${typeId}&pageSize=100`)), {
          timeout: 8000,
          message: 'resourceTypeId should return only the typed rows',
        })
        .toEqual([whA, whB, storage].sort((a, b) => a.localeCompare(b)));

      // tagIds filter
      await expect
        .poll(async () => idsOf(await fetchList(request, token, `?tagIds=${tagId}&pageSize=100`)), {
          timeout: 8000,
          message: 'tagIds should return only the tagged rows',
        })
        .toEqual([whA, whB, storage].sort((a, b) => a.localeCompare(b)));

      // combined filters apply AND semantics
      await expect
        .poll(
          async () =>
            namesOf(
              await fetchList(
                request,
                token,
                `?search=${encodeURIComponent(`Warehouse ${stamp}`)}&isActive=true&tagIds=${tagId}&pageSize=100`,
              ),
            ),
          { timeout: 8000, message: 'combined filters should intersect to the 2 Warehouse rows' },
        )
        .toEqual([warehouseA, warehouseB].sort((a, b) => a.localeCompare(b)));

      // pagination
      const page1 = await fetchList(request, token, `?search=${stamp}&page=1&pageSize=2`);
      expect(page1.items?.length, 'page 1 holds pageSize items').toBe(2);
      expect(page1.total, 'total reflects all 5 fixtures').toBe(5);
      expect(page1.page, 'page echoes 1').toBe(1);
      expect(page1.pageSize, 'pageSize echoes 2').toBe(2);
      expect(page1.totalPages, 'totalPages = ceil(5 / 2)').toBe(3);
    } finally {
      for (const id of resourceIds) {
        await deleteResourceIfExists(request, token, id);
      }
      await deleteResourceTagIfExists(request, token, tagId);
      await deleteResourceTypeIfExists(request, token, typeId);
    }
  });
});
