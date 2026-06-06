import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

const PRODUCT_ENTITY_ID = 'catalog:catalog_product';

/**
 * TC-CAT-CF-MULTI-EDIT-001
 *
 * Companion regression to TC-CRM-CF-MULTI-EDIT-001. The product detail edit page
 * already wraps custom-field values under `customFields` (so this path was not
 * the deal bug), but the "required resources" multichoice field is the
 * product-side surface in the same report. This test pins the contract: a
 * product multi-select custom field created with one set must persist a DIFFERENT
 * set after an update, with the old values cleared.
 *
 * Self-contained: creates its own multi-select definition + product and cleans
 * up in finally.
 */

async function createMultiSelectProductDefinition(
  request: APIRequestContext,
  token: string,
  input: { key: string; label: string; options: string[] },
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/entities/definitions', {
    token,
    data: {
      entityId: PRODUCT_ENTITY_ID,
      key: input.key,
      kind: 'select',
      configJson: {
        label: input.label,
        multi: true,
        options: input.options,
      },
    },
  });
  expect(
    response.status(),
    'POST /api/entities/definitions should create the multi-select product field',
  ).toBe(200);
}

async function deleteProductDefinition(
  request: APIRequestContext,
  token: string | null,
  key: string,
): Promise<void> {
  if (!token) return;
  const response = await apiRequest(request, 'DELETE', '/api/entities/definitions', {
    token,
    data: { entityId: PRODUCT_ENTITY_ID, key },
  });
  expect([200, 404]).toContain(response.status());
}

async function fetchProductCustomValues(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/catalog/products?id=${encodeURIComponent(productId)}&page=1&pageSize=1`,
    { token },
  );
  expect(response.ok(), `GET /api/catalog/products failed: ${response.status()}`).toBeTruthy();
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response);
  const item = Array.isArray(body?.items) ? body?.items?.[0] : undefined;
  expect(item, 'product should be returned by list-by-id query').toBeTruthy();
  const record = item as Record<string, unknown>;
  const customValues =
    record.customValues && typeof record.customValues === 'object'
      ? (record.customValues as Record<string, unknown>)
      : {};
  return customValues;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).sort();
  if (value === null || value === undefined) return [];
  return [String(value)];
}

test.describe('TC-CAT-CF-MULTI-EDIT-001: product multichoice custom field persists on edit', () => {
  test('updating a product multi-select replaces the old values', async ({ request }) => {
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const fieldKey = `qa_prod_multi_${stamp}`;
    const fieldLabel = `QA Resources ${stamp}`;
    const options = ['stylist', 'therapist', 'treatment_room', 'wash_station'];

    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      await createMultiSelectProductDefinition(request, token, {
        key: fieldKey,
        label: fieldLabel,
        options,
      });
      productId = await createProductFixture(request, token, {
        title: `QA CF Multi Product ${stamp}`,
        sku: `QA-CFM-${stamp}`,
      });

      // Seed an initial multi-value set via the product update route.
      const seedRes = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: {
          id: productId,
          customFields: { [fieldKey]: ['stylist', 'therapist'] },
        },
      });
      expect(seedRes.ok(), `seed update failed: ${seedRes.status()}`).toBeTruthy();

      // customValues come from the query index, which the data engine now updates
      // synchronously (awaited `query_index.upsert_one`), so an immediate read after
      // the write is consistent — no polling needed.
      const afterSeed = await fetchProductCustomValues(request, token, productId as string);
      expect(asStringArray(afterSeed[fieldKey])).toEqual(['stylist', 'therapist']);

      // EDIT to a different multi-value set.
      const updateRes = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: {
          id: productId,
          customFields: { [fieldKey]: ['treatment_room', 'wash_station'] },
        },
      });
      expect(updateRes.ok(), `update failed: ${updateRes.status()}`).toBeTruthy();

      // The product list endpoint serves customValues from the query index. The index
      // is updated synchronously in the write path (the data engine awaits
      // `query_index.upsert_one` before the PUT returns), so the new values are visible
      // on an immediate read and the old ones are gone — deterministically.
      const afterUpdate = await fetchProductCustomValues(request, token, productId as string);
      expect(asStringArray(afterUpdate[fieldKey])).toEqual(['treatment_room', 'wash_station']);
      expect(asStringArray(afterUpdate[fieldKey])).not.toContain('stylist');
      expect(asStringArray(afterUpdate[fieldKey])).not.toContain('therapist');
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
      await deleteProductDefinition(request, token, fieldKey);
    }
  });
});
