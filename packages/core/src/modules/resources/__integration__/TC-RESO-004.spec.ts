import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { slugifyTagLabel } from '@open-mercato/shared/lib/utils';
import {
  createResourceFixture,
  deleteResourceIfExists,
  deleteResourceTagIfExists,
} from './helpers/resourcesFixtures';

export const integrationMeta = {
  dependsOnModules: ['resources'],
};

/**
 * TC-RESO-004 (issue #2461): Resource Tags CRUD happy path.
 *
 * Tags are a many-to-many concept with dedicated CRUD over `/api/resources/tags`.
 * This spec verifies create (slug auto-derived from the label via
 * `slugifyTagLabel` when omitted), search by label OR slug, update, and the
 * ACTUAL delete contract: the `resources.resourceTags.delete` command performs a
 * HARD delete and atomically `nativeDelete`s the tag's assignments, so deleting a
 * tag also removes it from any resource it was assigned to. The tags list is
 * served directly from the ORM (camelCase items, `{ items, total }` shape) rather
 * than the query index.
 */
type TagListBody = { items?: Array<Record<string, unknown>>; total?: number };

async function listTags(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await apiRequest(request, 'GET', `/api/resources/tags${query}`, { token });
  expect(res.ok(), `tags list should succeed (status ${res.status()})`).toBeTruthy();
  const body = await readJsonSafe<TagListBody>(res);
  return body?.items ?? [];
}

async function resourceTagIds(
  request: APIRequestContext,
  token: string,
  resourceId: string,
): Promise<string[]> {
  const res = await apiRequest(request, 'GET', `/api/resources/resources?ids=${encodeURIComponent(resourceId)}`, { token });
  const body = await readJsonSafe<{ items?: Array<{ id?: string; tags?: Array<{ id?: string }> }> }>(res);
  const item = (body?.items ?? []).find((entry) => entry.id === resourceId);
  const tags = Array.isArray(item?.tags) ? item!.tags : [];
  return tags
    .map((tag) => (typeof tag?.id === 'string' ? tag.id : null))
    .filter((id): id is string => typeof id === 'string');
}

test.describe('TC-RESO-004: Resource Tags CRUD + slug autogen + hard-delete cascade', () => {
  test('creates with auto slug, searches by label/slug, updates, assigns, and hard-deletes with cascade', async ({ request }) => {
    test.slow();
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const label = `QA Tag ${stamp}`;
    const expectedSlug = slugifyTagLabel(label);

    let tagId: string | null = null;
    let resourceId: string | null = null;
    try {
      // Create with slug omitted -> auto-derived from the label.
      const createRes = await apiRequest(request, 'POST', '/api/resources/tags', {
        token,
        data: { label, color: '#112233', description: 'urgent' },
      });
      expect(createRes.status(), 'create tag should return 201').toBe(201);
      tagId = (await readJsonSafe<{ id?: string }>(createRes))?.id ?? null;
      expect(tagId, 'tag id returned').toBeTruthy();

      // Searchable by label; fields round-trip; slug auto-derived.
      const byLabel = (await listTags(request, token, `?search=${encodeURIComponent(label)}`)).find((tag) => tag.id === tagId);
      expect(byLabel, 'tag should be searchable by label').toBeTruthy();
      expect(byLabel!.label).toBe(label);
      expect(byLabel!.slug).toBe(expectedSlug);
      expect(byLabel!.color).toBe('#112233');
      expect(byLabel!.description).toBe('urgent');

      // Searchable by slug too.
      const bySlug = await listTags(request, token, `?search=${encodeURIComponent(expectedSlug)}`);
      expect(bySlug.some((tag) => tag.id === tagId), 'tag should be searchable by slug').toBe(true);

      // Update label + color.
      const renamed = `QA Tag RENAMED ${stamp}`;
      const updateRes = await apiRequest(request, 'PUT', '/api/resources/tags', {
        token,
        data: { id: tagId, label: renamed, color: '#445566' },
      });
      expect(updateRes.status(), 'update tag should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(updateRes))?.ok, 'update reports ok').toBe(true);

      const afterUpdate = (await listTags(request, token, `?search=${encodeURIComponent(renamed)}`)).find((tag) => tag.id === tagId);
      expect(afterUpdate?.label).toBe(renamed);
      expect(afterUpdate?.color).toBe('#445566');

      // Assign the tag to a resource and confirm it shows up on the resource.
      resourceId = await createResourceFixture(request, token, `QA Tagged Resource ${stamp}`);
      const assignRes = await apiRequest(request, 'POST', '/api/resources/resources/tags/assign', {
        token,
        data: { resourceId, tagId },
      });
      expect(assignRes.status(), 'assign tag to resource should return 201').toBe(201);
      await expect
        .poll(async () => (await resourceTagIds(request, token, resourceId!)).includes(tagId!), {
          timeout: 8000,
          message: 'assigned tag should appear on the resource',
        })
        .toBe(true);

      // Hard delete the tag -> it disappears AND its assignment is cascade-removed.
      const delRes = await apiRequest(request, 'DELETE', `/api/resources/tags?id=${encodeURIComponent(tagId!)}`, { token });
      expect(delRes.status(), 'delete tag should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(delRes))?.ok, 'delete reports ok').toBe(true);

      const afterDelete = await listTags(request, token, `?search=${encodeURIComponent(renamed)}`);
      expect(afterDelete.some((tag) => tag.id === tagId), 'deleted tag must be gone from the list').toBe(false);
      await expect
        .poll(async () => (await resourceTagIds(request, token, resourceId!)).includes(tagId!), {
          timeout: 8000,
          message: 'tag delete should cascade-remove its assignments',
        })
        .toBe(false);
      tagId = null;
    } finally {
      await deleteResourceTagIfExists(request, token, tagId);
      await deleteResourceIfExists(request, token, resourceId);
    }
  });
});
