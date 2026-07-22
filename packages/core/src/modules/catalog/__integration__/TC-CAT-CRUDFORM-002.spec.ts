import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures';

/**
 * TC-CAT-CRUDFORM-002: Variant CrudForm persists scalars + prices (#2466, #2555).
 *
 * The variant surface in the sweep is "variant (prices)". Two facets:
 *   1. The variant's own scalars (name, sku, barcode, is_default, is_active) and the
 *      `option_values` JSON map round-trip on create + update — driven by the shared
 *      `runCrudFormRoundTrip` harness against the makeCrud `/api/catalog/variants` route.
 *   2. A variant's PRICE persists on create + update. Prices are a SEPARATE sub-resource
 *      (`/api/catalog/prices`) keyed by `variantId`, not an inline field on the variant
 *      payload, so the price facet is exercised inline.
 *
 * Verified contract:
 * - `/api/catalog/variants`: POST=201 `{ id }` (requires `productId`; org/tenant inherited
 *   from the product), PUT=200 `{ ok }`, DELETE via `?id=`, list filters a single record by
 *   `?id=`. Bodies camelCase; responses snake_case (`product_id`, `is_active`, ...).
 * - `/api/catalog/prices`: POST=201 `{ id }` (requires `currencyCode` + `priceKindId`),
 *   PUT=200 `{ ok }`, hard-delete via `?id=`, read-back filtered by `?variantId=`. Numeric
 *   columns may serialize as strings, so amount/quantity assertions coerce with `Number()`.
 *
 * Self-contained: creates its own product, price-kind, and variant fixtures and deletes them
 * in `finally`. Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off).
 */
const PRODUCTS_PATH = '/api/catalog/products';
const VARIANTS_PATH = '/api/catalog/variants';
const PRICES_PATH = '/api/catalog/prices';
const PRICE_KINDS_PATH = '/api/catalog/price-kinds';

function uniqueStamp(): string {
  return `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

async function createPriceKindFixture(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
    token,
    data: { code: `qa_pk_${stamp}`, title: `QA CRUDFORM Price Kind ${stamp}` },
  });
  expect(response.status(), `price-kind fixture create should be 201`).toBe(201);
  return expectId(
    (await readJsonSafe<{ id?: string }>(response))?.id,
    'price-kind fixture should return an id',
  );
}

async function readPriceById(
  request: APIRequestContext,
  token: string,
  variantId: string,
  priceId: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRICES_PATH}?variantId=${encodeURIComponent(variantId)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back prices failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  return (body?.items ?? []).find((item) => item.id === priceId) ?? null;
}

test.describe('TC-CAT-CRUDFORM-002: Variant CrudForm persists scalars + prices', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips variant scalars + optionValues on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let productId: string | null = null;

    try {
      productId = await createProductFixture(request, token, {
        title: `QA CRUDFORM Variant Product ${stamp}`,
        sku: `QA-VP-${stamp}`,
      });

      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: VARIANTS_PATH,
        create: {
          payload: {
            productId,
            name: `QA CRUDFORM Variant ${stamp}`,
            sku: `QA-VAR-${stamp}`,
            barcode: `BC-${stamp}`,
            isDefault: true,
            isActive: true,
            optionValues: { size: 'L', color: 'red' },
          },
        },
        expectAfterCreate: {
          scalars: {
            product_id: productId,
            name: `QA CRUDFORM Variant ${stamp}`,
            sku: `QA-VAR-${stamp}`,
            barcode: `BC-${stamp}`,
            is_default: true,
            is_active: true,
            option_values: { size: 'L', color: 'red' },
          },
        },
        update: {
          payload: (id) => ({
            id,
            name: `QA CRUDFORM Variant ${stamp} EDITED`,
            barcode: `BC-${stamp}-E`,
            isActive: false,
            optionValues: { size: 'XL', color: 'blue' },
          }),
        },
        expectAfterUpdate: {
          scalars: {
            name: `QA CRUDFORM Variant ${stamp} EDITED`,
            barcode: `BC-${stamp}-E`,
            is_active: false,
            option_values: { size: 'XL', color: 'blue' },
          },
        },
      });
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });

  test('variant price persists on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let variantId: string | null = null;
    let priceId: string | null = null;

    try {
      productId = await createProductFixture(request, token, {
        title: `QA CRUDFORM Price Product ${stamp}`,
        sku: `QA-PP-${stamp}`,
      });
      priceKindId = await createPriceKindFixture(request, token, stamp);
      variantId = await createVariantFixture(request, token, {
        productId,
        name: `QA CRUDFORM Price Variant ${stamp}`,
        sku: `QA-PVAR-${stamp}`,
      });

      // CREATE price for the variant.
      const createResponse = await apiRequest(request, 'POST', PRICES_PATH, {
        token,
        data: {
          productId,
          variantId,
          priceKindId,
          currencyCode: 'USD',
          minQuantity: 1,
          unitPriceGross: 49.99,
        },
      });
      expect(createResponse.status(), `create price failed: ${createResponse.status()}`).toBe(201);
      priceId = expectId(
        (await readJsonSafe<{ id?: string }>(createResponse))?.id,
        'price create should return an id',
      );

      const afterCreate = await readPriceById(request, token, variantId, priceId);
      expect(afterCreate, `created price ${priceId} should be readable`).toBeTruthy();
      expect(afterCreate!.variant_id, 'price links to variant').toBe(variantId);
      expect(afterCreate!.product_id, 'price links to product').toBe(productId);
      expect(afterCreate!.price_kind_id, 'price links to price-kind').toBe(priceKindId);
      expect(afterCreate!.currency_code, 'price currency persists').toBe('USD');
      expect(Number(afterCreate!.min_quantity), 'price min_quantity persists').toBe(1);
      expect(Number(afterCreate!.unit_price_gross), 'price unit_price_gross persists').toBe(49.99);

      // UPDATE the price.
      const updateResponse = await apiRequest(request, 'PUT', PRICES_PATH, {
        token,
        data: { id: priceId, unitPriceGross: 59.95, minQuantity: 5 },
      });
      expect(updateResponse.status(), `update price failed: ${updateResponse.status()}`).toBe(200);

      const afterUpdate = await readPriceById(request, token, variantId, priceId);
      expect(afterUpdate, `updated price ${priceId} should be readable`).toBeTruthy();
      expect(Number(afterUpdate!.unit_price_gross), 'updated unit_price_gross persists').toBe(59.95);
      expect(Number(afterUpdate!.min_quantity), 'updated min_quantity persists').toBe(5);
      expect(afterUpdate!.currency_code, 'currency unchanged on update').toBe('USD');
      expect(afterUpdate!.variant_id, 'variant link unchanged on update').toBe(variantId);
      expect(afterUpdate!.product_id, 'product link unchanged on update').toBe(productId);
    } finally {
      await deleteGeneralEntityIfExists(request, token, PRICES_PATH, priceId);
      await deleteGeneralEntityIfExists(request, token, VARIANTS_PATH, variantId);
      await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId);
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
