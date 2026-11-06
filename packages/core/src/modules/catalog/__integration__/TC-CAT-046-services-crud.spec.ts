import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCategoryFixture,
  deleteCatalogCategoryIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CAT-046: Catalog services CRUD over `/api/catalog/services`
 *
 * Verifies:
 * - create with scope, category, default price and ordered work requirements
 * - read-back by `?id=` including the decorated `category` and `workRequirements`
 * - update that changes the title, clears the category and replaces the work requirements
 * - list filtering by `search`, `ids` (intersected with search) and `isActive`
 * - schema validation rejects a non-positive work allocation and an unknown target type
 * - delete removes the service from the list
 *
 * Self-contained: the category and the service are created through the API and removed in `finally`.
 */
export const integrationMeta = { dependsOnModules: ['catalog'] };

type WorkRequirementRow = {
  id?: string;
  targetType?: string;
  targetId?: string | null;
  labelSnapshot?: string;
  allocationMode?: string;
  allocationValue?: string | number;
  sortOrder?: number;
};

type ServiceRow = {
  id: string;
  title?: string | null;
  scope?: string | null;
  category_id?: string | null;
  category?: { id: string; name: string; slug: string | null } | null;
  default_price_amount?: string | number | null;
  default_price_currency_code?: string | null;
  is_active?: boolean | null;
  media?: unknown[];
  workRequirements?: WorkRequirementRow[];
};

const SERVICES_PATH = '/api/catalog/services';

async function listServices(request: APIRequestContext, token: string, query: string): Promise<ServiceRow[]> {
  const response = await apiRequest(request, 'GET', `${SERVICES_PATH}?${query}`, { token });
  expect(response.status(), `GET ${SERVICES_PATH}?${query} should return 200`).toBe(200);
  return (await readJsonSafe<{ items?: ServiceRow[] }>(response))?.items ?? [];
}

async function readService(request: APIRequestContext, token: string, serviceId: string): Promise<ServiceRow> {
  const items = await listServices(request, token, `id=${encodeURIComponent(serviceId)}`);
  expect(items, 'GET by id should return exactly the requested service').toHaveLength(1);
  return items[0];
}

test.describe('TC-CAT-046: catalog services CRUD', () => {
  test('creates, reads, filters, updates, validates and deletes a service', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = `${Date.now()}${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const searchToken = `qasvc${stamp}`;
    const title = `QA Service ${searchToken}`;
    const staffRoleId = randomUUID();
    let categoryId: string | null = null;
    let serviceId: string | null = null;

    try {
      categoryId = await createCategoryFixture(request, token, { name: `QA Service Category ${stamp}` });

      const created = await apiRequest(request, 'POST', SERVICES_PATH, {
        token,
        data: {
          title,
          scope: 'On-site installation and calibration',
          categoryId,
          defaultPriceAmount: 125.5,
          defaultPriceCurrencyCode: 'USD',
          workRequirements: [
            {
              targetType: 'generic',
              labelSnapshot: 'Any technician',
              allocationMode: 'fixed_hours',
              allocationValue: 1.5,
            },
            {
              targetType: 'staff_role',
              targetId: staffRoleId,
              labelSnapshot: 'Senior installer',
              allocationMode: 'ratio',
              allocationValue: 0.5,
            },
          ],
        },
      });
      expect(created.status(), `POST ${SERVICES_PATH} should return 201: ${(await created.text()).slice(0, 500)}`).toBe(201);
      serviceId = expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'create response should carry the service id');

      const service = await readService(request, token, serviceId);
      expect(service.title).toBe(title);
      expect(service.scope).toBe('On-site installation and calibration');
      expect(service.category_id).toBe(categoryId);
      expect(service.category?.id).toBe(categoryId);
      expect(service.category?.name).toBe(`QA Service Category ${stamp}`);
      expect(Number(service.default_price_amount)).toBeCloseTo(125.5, 2);
      expect(service.default_price_currency_code).toBe('USD');
      expect(service.is_active).toBe(true);
      expect(service.media ?? []).toEqual([]);
      const requirements = service.workRequirements ?? [];
      expect(requirements).toHaveLength(2);
      expect(requirements.map((row) => row.targetType)).toEqual(['generic', 'staff_role']);
      expect(requirements[0].targetId ?? null).toBeNull();
      expect(requirements[0].labelSnapshot).toBe('Any technician');
      expect(requirements[0].allocationMode).toBe('fixed_hours');
      expect(Number(requirements[0].allocationValue)).toBeCloseTo(1.5, 4);
      expect(requirements[1].targetId).toBe(staffRoleId);
      expect(requirements[1].labelSnapshot).toBe('Senior installer');
      expect(requirements[1].allocationMode).toBe('ratio');
      expect(Number(requirements[1].allocationValue)).toBeCloseTo(0.5, 4);

      const updatedTitle = `${title} updated`;
      const updated = await apiRequest(request, 'PUT', SERVICES_PATH, {
        token,
        data: {
          id: serviceId,
          title: updatedTitle,
          categoryId: null,
          workRequirements: [
            {
              targetType: 'resource_type',
              targetId: randomUUID(),
              labelSnapshot: 'Lift platform',
              allocationMode: 'fixed_hours',
              allocationValue: 2,
            },
          ],
        },
      });
      expect(updated.status(), `PUT ${SERVICES_PATH} should return 200: ${(await updated.text()).slice(0, 500)}`).toBe(200);
      expect(await readJsonSafe<{ ok?: boolean }>(updated)).toEqual({ ok: true });

      const afterUpdate = await readService(request, token, serviceId);
      expect(afterUpdate.title).toBe(updatedTitle);
      expect(afterUpdate.category_id ?? null).toBeNull();
      expect(afterUpdate.category ?? null).toBeNull();
      expect(Number(afterUpdate.default_price_amount), 'untouched price survives a partial update').toBeCloseTo(125.5, 2);
      const replaced = afterUpdate.workRequirements ?? [];
      expect(replaced, 'work requirements are replaced, not appended').toHaveLength(1);
      expect(replaced[0].targetType).toBe('resource_type');
      expect(replaced[0].labelSnapshot).toBe('Lift platform');
      expect(Number(replaced[0].allocationValue)).toBeCloseTo(2, 4);

      const searched = await listServices(request, token, `search=${encodeURIComponent(searchToken)}`);
      expect(searched.map((row) => row.id)).toEqual([serviceId]);

      const searchedWithForeignIds = await listServices(
        request,
        token,
        `search=${encodeURIComponent(searchToken)}&ids=${encodeURIComponent(randomUUID())}`,
      );
      expect(searchedWithForeignIds, '`ids` intersects with the search matches').toEqual([]);

      const searchedWithOwnIds = await listServices(
        request,
        token,
        `search=${encodeURIComponent(searchToken)}&ids=${encodeURIComponent(serviceId)}`,
      );
      expect(searchedWithOwnIds.map((row) => row.id)).toEqual([serviceId]);

      const inactive = await listServices(request, token, `search=${encodeURIComponent(searchToken)}&isActive=false`);
      expect(inactive.map((row) => row.id), 'isActive=false excludes an active service').not.toContain(serviceId);
      const active = await listServices(request, token, `search=${encodeURIComponent(searchToken)}&isActive=true`);
      expect(active.map((row) => row.id)).toContain(serviceId);

      const negativeAllocation = await apiRequest(request, 'POST', SERVICES_PATH, {
        token,
        data: {
          title: `${title} invalid allocation`,
          workRequirements: [
            { targetType: 'generic', labelSnapshot: 'Invalid', allocationMode: 'ratio', allocationValue: -1 },
          ],
        },
      });
      expect(negativeAllocation.status(), 'a negative allocationValue is rejected').toBe(400);

      const unknownTarget = await apiRequest(request, 'POST', SERVICES_PATH, {
        token,
        data: {
          title: `${title} invalid target`,
          workRequirements: [
            { targetType: 'spaceship', labelSnapshot: 'Invalid', allocationMode: 'ratio', allocationValue: 1 },
          ],
        },
      });
      expect(unknownTarget.status(), 'an unknown work target type is rejected').toBe(400);

      const afterRejections = await listServices(request, token, `search=${encodeURIComponent(searchToken)}`);
      expect(afterRejections.map((row) => row.id), 'rejected creates must not persist a service').toEqual([serviceId]);

      const deleted = await apiRequest(request, 'DELETE', `${SERVICES_PATH}?id=${encodeURIComponent(serviceId)}`, { token });
      expect(deleted.status(), `DELETE ${SERVICES_PATH} should return 200`).toBe(200);
      expect(await readJsonSafe<{ ok?: boolean }>(deleted)).toEqual({ ok: true });

      const afterDelete = await listServices(request, token, `id=${encodeURIComponent(serviceId)}`);
      expect(afterDelete, 'a deleted service is no longer listed').toEqual([]);
      serviceId = null;
    } finally {
      await deleteGeneralEntityIfExists(request, token, SERVICES_PATH, serviceId);
      await deleteCatalogCategoryIfExists(request, token, categoryId);
    }
  });
});
