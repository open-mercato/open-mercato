import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

const DESCRIPTION =
  'Long enough description for the variant create undo integration test. This keeps server-side create validation satisfied.'

type Item = Record<string, unknown>

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Item,
  label: string,
): Promise<{ id: string; response: Awaited<ReturnType<typeof apiRequest>> }> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<Item>(response)
  expect(response.ok(), `Failed to create ${label}: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return { id: expectId(body?.id, `${label} id`), response }
}

async function createPriceKind(request: APIRequestContext, token: string, stamp: string): Promise<string> {
  return (
    await createEntity(
      request,
      token,
      '/api/catalog/price-kinds',
      {
        title: `QA Variant Undo Kind ${stamp}`,
        code: `qa_var_undo_${stamp}`,
        displayMode: 'including-tax',
        currencyCode: 'USD',
      },
      'price kind',
    )
  ).id
}

async function createProduct(request: APIRequestContext, token: string, stamp: string): Promise<string> {
  return (
    await createEntity(
      request,
      token,
      '/api/catalog/products',
      { title: `QA Variant Undo ${stamp}`, sku: `QA-VAR-UNDO-${stamp}`, description: DESCRIPTION },
      'product',
    )
  ).id
}

async function cleanupFixtures(
  request: APIRequestContext,
  token: string | null,
  productId: string | null,
  priceKindId: string | null,
): Promise<void> {
  if (productId && token) {
    await apiRequest(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productId)}`, {
      token,
    }).catch(() => undefined)
  }
  if (priceKindId && token) {
    const cleanup = await apiRequest(
      request,
      'DELETE',
      `/api/catalog/price-kinds?id=${encodeURIComponent(priceKindId)}`,
      { token },
    )
    expect.soft([200, 404], 'price kind cleanup').toContain(cleanup.status())
  }
}

async function listPrices(request: APIRequestContext, token: string, productId: string): Promise<Item[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/catalog/prices?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
    { token },
  )
  expect(response.ok(), `GET prices failed: ${response.status()}`).toBeTruthy()
  const items = (await readJsonSafe<{ items?: Item[] }>(response))?.items ?? []
  return items
    .map((item) => ({ id: item.id, variantId: item.variant_id ?? item.variantId ?? null }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

async function readPriceRows(productId: string): Promise<Item[]> {
  return withClient(async (client) => {
    const result = await client.query<Item>(
      'select id, variant_id as "variantId" from catalog_product_variant_prices where product_id = $1 order by id',
      [productId],
    )
    return result.rows
  })
}

async function waitUntilBlockedBy(observer: IntegrationDbClient, blockerPid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await observer.query<{ blocked: boolean }>(
      `select exists (
         select 1
           from pg_stat_activity activity
          where $1 = any(pg_blocking_pids(activity.pid))
       ) as blocked`,
      [blockerPid],
    )
    if (result.rows[0]?.blocked) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('[internal] The request did not reach the expected PostgreSQL row lock')
}

async function whileHoldingTransaction<T>(
  hold: (blocker: IntegrationDbClient) => Promise<void>,
  contend: () => Promise<T>,
  beforeCommit?: (blocker: IntegrationDbClient) => Promise<void>,
): Promise<T> {
  return withClient(async (blocker) => {
    await blocker.query('begin')
    try {
      const pidResult = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
      const blockerPid = pidResult.rows[0]?.pid
      if (!blockerPid) throw new Error('[internal] PostgreSQL blocker pid unavailable')
      await hold(blocker)
      const pending = contend()
      await withClient((observer) => waitUntilBlockedBy(observer, blockerPid))
      if (beforeCommit) await beforeCommit(blocker)
      await blocker.query('commit')
      return await pending
    } catch (error) {
      await blocker.query('rollback').catch(() => undefined)
      throw error
    }
  })
}

/**
 * TC-CAT-UNDO-005: undoing a variant create must remove the prices that were added to that
 * variant, instead of leaving them behind as product-wide prices with no variant — including
 * prices whose insert races the undo.
 */
test.describe('TC-CAT-UNDO-005 variant create undo removes the variant prices', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('undo of a variant create removes its prices and keeps the sibling and product prices', async ({
    request,
  }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    let token: string | null = null
    let productId: string | null = null
    let priceKindId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      priceKindId = await createPriceKind(request, token, stamp)
      productId = await createProduct(request, token, stamp)
      const keptVariantId = (
        await createEntity(
          request,
          token,
          '/api/catalog/variants',
          { productId, name: 'Kept', sku: `QA-VAR-UNDO-${stamp}-A`, isDefault: true, isActive: true },
          'kept variant',
        )
      ).id
      const undoneVariant = await createEntity(
        request,
        token,
        '/api/catalog/variants',
        { productId, name: 'Undone', sku: `QA-VAR-UNDO-${stamp}-B`, isDefault: false, isActive: true },
        'undone variant',
      )
      const variantCreate = expectOperation(undoneVariant.response, 'catalog.variants.create')
      const priceInput = { productId, priceKindId, currencyCode: 'USD', minQuantity: 1 }
      const keptVariantPriceId = (
        await createEntity(
          request,
          token,
          '/api/catalog/prices',
          { ...priceInput, variantId: keptVariantId, unitPriceGross: 10 },
          'kept variant price',
        )
      ).id
      const productPriceId = (
        await createEntity(request, token, '/api/catalog/prices', { ...priceInput, unitPriceGross: 11 }, 'product price')
      ).id
      const undoneVariantPriceId = (
        await createEntity(
          request,
          token,
          '/api/catalog/prices',
          { ...priceInput, variantId: undoneVariant.id, unitPriceGross: 12 },
          'undone variant price',
        )
      ).id

      const beforeUndo = await listPrices(request, token, productId)
      expect(beforeUndo.map((price) => price.id).sort()).toEqual(
        [keptVariantPriceId, productPriceId, undoneVariantPriceId].sort(),
      )

      await undoOk(request, token, variantCreate.undoToken, 'catalog.variants.create undo')

      const expectedRemaining = [
        { id: keptVariantPriceId, variantId: keptVariantId },
        { id: productPriceId, variantId: null },
      ].sort((a, b) => a.id.localeCompare(b.id))
      expect(await readPriceRows(productId), 'stored prices after undo').toEqual(expectedRemaining)

      const afterUndo = await listPrices(request, token, productId)
      expect(
        afterUndo.find((price) => price.id === undoneVariantPriceId),
        'the undone variant price must not survive as a product-wide price',
      ).toBeUndefined()
      expect(afterUndo, 'listed prices after undo').toEqual(expectedRemaining)
    } finally {
      await cleanupFixtures(request, token, productId, priceKindId)
    }
  })

  test('undo waits for a price insert that is still in flight and removes that price too', async ({ request }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    let token: string | null = null
    let productId: string | null = null
    let priceKindId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const authToken = token
      priceKindId = await createPriceKind(request, token, stamp)
      productId = await createProduct(request, token, stamp)
      const variant = await createEntity(
        request,
        token,
        '/api/catalog/variants',
        { productId, name: 'Raced', sku: `QA-VAR-UNDO-${stamp}-R`, isDefault: false, isActive: true },
        'raced variant',
      )
      const variantCreate = expectOperation(variant.response, 'catalog.variants.create')
      const productPriceId = (
        await createEntity(
          request,
          token,
          '/api/catalog/prices',
          { productId, priceKindId, currencyCode: 'USD', minQuantity: 1, unitPriceGross: 11 },
          'product price',
        )
      ).id

      let inFlightPriceId: string | null = null
      await whileHoldingTransaction(
        async (blocker) => {
          const inserted = await blocker.query<{ id: string }>(
            `insert into catalog_product_variant_prices
               (organization_id, tenant_id, variant_id, product_id, price_kind_id, currency_code, kind,
                min_quantity, unit_price_gross, created_at, updated_at)
             select variant.organization_id, variant.tenant_id, variant.id, variant.product_id, kind.id, 'USD',
                    kind.code, 1, 13, now(), now()
               from catalog_product_variants variant
               join catalog_price_kinds kind on kind.id = $2
              where variant.id = $1
             returning id`,
            [variant.id, priceKindId],
          )
          inFlightPriceId = inserted.rows[0]?.id ?? null
          expect(inFlightPriceId, 'in-flight variant price inserted').toBeTruthy()
        },
        () => undoOk(request, authToken, variantCreate.undoToken, 'catalog.variants.create undo'),
      )

      expect(await readPriceRows(productId), 'the in-flight variant price is removed with its variant').toEqual([
        { id: productPriceId, variantId: null },
      ])
      expect(
        (await listPrices(request, token, productId)).map((price) => price.id),
        'listed prices after the raced undo',
      ).toEqual([productPriceId])
    } finally {
      await cleanupFixtures(request, token, productId, priceKindId)
    }
  })

  test('a price create that loses the race against the variant removal is rejected and leaves no price', async ({
    request,
  }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    let token: string | null = null
    let productId: string | null = null
    let priceKindId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const authToken = token
      priceKindId = await createPriceKind(request, token, stamp)
      productId = await createProduct(request, token, stamp)
      const variantId = (
        await createEntity(
          request,
          token,
          '/api/catalog/variants',
          { productId, name: 'Removed', sku: `QA-VAR-UNDO-${stamp}-X`, isDefault: false, isActive: true },
          'removed variant',
        )
      ).id
      const priceInput = { productId, variantId, priceKindId, currencyCode: 'USD', minQuantity: 1, unitPriceGross: 14 }

      const racedCreate = await whileHoldingTransaction(
        async (blocker) => {
          await blocker.query('select id from catalog_product_variants where id = $1 for update', [variantId])
        },
        () => apiRequest(request, 'POST', '/api/catalog/prices', { token: authToken, data: priceInput }),
        async (blocker) => {
          await blocker.query('delete from catalog_product_variants where id = $1', [variantId])
        },
      )
      const racedBody = await readJsonSafe<Item>(racedCreate)
      expect(racedCreate.status(), `raced price create: ${JSON.stringify(racedBody)}`).toBe(409)
      expect(racedBody?.code, 'raced price create error code').toBe('FOREIGN_KEY_VIOLATION')

      const retry = await apiRequest(request, 'POST', '/api/catalog/prices', { token, data: priceInput })
      expect(retry.status(), 'retried price create').toBe(404)

      expect(await readPriceRows(productId), 'no price survives as a product-wide price').toEqual([])
    } finally {
      await cleanupFixtures(request, token, productId, priceKindId)
    }
  })
})
