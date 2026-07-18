import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'

/**
 * Feature-toggle identifier gating the production module surface (mirrors
 * `packages/production/src/modules/production/lib/productionToggleId.ts`).
 * Duplicated here (not imported) so this helper file has no compile-time
 * dependency on the production package's server-only module graph.
 */
export const PRODUCTION_TOGGLE_ID = 'production_enabled'

let sequence = 0

export function uniqueName(prefix: string): string {
  sequence += 1
  return `${prefix} ${Date.now()}-${sequence}`
}

export function uniqueUuid(): string {
  // Deterministic-looking but unique v4-shaped UUID for fixture product/variant
  // ids — the production APIs only require a well-formed UUID, they never
  // resolve it against the catalog module (task 1.3: catalog picker is a
  // planned enhancement, componentProductId/productId stay raw UUIDs for now).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Ensures the `production_enabled` global feature toggle exists and defaults
 * to `true`, so `isProductionEnabledForTenant` (fail-closed gate) resolves
 * truthy for every tenant without a per-tenant override.
 *
 * No existing spec/fixture registers this toggle (it is not seeded in
 * `packages/core/src/modules/feature_toggles/defaults.json` — unlike e.g.
 * `sales_channels_enabled`), so integration specs create it themselves via
 * the global feature-toggle CRUD API as superadmin. Because the toggle is
 * shared module-wide infrastructure (analogous to a seeded default, not a
 * disposable per-test fixture), specs do NOT delete it in teardown — only
 * the spec run that actually created it would ever consider removing it,
 * and removing a toggle other tests may depend on for parallel workers is
 * unsafe. This mirrors how seeded defaults.json toggles are never deleted
 * by tests that merely rely on them being enabled.
 */
export async function ensureProductionEnabledToggle(
  request: APIRequestContext,
  superadminToken: string,
): Promise<string> {
  const listResponse = await apiRequest(
    request,
    'GET',
    `/api/feature_toggles/global?identifier=${encodeURIComponent(PRODUCTION_TOGGLE_ID)}&pageSize=10`,
    { token: superadminToken },
  )
  expect(listResponse.status(), 'GET /api/feature_toggles/global should return 200').toBe(200)
  const listBody = await readJsonSafe<{ items?: Array<{ id?: string; identifier?: string; defaultValue?: unknown }> }>(listResponse)
  const existing = (listBody?.items ?? []).find((item) => item.identifier === PRODUCTION_TOGGLE_ID)

  if (existing?.id) {
    if (existing.defaultValue !== true) {
      await apiRequest(request, 'PUT', '/api/feature_toggles/global', {
        token: superadminToken,
        data: { id: existing.id, defaultValue: true },
      }).catch(() => null)
    }
    return existing.id
  }

  const createResponse = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
    token: superadminToken,
    data: {
      identifier: PRODUCTION_TOGGLE_ID,
      name: 'Production module enabled',
      description: 'Gates the production planning module backend UI (integration test fixture).',
      category: 'production',
      type: 'boolean',
      defaultValue: true,
    },
  })

  if (createResponse.status() === 201) {
    const body = await readJsonSafe<{ id?: string }>(createResponse)
    if (body?.id) return body.id
  }

  // Racing worker created it first (or it landed between our GET and POST) —
  // re-fetch rather than fail the spec.
  const retryResponse = await apiRequest(
    request,
    'GET',
    `/api/feature_toggles/global?identifier=${encodeURIComponent(PRODUCTION_TOGGLE_ID)}&pageSize=10`,
    { token: superadminToken },
  )
  const retryBody = await readJsonSafe<{ items?: Array<{ id?: string; identifier?: string }> }>(retryResponse)
  const found = (retryBody?.items ?? []).find((item) => item.identifier === PRODUCTION_TOGGLE_ID)
  expect(found?.id, 'production_enabled toggle should exist after create-or-race').toBeTruthy()
  return String(found!.id)
}

export async function createWorkCenter(
  request: APIRequestContext,
  token: string,
  overrides: Partial<{
    name: string
    kind: 'machine' | 'manual' | 'line' | 'subcontractor'
    costRatePerHour: number
    isActive: boolean
  }> = {},
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/production/work-centers', {
    token,
    data: {
      name: overrides.name ?? uniqueName('Integration Work Center'),
      kind: overrides.kind ?? 'machine',
      costRatePerHour: overrides.costRatePerHour ?? 12.5,
      isActive: overrides.isActive ?? true,
    },
  })
  expect(response.status(), 'POST /api/production/work-centers should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id === 'string', 'work center creation response should include an id').toBe(true)
  return String(body!.id)
}

export async function deleteWorkCenterIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', '/api/production/work-centers', { token, data: { id } }).catch(() => null)
}

export async function createBom(
  request: APIRequestContext,
  token: string,
  overrides: Partial<{
    productId: string
    name: string
    status: 'draft' | 'active' | 'archived'
    items: Array<Record<string, unknown>>
  }> = {},
): Promise<{ id: string; productId: string }> {
  const productId = overrides.productId ?? uniqueUuid()
  const response = await apiRequest(request, 'POST', '/api/production/boms', {
    token,
    data: {
      productId,
      name: overrides.name ?? uniqueName('Integration BOM'),
      status: overrides.status ?? 'draft',
      items: overrides.items ?? [
        {
          componentProductId: uniqueUuid(),
          qtyPerUnit: 2,
          uom: 'PCS',
          scrapFactor: 0,
          isPhantom: false,
        },
      ],
    },
  })
  expect(response.status(), 'POST /api/production/boms should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id === 'string', 'BOM creation response should include an id').toBe(true)
  return { id: String(body!.id), productId }
}

export async function deleteBomIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', '/api/production/boms', { token, data: { id } }).catch(() => null)
}

export async function createRouting(
  request: APIRequestContext,
  token: string,
  overrides: Partial<{
    productId: string
    name: string
    status: 'draft' | 'active' | 'archived'
    operations: Array<Record<string, unknown>>
  }> = {},
  workCenterId?: string,
): Promise<{ id: string; productId: string }> {
  const productId = overrides.productId ?? uniqueUuid()
  const response = await apiRequest(request, 'POST', '/api/production/routings', {
    token,
    data: {
      productId,
      name: overrides.name ?? uniqueName('Integration Routing'),
      status: overrides.status ?? 'draft',
      operations: overrides.operations ?? (workCenterId
        ? [
            {
              sequence: 10,
              name: 'Cut',
              workCenterId,
              setupTimeMinutes: 5,
              runTimePerUnitSeconds: 30,
              isReportingPoint: true,
            },
          ]
        : []),
    },
  })
  expect(response.status(), 'POST /api/production/routings should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id === 'string', 'routing creation response should include an id').toBe(true)
  return { id: String(body!.id), productId }
}

export async function deleteRoutingIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', '/api/production/routings', { token, data: { id } }).catch(() => null)
}

/**
 * Creates a real catalog product with a `defaultUnit` (the cost-rollup
 * route reads catalog prices as denominated in this unit — task 1.4). Not
 * reusing `createProductFixture` from `catalogFixtures.ts` since that helper
 * does not accept `defaultUnit`; this stays a thin direct POST instead of
 * widening a shared core helper for a single call site.
 */
export async function createCatalogProductWithDefaultUnit(
  request: APIRequestContext,
  token: string,
  overrides: Partial<{ title: string; sku: string; defaultUnit: string }> = {},
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/products', {
    token,
    data: {
      title: overrides.title ?? uniqueName('Integration Cost Rollup Product'),
      sku: overrides.sku ?? `QA-PROD-${Date.now()}-${++sequence}`,
      description:
        'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.',
      defaultUnit: overrides.defaultUnit ?? 'kg',
    },
  })
  expect(response.status(), 'POST /api/catalog/products should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id === 'string', 'product creation response should include an id').toBe(true)
  return String(body!.id)
}

/**
 * Fetches an existing catalog price kind (seeded per tenant, e.g. `regular`)
 * and creates a `unitPriceNet` price for `productId` in that kind/currency.
 * Mirrors the fixture pattern in
 * `packages/core/src/modules/catalog/__integration__/TC-CAT-011.spec.ts`.
 */
export async function createCatalogListPrice(
  request: APIRequestContext,
  token: string,
  overrides: { productId: string; unitPriceNet: number; currencyCode?: string },
): Promise<string> {
  const priceKindsResponse = await apiRequest(request, 'GET', '/api/catalog/price-kinds?page=1&pageSize=1', { token })
  expect(priceKindsResponse.status(), 'GET /api/catalog/price-kinds should return 200').toBe(200)
  const priceKindsBody = await readJsonSafe<{ items?: Array<{ id?: string; currencyCode?: string | null; currency_code?: string | null }> }>(priceKindsResponse)
  const priceKind = (priceKindsBody?.items ?? [])[0]
  expect(priceKind?.id, 'at least one catalog price kind should be configured').toBeTruthy()

  const response = await apiRequest(request, 'POST', '/api/catalog/prices', {
    token,
    data: {
      productId: overrides.productId,
      priceKindId: priceKind!.id,
      currencyCode: overrides.currencyCode ?? priceKind!.currencyCode ?? priceKind!.currency_code ?? 'USD',
      unitPriceNet: overrides.unitPriceNet,
    },
  })
  expect(response.status(), 'POST /api/catalog/prices should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id === 'string', 'price creation response should include an id').toBe(true)
  return String(body!.id)
}

/**
 * Creates a `CatalogProductUnitConversion` row (`unitCode` -> `toBaseFactor`
 * of the product's `defaultUnit`) so the cost-rollup route can convert a
 * BOM line's non-base UoM (e.g. `g`) into the price's base UoM (e.g. `kg`).
 */
export async function createCatalogUnitConversion(
  request: APIRequestContext,
  token: string,
  overrides: { productId: string; unitCode: string; toBaseFactor: number },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/product-unit-conversions', {
    token,
    data: {
      productId: overrides.productId,
      unitCode: overrides.unitCode,
      toBaseFactor: overrides.toBaseFactor,
    },
  })
  expect(response.status(), 'POST /api/catalog/product-unit-conversions should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id === 'string', 'unit conversion creation response should include an id').toBe(true)
  return String(body!.id)
}

export { getAuthToken, apiRequest, readJsonSafe, deleteCatalogProductIfExists }
