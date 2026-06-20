import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createResourceTypeFixture,
  deleteResourceTypeIfExists,
  deleteResourceIfExists,
} from './helpers/resourcesFixtures';

export const integrationMeta = {
  dependsOnModules: ['resources'],
};

/**
 * TC-RESO-003 (issue #2461): Resource Types CRUD happy path + referential
 * delete guard.
 *
 * Resource types are a secondary CRUD entity (1 type : N resources). This spec
 * exercises create/read/search/update over `/api/resources/resource-types`,
 * links a resource to the type, and verifies the ACTUAL delete contract: the
 * `resources.resourceTypes.delete` command counts non-deleted resources bound to
 * the type and BLOCKS deletion with HTTP 400 while any remain
 * ("Resource type has assigned resources."), only soft-deleting once the type is
 * unused. Scope (tenantId/organizationId) is injected from the auth token, so
 * payloads omit it. List reads are query-index backed, so reads poll briefly.
 */
type ListBody = { items?: Array<Record<string, unknown>>; total?: number };

async function listResourceTypes(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await apiRequest(request, 'GET', `/api/resources/resource-types${query}`, { token });
  expect(res.ok(), `resource-types list should succeed (status ${res.status()})`).toBeTruthy();
  const body = await readJsonSafe<ListBody>(res);
  return body?.items ?? [];
}

test.describe('TC-RESO-003: Resource Types CRUD + referential delete guard', () => {
  test('creates, searches, updates, links a resource, blocks in-use delete, then soft-deletes', async ({ request }) => {
    test.slow();
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const typeName = `QA Type ${stamp}`;

    let typeId: string | null = null;
    let resourceId: string | null = null;
    try {
      typeId = await createResourceTypeFixture(request, token, {
        name: typeName,
        description: 'climate-controlled',
        appearanceIcon: 'box',
        appearanceColor: '#aabbcc',
      });

      // Appears in search with the persisted fields + resourceCount enrichment.
      await expect
        .poll(
          async () => {
            const items = await listResourceTypes(request, token, `?search=${encodeURIComponent(typeName)}&pageSize=50`);
            return items.some((item) => item.id === typeId);
          },
          { timeout: 8000, message: 'created resource type should appear in search results' },
        )
        .toBe(true);

      const created = (await listResourceTypes(request, token, `?search=${encodeURIComponent(typeName)}&pageSize=50`)).find(
        (item) => item.id === typeId,
      );
      expect(created, 'created type present in search').toBeTruthy();
      expect(created!.name).toBe(typeName);
      expect(created!.appearance_icon).toBe('box');
      expect(created!.appearance_color).toBe('#aabbcc');
      expect(created!.resourceCount).toBe(0);
      expect(typeof created!.created_at).toBe('string');
      expect(typeof created!.updated_at).toBe('string');

      // Update name + color.
      const updatedName = `QA Type UPDATED ${stamp}`;
      const updateRes = await apiRequest(request, 'PUT', '/api/resources/resource-types', {
        token,
        data: { id: typeId, name: updatedName, appearanceColor: '#001122' },
      });
      expect(updateRes.status(), 'update resource type should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(updateRes))?.ok, 'update reports ok').toBe(true);

      await expect
        .poll(
          async () => {
            const items = await listResourceTypes(request, token, `?ids=${encodeURIComponent(typeId!)}`);
            return items[0]?.name ?? null;
          },
          { timeout: 8000, message: 'updated name should be readable by id' },
        )
        .toBe(updatedName);
      const afterUpdate = (await listResourceTypes(request, token, `?ids=${encodeURIComponent(typeId)}`))[0];
      expect(afterUpdate.appearance_color).toBe('#001122');

      // Link a resource to the type.
      const resCreate = await apiRequest(request, 'POST', '/api/resources/resources', {
        token,
        data: { name: `QA Typed Resource ${stamp}`, resourceTypeId: typeId, isActive: true },
      });
      expect(resCreate.status(), 'create resource linked to type should return 201').toBe(201);
      resourceId = (await readJsonSafe<{ id?: string }>(resCreate))?.id ?? null;
      expect(resourceId, 'linked resource id returned').toBeTruthy();

      // Resource persists resource_type_id; the type's resourceCount reflects it.
      await expect
        .poll(
          async () => {
            const res = await apiRequest(request, 'GET', `/api/resources/resources?ids=${encodeURIComponent(resourceId!)}`, {
              token,
            });
            const body = await readJsonSafe<ListBody>(res);
            return body?.items?.[0]?.resource_type_id ?? null;
          },
          { timeout: 8000, message: 'resource should persist resource_type_id' },
        )
        .toBe(typeId);
      await expect
        .poll(
          async () => {
            const items = await listResourceTypes(request, token, `?ids=${encodeURIComponent(typeId!)}`);
            return items[0]?.resourceCount ?? null;
          },
          { timeout: 8000, message: 'type resourceCount should reflect the linked resource' },
        )
        .toBe(1);

      // In-use delete is blocked by the referential guard (HTTP 400).
      const blockedDelete = await apiRequest(
        request,
        'DELETE',
        `/api/resources/resource-types?id=${encodeURIComponent(typeId)}`,
        { token },
      );
      expect(blockedDelete.status(), 'deleting an in-use resource type must be blocked with 400').toBe(400);
      const blockedBody = await readJsonSafe<{ error?: string }>(blockedDelete);
      expect(typeof blockedBody?.error, 'blocked delete returns an error message').toBe('string');
      expect(
        (await listResourceTypes(request, token, `?ids=${encodeURIComponent(typeId)}`)).length,
        'blocked type must still exist',
      ).toBe(1);

      // Remove the dependent resource, then the now-unused type soft-deletes.
      const delResource = await apiRequest(
        request,
        'DELETE',
        `/api/resources/resources?id=${encodeURIComponent(resourceId!)}`,
        { token },
      );
      expect(delResource.status(), 'delete dependent resource should return 200').toBe(200);
      resourceId = null;

      const okDelete = await apiRequest(
        request,
        'DELETE',
        `/api/resources/resource-types?id=${encodeURIComponent(typeId)}`,
        { token },
      );
      expect(okDelete.status(), 'delete unused resource type should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(okDelete))?.ok, 'delete reports ok').toBe(true);

      await expect
        .poll(
          async () => (await listResourceTypes(request, token, `?ids=${encodeURIComponent(typeId!)}`)).length,
          { timeout: 8000, message: 'soft-deleted type should disappear from the list' },
        )
        .toBe(0);
      typeId = null;
    } finally {
      await deleteResourceIfExists(request, token, resourceId);
      await deleteResourceTypeIfExists(request, token, typeId);
    }
  });
});
