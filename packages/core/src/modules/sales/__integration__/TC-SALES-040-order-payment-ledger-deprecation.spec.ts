import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

type Warning = {
  code?: string
  fields?: string[]
}

type CreateResponse = {
  id?: string
  warnings?: Warning[]
}

type OrderRecord = {
  id?: string
  paidTotalAmount?: number
  refundedTotalAmount?: number
  outstandingAmount?: number
}

type ListResponse = {
  items?: OrderRecord[]
}

test.describe('TC-SALES-040: Deprecated order payment-ledger inputs', () => {
  test('accepts released fields, warns the caller, and keeps the ledger payment-derived', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: {
          currencyCode: 'USD',
          lines: [
            {
              currencyCode: 'USD',
              quantity: 1,
              name: `QA TC-SALES-040 line ${Date.now()}`,
              unitPriceNet: 0,
              unitPriceGross: 0,
            },
          ],
          outstandingAmount: 0,
          paidTotalAmount: 100,
          refundedTotalAmount: 0,
        },
      })
      const createBody = await readJsonSafe<CreateResponse>(createResponse)

      expect(createResponse.status(), 'released create fields should remain accepted').toBe(201)
      orderId = expectId(createBody?.id, 'order create response should contain an id')
      expect(createBody?.warnings).toEqual([
        {
          code: 'sales.order.payment_ledger_input_deprecated',
          fields: ['paidTotalAmount', 'refundedTotalAmount', 'outstandingAmount'],
        },
      ])

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/orders?id=${encodeURIComponent(orderId)}`,
        { token },
      )
      const listBody = await readJsonSafe<ListResponse>(listResponse)
      const order = listBody?.items?.find((item) => item.id === orderId)

      expect(listResponse.status(), 'created order should be readable').toBe(200)
      expect(order, 'created order should appear in the filtered list').toBeDefined()
      expect(order).toMatchObject({
        paidTotalAmount: 0,
        refundedTotalAmount: 0,
        outstandingAmount: 0,
      })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
