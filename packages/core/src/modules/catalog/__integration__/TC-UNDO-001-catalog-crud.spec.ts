import { test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 catalog (#2574).
 *
 * Covers stable catalog CRUD command surfaces from the manual verification matrix:
 * categories, price kinds, and products.
 */
test.describe('TC-UNDO-001 catalog undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('categories CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'catalog.categories',
      collectionPath: '/api/catalog/categories',
      readPath: (id) => `/api/catalog/categories?ids=${encodeURIComponent(id)}`,
      field: 'name',
      createPayload: (stamp) => ({ name: `Undo Category ${stamp}` }),
      updatePayload: (id, stamp) => ({ id, name: `Undo Category Renamed ${stamp}` }),
    })
  })

  test('price kinds CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'catalog.priceKinds',
      collectionPath: '/api/catalog/price-kinds',
      field: 'title',
      createPayload: (stamp) => ({
        code: `undo_pk_${stamp}`,
        title: `Undo Price Kind ${stamp}`,
      }),
      updatePayload: (id, stamp) => ({
        id,
        title: `Undo Price Kind Renamed ${stamp}`,
      }),
    })
  })

  test('products CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'catalog.products',
      collectionPath: '/api/catalog/products',
      field: 'title',
      createPayload: (stamp) => ({
        title: `Undo Product ${stamp}`,
        sku: `undo-sku-${stamp}`,
      }),
      updatePayload: (id, stamp) => ({
        id,
        title: `Undo Product Renamed ${stamp}`,
      }),
    })
  })
})
