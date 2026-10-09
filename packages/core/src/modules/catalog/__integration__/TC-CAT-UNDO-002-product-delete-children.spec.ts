import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

const VARIANT_ENTITY_ID = 'catalog:catalog_product_variant'
const DESCRIPTION =
  'Long enough description for the product delete undo integration test. This keeps server-side create validation satisfied.'

type Item = Record<string, unknown>

type PriceKindFixture = { id: string; currencyCode: string }

async function createPriceKind(request: APIRequestContext, token: string, stamp: string): Promise<PriceKindFixture> {
  const create = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
    token,
    data: {
      title: `QA Undo Kind ${stamp}`,
      code: `qa_undo_kind_${stamp}`,
      displayMode: 'including-tax',
      currencyCode: 'USD',
    },
  })
  const body = await readJsonSafe<Item>(create)
  expect(create.ok(), `Failed to create price kind: ${create.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return { id: expectId(body?.id, 'price kind id'), currencyCode: 'USD' }
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Item,
  label: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<Item>(response)
  expect(response.ok(), `Failed to create ${label}: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return expectId(body?.id, `${label} id`)
}

async function listItems(request: APIRequestContext, token: string, path: string): Promise<Item[]> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.ok(), `GET ${path} failed: ${response.status()}`).toBeTruthy()
  const items = (await readJsonSafe<{ items?: Item[] }>(response))?.items ?? []
  return items
    .map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith('_'))))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

type ProductChildren = { product: Item[]; variants: Item[]; prices: Item[]; conversions: Item[] }

async function readProductChildren(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<ProductChildren> {
  const id = encodeURIComponent(productId)
  return {
    product: await listItems(request, token, `/api/catalog/products?id=${id}&page=1&pageSize=1`),
    variants: await listItems(request, token, `/api/catalog/variants?productId=${id}&page=1&pageSize=50`),
    prices: await listItems(request, token, `/api/catalog/prices?productId=${id}&page=1&pageSize=50`),
    conversions: await listItems(
      request,
      token,
      `/api/catalog/product-unit-conversions?productId=${id}&page=1&pageSize=50`,
    ),
  }
}

function expectNoChildren(children: ProductChildren, context: string): void {
  const ids = (items: Item[]) => items.map((item) => item.id)
  expect.soft(ids(children.product), `${context}: product`).toEqual([])
  expect.soft(ids(children.variants), `${context}: variants`).toEqual([])
  expect.soft(ids(children.prices), `${context}: prices`).toEqual([])
  expect.soft(ids(children.conversions), `${context}: unit conversions`).toEqual([])
}

type PersistedOptionSchema = { optionSchemaId: string | null; optionSchemas: Item[] }

async function readPersistedOptionSchema(
  productId: string,
  optionSchemaId: string | null,
): Promise<PersistedOptionSchema> {
  return withClient(async (client) => {
    const product = await client.query<{ option_schema_id: string | null }>(
      'select option_schema_id from catalog_products where id = $1',
      [productId],
    )
    const optionSchemas = optionSchemaId
      ? await client.query<Item>(
          'select id, code, name, schema, metadata, is_active, created_at, updated_at from catalog_product_option_schemas where id = $1',
          [optionSchemaId],
        )
      : { rows: [] }
    return { optionSchemaId: product.rows[0]?.option_schema_id ?? null, optionSchemas: optionSchemas.rows }
  })
}

async function deleteIfExists(request: APIRequestContext, token: string | null, path: string): Promise<void> {
  if (!token) return
  await apiRequest(request, 'DELETE', path, { token }).catch(() => undefined)
}

/**
 * TC-CAT-UNDO-002 (#2574, #2468): undoing a product delete must bring back the rows the delete
 * removed together with the product — variants, variant and product prices, unit conversions
 * and the product-owned option schema — not just the product row.
 */
test.describe('TC-CAT-UNDO-002 product delete undo restores the product children', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('undo of a product delete restores its variants and prices', async ({ request }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    let token: string | null = null
    let productId: string | null = null
    let createdPriceKindId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const priceKind = await createPriceKind(request, token, stamp)
      createdPriceKindId = priceKind.id
      productId = await createEntity(
        request,
        token,
        '/api/catalog/products',
        { title: `QA Undo Basic ${stamp}`, sku: `QA-UNDO-BASIC-${stamp}`, description: DESCRIPTION },
        'product',
      )
      const variantId = await createEntity(
        request,
        token,
        '/api/catalog/variants',
        { productId, name: 'Default', sku: `QA-UNDO-BASIC-${stamp}-1`, isDefault: true, isActive: true },
        'variant',
      )
      const priceId = await createEntity(
        request,
        token,
        '/api/catalog/prices',
        {
          variantId,
          productId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: 1,
          unitPriceGross: 19.99,
        },
        'variant price',
      )

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/products?id=${encodeURIComponent(productId)}`,
        { token },
      )
      expect(deleteResponse.ok(), `product delete failed: ${deleteResponse.status()}`).toBeTruthy()
      const deleteOperation = expectOperation(deleteResponse, 'catalog.products.delete')

      await undoOk(request, token, deleteOperation.undoToken, 'catalog.products.delete undo')
      const afterUndo = await readProductChildren(request, token, productId)
      expect(afterUndo.product.map((item) => item.id), 'undo restores the product').toEqual([productId])
      expect(afterUndo.variants.map((item) => item.id), 'undo restores the variant').toEqual([variantId])
      expect(afterUndo.prices.map((item) => item.id), 'undo restores the variant price').toEqual([priceId])
    } finally {
      if (productId) await deleteIfExists(request, token, `/api/catalog/products?id=${encodeURIComponent(productId)}`)
      if (createdPriceKindId && token) {
        const cleanup = await apiRequest(
          request,
          'DELETE',
          `/api/catalog/price-kinds?id=${encodeURIComponent(createdPriceKindId)}`,
          { token },
        )
        expect.soft([200, 404], 'price kind cleanup').toContain(cleanup.status())
      }
    }
  })

  test('delete → undo → redo → undo round-trips variants, prices, unit conversions and the option schema', async ({
    request,
  }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const customFieldKey = `undo_note_${stamp}`
    let token: string | null = null
    let productId: string | null = null
    let controlProductId: string | null = null
    let createdPriceKindId: string | null = null
    let customFieldCreated = false

    try {
      token = await getAuthToken(request, 'admin')
      const priceKind = await createPriceKind(request, token, stamp)
      createdPriceKindId = priceKind.id

      const definition = await apiRequest(request, 'POST', '/api/entities/definitions', {
        token,
        data: { entityId: VARIANT_ENTITY_ID, key: customFieldKey, kind: 'text', configJson: { label: 'Undo note' } },
      })
      customFieldCreated = definition.ok()
      expect(definition.status(), 'variant custom field definition should be created').toBe(200)

      productId = await createEntity(
        request,
        token,
        '/api/catalog/products',
        {
          title: `QA Undo Children ${stamp}`,
          sku: `QA-UNDO-CH-${stamp}`,
          description: DESCRIPTION,
          defaultUnit: 'm2',
          defaultSalesUnit: 'pkg',
          defaultSalesUnitQuantity: 1,
          optionSchema: {
            version: 1,
            name: `QA Undo Children ${stamp}`,
            options: [
              {
                code: 'size',
                label: 'Size',
                inputType: 'select',
                choices: [
                  { code: 's', label: 'S' },
                  { code: 'm', label: 'M' },
                ],
              },
            ],
          },
        },
        'product',
      )
      const variantSmallId = await createEntity(
        request,
        token,
        '/api/catalog/variants',
        {
          productId,
          name: 'Small',
          sku: `QA-UNDO-CH-${stamp}-S`,
          isDefault: true,
          isActive: true,
          optionValues: { size: 's' },
          customFields: { [customFieldKey]: 'keep me' },
        },
        'variant S',
      )
      await createEntity(
        request,
        token,
        '/api/catalog/variants',
        { productId, name: 'Medium', sku: `QA-UNDO-CH-${stamp}-M`, isActive: true, optionValues: { size: 'm' } },
        'variant M',
      )
      await createEntity(
        request,
        token,
        '/api/catalog/prices',
        {
          variantId: variantSmallId,
          productId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: 1,
          unitPriceGross: 49.99,
        },
        'variant price',
      )
      await createEntity(
        request,
        token,
        '/api/catalog/prices',
        {
          productId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: 5,
          unitPriceGross: 39.5,
        },
        'product price',
      )
      await createEntity(
        request,
        token,
        '/api/catalog/product-unit-conversions',
        { productId, unitCode: 'pkg', toBaseFactor: 2.5, sortOrder: 10, isActive: true },
        'unit conversion',
      )

      controlProductId = await createEntity(
        request,
        token,
        '/api/catalog/products',
        { title: `QA Undo Control ${stamp}`, sku: `QA-UNDO-CTL-${stamp}`, description: DESCRIPTION },
        'control product',
      )
      const controlVariantId = await createEntity(
        request,
        token,
        '/api/catalog/variants',
        { productId: controlProductId, name: 'Control', sku: `QA-UNDO-CTL-${stamp}-1`, isDefault: true, isActive: true },
        'control variant',
      )
      await createEntity(
        request,
        token,
        '/api/catalog/prices',
        {
          variantId: controlVariantId,
          productId: controlProductId,
          priceKindId: priceKind.id,
          currencyCode: priceKind.currencyCode,
          minQuantity: 1,
          unitPriceGross: 10,
        },
        'control price',
      )

      const before = await readProductChildren(request, token, productId)
      const controlBefore = await readProductChildren(request, token, controlProductId)
      const optionSchemaId = (await readPersistedOptionSchema(productId, null)).optionSchemaId
      expect(optionSchemaId, 'the inline option schema should create a product-owned template').toBeTruthy()
      const rowsBefore = await readPersistedOptionSchema(productId, optionSchemaId)
      expect(before.product).toHaveLength(1)
      expect(before.variants).toHaveLength(2)
      expect(before.prices).toHaveLength(2)
      expect(before.conversions).toHaveLength(1)
      expect(rowsBefore.optionSchemas).toHaveLength(1)
      expect(JSON.stringify(before.variants), 'variant custom field should be readable before delete').toContain('keep me')

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/products?id=${encodeURIComponent(productId)}`,
        { token },
      )
      expect(deleteResponse.ok(), `product delete failed: ${deleteResponse.status()}`).toBeTruthy()
      const deleteOperation = expectOperation(deleteResponse, 'catalog.products.delete')
      expectNoChildren(await readProductChildren(request, token, productId), 'after delete')
      const rowsAfterDelete = await readPersistedOptionSchema(productId, optionSchemaId)
      expect(rowsAfterDelete.optionSchemas, 'delete removes the product-owned option schema').toEqual([])

      await undoOk(request, token, deleteOperation.undoToken, 'catalog.products.delete undo')
      const afterUndo = await readProductChildren(request, token, productId)
      expect(afterUndo.variants, 'undo restores the variants with their ids, columns and custom fields').toEqual(
        before.variants,
      )
      expect(afterUndo.prices, 'undo restores variant and product prices').toEqual(before.prices)
      expect(afterUndo.conversions, 'undo restores the unit conversions').toEqual(before.conversions)
      expect(afterUndo.product, 'undo restores the product').toHaveLength(1)
      const rowsAfterUndo = await readPersistedOptionSchema(productId, optionSchemaId)
      expect(rowsAfterUndo.optionSchemaId, 'the product references its option schema again').toBe(optionSchemaId)
      expect(rowsAfterUndo.optionSchemas, 'undo restores the product-owned option schema').toEqual(
        rowsBefore.optionSchemas,
      )
      expect(
        await readProductChildren(request, token, controlProductId),
        'an unrelated product is untouched by the delete and the undo',
      ).toEqual(controlBefore)

      const redo = await redoOk(request, token, deleteOperation.logId, 'catalog.products.delete redo')
      expectNoChildren(await readProductChildren(request, token, productId), 'after redo')
      expect(redo.undoToken, 'redo issues a new undo token').toBeTruthy()

      await undoOk(request, token, redo.undoToken as string, 'catalog.products.delete undo after redo')
      const afterSecondUndo = await readProductChildren(request, token, productId)
      expect(afterSecondUndo.variants, 'undo after redo restores the variants').toEqual(before.variants)
      expect(afterSecondUndo.prices, 'undo after redo restores the prices').toEqual(before.prices)
      expect(afterSecondUndo.conversions, 'undo after redo restores the unit conversions').toEqual(before.conversions)
      const rowsAfterSecondUndo = await readPersistedOptionSchema(productId, optionSchemaId)
      expect(rowsAfterSecondUndo.optionSchemas).toEqual(rowsBefore.optionSchemas)
    } finally {
      if (productId) await deleteIfExists(request, token, `/api/catalog/products?id=${encodeURIComponent(productId)}`)
      if (controlProductId) {
        await deleteIfExists(request, token, `/api/catalog/products?id=${encodeURIComponent(controlProductId)}`)
      }
      if (createdPriceKindId && token) {
        const cleanup = await apiRequest(
          request,
          'DELETE',
          `/api/catalog/price-kinds?id=${encodeURIComponent(createdPriceKindId)}`,
          { token },
        )
        expect.soft([200, 404], 'price kind cleanup').toContain(cleanup.status())
      }
      if (customFieldCreated && token) {
        const cleanup = await apiRequest(request, 'DELETE', '/api/entities/definitions', {
          token,
          data: { entityId: VARIANT_ENTITY_ID, key: customFieldKey },
        })
        expect.soft([200, 404], 'variant custom field definition cleanup').toContain(cleanup.status())
      }
    }
  })

  test('undo fails as a whole while a restored variant SKU is taken, and succeeds once it is free', async ({
    request,
  }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const variantSku = `QA-UNDO-SKU-${stamp}-V`
    let token: string | null = null
    let productId: string | null = null
    let blockerProductId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      productId = await createEntity(
        request,
        token,
        '/api/catalog/products',
        { title: `QA Undo Sku ${stamp}`, sku: `QA-UNDO-SKU-${stamp}`, description: DESCRIPTION },
        'product',
      )
      await createEntity(
        request,
        token,
        '/api/catalog/variants',
        { productId, name: 'Only', sku: variantSku, isDefault: true, isActive: true },
        'variant',
      )
      const before = await readProductChildren(request, token, productId)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/products?id=${encodeURIComponent(productId)}`,
        { token },
      )
      expect(deleteResponse.ok(), `product delete failed: ${deleteResponse.status()}`).toBeTruthy()
      const deleteOperation = expectOperation(deleteResponse, 'catalog.products.delete')

      blockerProductId = await createEntity(
        request,
        token,
        '/api/catalog/products',
        { title: `QA Undo Sku Blocker ${stamp}`, sku: `QA-UNDO-SKU-B-${stamp}`, description: DESCRIPTION },
        'blocker product',
      )
      const blockerVariantId = await createEntity(
        request,
        token,
        '/api/catalog/variants',
        { productId: blockerProductId, name: 'Blocker', sku: variantSku, isDefault: true, isActive: true },
        'blocker variant',
      )

      const blockedUndo = await undoByToken(request, token, deleteOperation.undoToken)
      expect(blockedUndo.ok(), 'undo must fail while the variant SKU is taken').toBeFalsy()
      expectNoChildren(await readProductChildren(request, token, productId), 'after the failed undo')

      const removeBlocker = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/variants?id=${encodeURIComponent(blockerVariantId)}`,
        { token },
      )
      expect(removeBlocker.ok(), `blocker variant delete failed: ${removeBlocker.status()}`).toBeTruthy()

      await undoOk(request, token, deleteOperation.undoToken, 'catalog.products.delete undo retry')
      const afterUndo = await readProductChildren(request, token, productId)
      expect(afterUndo.product).toHaveLength(1)
      expect(afterUndo.variants, 'the retry restores the variant').toEqual(before.variants)
    } finally {
      if (productId) await deleteIfExists(request, token, `/api/catalog/products?id=${encodeURIComponent(productId)}`)
      if (blockerProductId) {
        await deleteIfExists(request, token, `/api/catalog/products?id=${encodeURIComponent(blockerProductId)}`)
      }
    }
  })
})
