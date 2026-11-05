import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  assertScalarFieldsPersisted,
  getCustomFieldValue,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';

/**
 * TC-CAT-CRUDFORM-001: Product CrudForm persists scalars + custom fields (#2466, #2555).
 *
 * Catalog's `ce.ts` declares NO system custom fields, so the rich-field coverage the sweep
 * requires is exercised through self-contained custom-field DEFINITIONS created via the
 * entities API. This proves the product CrudForm round-trips:
 *   - scalars (title, subtitle, description, sku, handle, isActive), and
 *   - custom fields of several kinds: a **multichoice** (multi-select), a text field, and an
 *     integer field — on BOTH create and update.
 *
 * Verified contract:
 * - `/api/catalog/products` is a makeCrud route: POST=201 `{ id }`, PUT=200 `{ ok }`,
 *   DELETE via `?id=`. The list GET filters a single record by `?id=` (not `?ids=`).
 * - Request bodies are camelCase; scalar responses snake_case. Custom fields submit under a
 *   top-level `customFields: { <key>: value }` object (split by `splitCustomFieldPayload` on
 *   both create and update) and read back under `customValues` (the harness resolver handles
 *   the shape). Multi-select values are arrays whose element order is not guaranteed, so the
 *   assertions compare sorted copies.
 * - The data engine awaits `query_index.upsert_one` before the write returns, so an immediate
 *   read-back is consistent — no polling.
 *
 * Self-contained: creates its own field definitions + product, deletes them in `finally`.
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const PRODUCTS_PATH = '/api/catalog/products';
const DEFINITIONS_PATH = '/api/entities/definitions';
const PRODUCT_ENTITY_ID = 'catalog:catalog_product';

type ProductFieldDefinition = {
  key: string;
  kind: 'select' | 'text' | 'integer';
  configJson: Record<string, unknown>;
};

async function createProductDefinition(
  request: APIRequestContext,
  token: string,
  definition: ProductFieldDefinition,
): Promise<void> {
  const response = await apiRequest(request, 'POST', DEFINITIONS_PATH, {
    token,
    data: {
      entityId: PRODUCT_ENTITY_ID,
      key: definition.key,
      kind: definition.kind,
      configJson: definition.configJson,
    },
  });
  expect(
    response.status(),
    `create custom field definition "${definition.key}" should be 200`,
  ).toBe(200);
}

async function deleteProductDefinition(
  request: APIRequestContext,
  token: string | null,
  key: string,
): Promise<void> {
  if (!token) return;
  const response = await apiRequest(request, 'DELETE', DEFINITIONS_PATH, {
    token,
    data: { entityId: PRODUCT_ENTITY_ID, key },
  });
  expect([200, 404]).toContain(response.status());
}

async function readProductById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRODUCTS_PATH}?id=${encodeURIComponent(id)}&page=1&pageSize=1`,
    { token },
  );
  expect(response.status(), `read-back products failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  return (body?.items ?? []).find((item) => item.id === id) ?? null;
}

function sortedStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).sort();
  if (value === null || value === undefined) return [];
  return [String(value)];
}

test.describe('TC-CAT-CRUDFORM-001: Product CrudForm persists scalars + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars + multichoice/text/integer custom fields on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const multiKey = `qa_prod_multi_${stamp}`;
    const textKey = `qa_prod_text_${stamp}`;
    const intKey = `qa_prod_warranty_${stamp}`;
    const multiOptions = ['ceramic', 'glass', 'steel', 'wood'];
    let productId: string | null = null;

    try {
      await createProductDefinition(request, token, {
        key: multiKey,
        kind: 'select',
        configJson: { label: `QA Materials ${stamp}`, multi: true, options: multiOptions },
      });
      await createProductDefinition(request, token, {
        key: textKey,
        kind: 'text',
        configJson: { label: `QA Care Instructions ${stamp}` },
      });
      await createProductDefinition(request, token, {
        key: intKey,
        kind: 'integer',
        configJson: { label: `QA Warranty Months ${stamp}` },
      });

      // CREATE — scalars + every custom field kind.
      const createResponse = await apiRequest(request, 'POST', PRODUCTS_PATH, {
        token,
        data: {
          title: `QA CRUDFORM Product ${stamp}`,
          subtitle: 'Original subtitle',
          description: 'Original product description for QA CrudForm coverage.',
          sku: `QA-CF-${stamp}`,
          handle: `qa-cf-${stamp}`,
          isActive: true,
          customFields: {
            [multiKey]: ['ceramic', 'steel'],
            [textKey]: 'Hand wash only',
            [intKey]: 24,
          },
        },
      });
      expect(
        createResponse.status(),
        `create products failed: ${createResponse.status()}`,
      ).toBe(201);
      productId = expectId(
        (await readJsonSafe<{ id?: string }>(createResponse))?.id,
        'product create should return an id',
      );

      const afterCreate = await readProductById(request, token, productId);
      expect(afterCreate, `created product ${productId} should be readable`).toBeTruthy();
      assertScalarFieldsPersisted(
        afterCreate as CrudRecord,
        {
          title: `QA CRUDFORM Product ${stamp}`,
          subtitle: 'Original subtitle',
          description: 'Original product description for QA CrudForm coverage.',
          sku: `QA-CF-${stamp}`,
          handle: `qa-cf-${stamp}`,
          is_active: true,
        },
        'after-create',
      );
      expect(
        sortedStrings(getCustomFieldValue(afterCreate as CrudRecord, multiKey)),
        'after-create multichoice custom field',
      ).toEqual(['ceramic', 'steel']);
      expect(
        getCustomFieldValue(afterCreate as CrudRecord, textKey),
        'after-create text custom field',
      ).toBe('Hand wash only');
      expect(
        Number(getCustomFieldValue(afterCreate as CrudRecord, intKey)),
        'after-create integer custom field',
      ).toBe(24);

      // UPDATE — change scalars and replace every custom field value.
      const updateResponse = await apiRequest(request, 'PUT', PRODUCTS_PATH, {
        token,
        data: {
          id: productId,
          title: `QA CRUDFORM Product ${stamp} EDITED`,
          subtitle: 'Updated subtitle',
          description: 'Updated product description.',
          isActive: false,
          customFields: {
            [multiKey]: ['glass', 'wood'],
            [textKey]: 'Machine washable',
            [intKey]: 36,
          },
        },
      });
      expect(
        updateResponse.status(),
        `update products failed: ${updateResponse.status()}`,
      ).toBe(200);

      const afterUpdate = await readProductById(request, token, productId);
      expect(afterUpdate, `updated product ${productId} should be readable`).toBeTruthy();
      assertScalarFieldsPersisted(
        afterUpdate as CrudRecord,
        {
          title: `QA CRUDFORM Product ${stamp} EDITED`,
          subtitle: 'Updated subtitle',
          description: 'Updated product description.',
          is_active: false,
        },
        'after-update',
      );
      const updatedMulti = sortedStrings(getCustomFieldValue(afterUpdate as CrudRecord, multiKey));
      expect(updatedMulti, 'after-update multichoice custom field').toEqual(['glass', 'wood']);
      expect(updatedMulti, 'after-update multichoice clears old values').not.toContain('ceramic');
      expect(updatedMulti, 'after-update multichoice clears old values').not.toContain('steel');
      expect(
        getCustomFieldValue(afterUpdate as CrudRecord, textKey),
        'after-update text custom field',
      ).toBe('Machine washable');
      expect(
        Number(getCustomFieldValue(afterUpdate as CrudRecord, intKey)),
        'after-update integer custom field',
      ).toBe(36);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
      await deleteProductDefinition(request, token, multiKey);
      await deleteProductDefinition(request, token, textKey);
      await deleteProductDefinition(request, token, intKey);
    }
  });
});
