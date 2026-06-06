import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';
import {
  createCategoryFixture,
  deleteCatalogCategoryIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures';

/**
 * TC-CAT-CRUDFORM-003: Category CrudForm persists scalars + parent link (#2466, #2555).
 *
 * Proves the category CrudForm round-trips its scalars (name, slug, description, isActive) and
 * the `parentId` hierarchy link on both create and update.
 *
 * Verified contract:
 * - `/api/catalog/categories` POST/PUT/DELETE are makeCrud actions: POST=201 `{ id }`,
 *   PUT=200 `{ ok }`, DELETE via `?id=`. The GET is HAND-WRITTEN (the `manage` view) and
 *   returns **camelCase** rows filtered by `?ids=` (comma-separated) — there is no `?id=`
 *   single filter — so a custom `readById` is supplied. Because responses are camelCase, the
 *   asserted scalar keys are camelCase (`parentId`, `isActive`, ...), unlike the snake_case
 *   product/variant routes.
 * - Categories do not accept custom fields on create/update, so this surface is scalars-only.
 *
 * Self-contained: creates its own parent category, deletes it in `finally`; the harness
 * deletes the child category it creates. Gated by
 * `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const CATEGORIES_PATH = '/api/catalog/categories';

async function readCategoryById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${CATEGORIES_PATH}?ids=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back categories failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  return (body?.items ?? []).find((item) => item.id === id) ?? null;
}

test.describe('TC-CAT-CRUDFORM-003: Category CrudForm persists scalars + parent', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips name/slug/description/parentId/isActive on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    let parentId: string | null = null;

    try {
      parentId = await createCategoryFixture(request, token, {
        name: `QA CRUDFORM Parent ${stamp}`,
      });

      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: CATEGORIES_PATH,
        readById: (id) => readCategoryById(request, token, id),
        create: {
          payload: {
            name: `QA CRUDFORM Category ${stamp}`,
            slug: `qa-crudform-cat-${stamp}`,
            description: 'Original category description',
            parentId,
            isActive: true,
          },
        },
        expectAfterCreate: {
          scalars: {
            name: `QA CRUDFORM Category ${stamp}`,
            slug: `qa-crudform-cat-${stamp}`,
            description: 'Original category description',
            parentId,
            isActive: true,
          },
        },
        update: {
          payload: (id) => ({
            id,
            name: `QA CRUDFORM Category ${stamp} EDITED`,
            slug: `qa-crudform-cat-${stamp}-e`,
            description: 'Updated category description',
            isActive: false,
          }),
        },
        expectAfterUpdate: {
          scalars: {
            name: `QA CRUDFORM Category ${stamp} EDITED`,
            slug: `qa-crudform-cat-${stamp}-e`,
            description: 'Updated category description',
            // parentId is omitted from the update payload — a partial update retains it.
            parentId,
            isActive: false,
          },
        },
      });
    } finally {
      await deleteCatalogCategoryIfExists(request, token, parentId);
    }
  });
});
