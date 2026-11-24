import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { omitNullLineNumerics } from '../lib/lineSnapshotInput'

const SNAPSHOT_NULLS = {
  productId: null,
  productVariantId: null,
  description: null,
  comment: null,
  quantityUnit: null,
  normalizedQuantity: null,
  configuration: null,
  promotionCode: null,
  metadata: null,
  customFieldSetId: null,
  customFields: null,
  discountAmount: null,
  discountAmountBasis: null,
  discountPercent: null,
  taxRate: null,
  taxAmount: null,
  totalNetAmount: null,
  totalGrossAmount: null,
  amountsMode: null,
}

test.describe('TC-SALES-R5-SA1: quote external references and snapshot-shaped lines', () => {
  test('POST /api/sales/quotes persists externalReference/customerReference and accepts a snapshot-shaped line', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `qa-sa1-${randomUUID()}`
    let quoteId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: {
          currencyCode: 'USD',
          externalReference: `checkout:${marker}:1`,
          customerReference: 'PO-SA1',
          lines: [omitNullLineNumerics({ ...SNAPSHOT_NULLS, name: marker, currencyCode: 'USD', quantity: 1, unitPriceNet: 10, unitPriceGross: 10 })],
        },
      })
      expect(createResponse.status()).toBe(201)
      quoteId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'Created quote ID')

      const readResponse = await apiRequest(request, 'GET', `/api/sales/quotes?id=${quoteId}`, { token })
      expect(readResponse.status()).toBe(200)
      const body = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(readResponse)
      const quote = body?.items.find((item) => item.id === quoteId)
      expect(quote).toMatchObject({ externalReference: `checkout:${marker}:1`, customerReference: 'PO-SA1' })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('POST /api/sales/orders accepts a snapshot-shaped line', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `qa-sa1-${randomUUID()}`
    let orderId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: {
          currencyCode: 'USD',
          externalReference: `checkout:${marker}:1`,
          lines: [omitNullLineNumerics({ ...SNAPSHOT_NULLS, name: marker, currencyCode: 'USD', quantity: 1, unitPriceNet: 10, unitPriceGross: 10 })],
        },
      })
      expect(createResponse.status()).toBe(201)
      orderId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'Created order ID')

      const readResponse = await apiRequest(request, 'GET', `/api/sales/orders?id=${orderId}`, { token })
      expect(readResponse.status()).toBe(200)
      const body = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(readResponse)
      expect(body?.items.find((item) => item.id === orderId)).toMatchObject({ externalReference: `checkout:${marker}:1` })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
