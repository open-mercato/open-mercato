import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import {
  readUpdatedAt,
  bumpRecordViaApi,
  putWithLock,
  expectConflictBody,
  expectNoConflictBanner,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-023 — catalog false-positive guards + price kinds (manual cases
 * CAT-08 / CAT-09 / CAT-10) for OSS optimistic locking (#2055).
 *
 * This file proves two distinct properties of the catalog write surfaces:
 *
 *  - CAT-08 / CAT-09 (false-positive GUARDS): a single-writer save on an
 *    aggregate edit page that fans out into child CRUD routes (variant prices,
 *    product offers / unit conversions) must NOT raise a spurious 409. Each
 *    child write carries *its own* row version, overriding the parent record's
 *    optimistic-lock header that the CrudForm submit scope leaves on the
 *    request stack — otherwise the variant's / product's version would leak
 *    onto the `catalog/prices` and `catalog/offers` guards and trip a false
 *    conflict (the exact regression #2055 fixed). Driven in a real browser,
 *    asserting the unified conflict bar (`data-testid="record-conflict-banner"`)
 *    stays absent and the parent PUT returns < 400.
 *
 *  - CAT-10 (positive ENFORCEMENT): a stale write to a price-kind
 *    (`PriceKindSettings` → `catalog/price-kinds`, which builds its own
 *    optimistic-lock header via `buildOptimisticLockHeader`) is still refused
 *    with the structured 409 conflict body.
 *
 * Surface notes (confirmed against the live env + page source):
 *
 *  - CAT-08 variant edit page
 *    (`backend/catalog/products/[productId]/variants/[variantId]/page.tsx`):
 *    the submit runs `updateCrud('catalog/variants', …)` (variant header) and
 *    then `syncVariantPricesUpdate(…)`, which wraps every per-price write in
 *    `withScopedApiRequestHeaders(buildOptimisticLockHeader(price.updatedAt), …)`
 *    — the price's own version. The variant `name` is a raw `<Input>` inside
 *    the custom `VariantBasicsSection` group (placeholder `Blue / Small`), and
 *    the form is submitted via the footer "Save changes" button (Control+Enter
 *    does not bubble out of the custom group). Per TC-LOCK-OSS-020.
 *
 *  - CAT-09 product edit page (`backend/catalog/products/[id]/page.tsx`):
 *    the submit runs `updateCrud('catalog/products', …)` (product header) and
 *    syncs removed offers + unit conversions, each wrapped in
 *    `withScopedApiRequestHeaders(buildOptimisticLockHeader(child.updatedAt), …)`.
 *    The product `title` is a raw `<Input>` (placeholder `summer sneaker`),
 *    submitted via the footer "Save changes" button. Per TC-LOCK-OSS-019.
 *
 *  - CAT-10 price kind: the only UI surface is the `PriceKindSettings` dialog
 *    inside the catalog config page, whose conflict path sets an inline dialog
 *    error (it does NOT mount the unified `record-conflict-banner`), so the
 *    409 contract is proven at the API level exactly like TC-LOCK-OSS-022 /
 *    TC-LOCK-OSS-043: create → capture `updated_at` → header-less PUT bump →
 *    replay the now-stale write → 409 `optimistic_lock_conflict`.
 *
 * See `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 */

const PRODUCTS_API_BASE = '/api/catalog/products'
const VARIANTS_API_BASE = '/api/catalog/variants'
const PRICES_API_BASE = '/api/catalog/prices'
const OFFERS_API_BASE = '/api/catalog/offers'
const PRICE_KINDS_API_BASE = '/api/catalog/price-kinds'

const VARIANT_NAME_PLACEHOLDER = /Blue \/ Small/i
const PRODUCT_TITLE_PLACEHOLDER = /summer sneaker/i

async function getFirstPriceKindId(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `${PRICE_KINDS_API_BASE}?pageSize=100`, { token })
  expect(response.status(), 'GET price-kinds should be 200').toBe(200)
  const body = (await response.json()) as { items?: Array<{ id?: string }> }
  const id = body.items?.find((item) => typeof item.id === 'string')?.id
  expect(typeof id, 'env should expose at least one price kind to drive variant price overrides').toBe('string')
  return id as string
}

async function createVariantPriceOverride(
  request: APIRequestContext,
  token: string,
  input: { productId: string; variantId: string; priceKindId: string; unitPriceGross: number },
): Promise<void> {
  const response = await apiRequest(request, 'POST', PRICES_API_BASE, {
    token,
    data: {
      productId: input.productId,
      variantId: input.variantId,
      priceKindId: input.priceKindId,
      currencyCode: 'USD',
      unitPriceGross: input.unitPriceGross,
    },
  })
  expect(response.status(), 'POST variant price override should be 201').toBe(201)
}

async function createChannelOffer(
  request: APIRequestContext,
  token: string,
  input: { productId: string; channelId: string; title: string },
): Promise<void> {
  const response = await apiRequest(request, 'POST', OFFERS_API_BASE, {
    token,
    data: { productId: input.productId, channelId: input.channelId, title: input.title },
  })
  expect(response.status(), 'POST channel offer should be 201').toBe(201)
}

async function getFirstSalesChannelId(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/sales/channels?pageSize=1', { token })
  expect(response.status(), 'GET sales channels should be 200').toBe(200)
  const body = (await response.json()) as { items?: Array<{ id?: string }> }
  const id = body.items?.find((item) => typeof item.id === 'string')?.id
  expect(typeof id, 'env should expose at least one sales channel to attach an offer').toBe('string')
  return id as string
}

/**
 * The price-kinds list route only supports `search` / `isActive` filters — it
 * ignores an `?id=` query param — so the shared `readUpdatedAt` (which trusts
 * `items[0]`) would read the wrong record. Read the full page and match by id
 * (the page size caps at 100, plenty for the small QA env), normalized to ISO.
 */
async function readPriceKindUpdatedAt(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<string> {
  const response = await apiRequest(request, 'GET', `${PRICE_KINDS_API_BASE}?pageSize=100`, { token })
  expect(response.status(), 'GET price-kinds should be 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = (body.items ?? []).find((entry) => entry.id === id)
  expect(item, `price-kinds list should include id=${id}`).toBeTruthy()
  const raw = (item?.updated_at ?? item?.updatedAt) as string | undefined
  expect(typeof raw, `price-kind should expose updated_at, got ${String(raw)}`).toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `updated_at should parse, got ${String(raw)}`).toBe(true)
  return new Date(ms).toISOString()
}

async function createPriceKind(
  request: APIRequestContext,
  token: string,
  stamp: number,
): Promise<{ id: string; updatedAt: string }> {
  const created = await apiRequest(request, 'POST', PRICE_KINDS_API_BASE, {
    token,
    data: {
      code: `qa-lock-023-${stamp}`,
      title: `QA Lock 023 ${stamp}`,
      displayMode: 'excluding-tax',
      isActive: true,
    },
  })
  expect(created.status(), 'POST price-kind should be 201').toBe(201)
  const body = (await created.json()) as { id?: string }
  expect(typeof body.id, 'price-kind creation should return an id').toBe('string')
  const updatedAt = await readPriceKindUpdatedAt(request, token, body.id as string)
  return { id: body.id as string, updatedAt }
}

async function deletePriceKind(request: APIRequestContext, token: string, id: string): Promise<void> {
  const current = await readPriceKindUpdatedAt(request, token, id).catch(() => undefined)
  await request
    .fetch(resolveApiUrl(PRICE_KINDS_API_BASE), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(current ? { [OPTIMISTIC_LOCK_HEADER_NAME]: current } : {}),
      },
      data: { id },
    })
    .catch(() => undefined)
}

test.describe('TC-LOCK-OSS-023: catalog false-positive guards + price kinds (CAT-08/09/10)', () => {
  test('CAT-08 clean variant-with-price-override save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA Lock 023 CAT08 ${stamp}`,
        sku: `qa-lock-023-cat08-${stamp}`,
      })
      const variantId = await createVariantFixture(page.request, token, {
        productId,
        name: `QA Lock 023 variant ${stamp}`,
        sku: `qa-lock-023-var-${stamp}`,
      })
      const priceKindId = await getFirstPriceKindId(page.request, token)
      // A real price override on the variant → the form loads this price's own
      // version, and the sync sends it back per-price. Without the #2055 fix the
      // variant header would leak onto catalog/prices and trip a false 409.
      await createVariantPriceOverride(page.request, token, {
        productId,
        variantId,
        priceKindId,
        unitPriceGross: 19.99,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${productId}/variants/${variantId}`)

      const nameInput = page.getByPlaceholder(VARIANT_NAME_PLACEHOLDER).first()
      await expect(nameInput).toBeVisible({ timeout: 20_000 })

      // Single-tab edit + save: no out-of-band bump → must succeed without a
      // false conflict, and the variant PUT must not 409.
      const variantPutPromise = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(VARIANTS_API_BASE),
        { timeout: 20_000 },
      )
      await fillControlledInput(nameInput, `QA Lock 023 variant saved ${stamp}`)
      await page.getByRole('button', { name: /^save changes$/i }).first().click()

      const variantPut = await variantPutPromise
      expect(variantPut.status(), 'clean variant save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })

  test('CAT-09 clean product-with-channel-offers save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA Lock 023 CAT09 ${stamp}`,
        sku: `qa-lock-023-cat09-${stamp}`,
      })
      const channelId = await getFirstSalesChannelId(page.request, token)
      // Channel offer → the product edit page loads the offer's own version.
      // A single-tab product save must not leak the product header onto
      // catalog/offers and false-positive 409 (#2055). (Unit conversions are a
      // sibling child-sync surface, but they require a configured base unit on
      // the product; the offer alone exercises the same parent-header-vs-child-
      // header guard the regression #2055 fixed, so we keep the fixture lean.)
      await createChannelOffer(page.request, token, {
        productId,
        channelId,
        title: `QA Lock 023 offer ${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${productId}`)

      const titleInput = page.getByPlaceholder(PRODUCT_TITLE_PLACEHOLDER).first()
      await expect(titleInput).toBeVisible({ timeout: 20_000 })

      const productPutPromise = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(PRODUCTS_API_BASE),
        { timeout: 20_000 },
      )
      await fillControlledInput(titleInput, `QA Lock 023 CAT09 saved ${stamp}`)
      await page.getByRole('button', { name: /^save changes$/i }).first().click()

      const productPut = await productPutPromise
      expect(productPut.status(), 'clean product save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })

  test('CAT-10 stale price-kind PUT is refused with a 409 conflict (API-level: dialog surface)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let priceKindId: string | null = null
    try {
      const priceKind = await createPriceKind(page.request, token, stamp)
      priceKindId = priceKind.id
      const staleUpdatedAt = priceKind.updatedAt

      // Advance updated_at out-of-band via a header-less PUT (additive path).
      await bumpRecordViaApi(page.request, token, PRICE_KINDS_API_BASE, {
        id: priceKindId,
        title: `QA Lock 023 bumped ${stamp}`,
      })

      // Replay the now-stale write carrying the original expected-version header
      // (the same header PriceKindSettings.buildOptimisticLockHeader would send)
      // → structured 409 conflict body.
      const conflict = await putWithLock(
        page.request,
        token,
        PRICE_KINDS_API_BASE,
        { id: priceKindId, title: `QA Lock 023 stale ${stamp}` },
        staleUpdatedAt,
      )
      await expectConflictBody(conflict)
    } finally {
      if (priceKindId) await deletePriceKind(page.request, token, priceKindId)
    }
  })

  test('CAT-10 clean price-kind PUT with a fresh token does not 409', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let priceKindId: string | null = null
    try {
      const priceKind = await createPriceKind(page.request, token, stamp)
      priceKindId = priceKind.id

      const fresh = await putWithLock(
        page.request,
        token,
        PRICE_KINDS_API_BASE,
        { id: priceKindId, title: `QA Lock 023 fresh ${stamp}` },
        priceKind.updatedAt,
      )
      expect(fresh.status(), 'clean PUT with the current token should not 409').toBeLessThan(400)
    } finally {
      if (priceKindId) await deletePriceKind(page.request, token, priceKindId)
    }
  })
})
