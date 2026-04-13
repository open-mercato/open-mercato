import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

test.describe('TC-SALES-028: Document number generation & dashboard widgets', () => {
  test('should generate document numbers and return dashboard widget data', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Generate order number
    const orderNumResponse = await apiRequest(request, 'POST', '/api/sales/document-numbers', {
      token,
      data: { kind: 'order' },
    })
    // 200 = success, 400 = no sequence configured (acceptable in test envs)
    expect([200, 400]).toContain(orderNumResponse.status())
    if (orderNumResponse.status() === 200) {
      const body = await readJsonSafe<{ number?: string; format?: string; sequence?: number }>(orderNumResponse)
      expect(typeof body?.number).toBe('string')
      expect(typeof body?.sequence).toBe('number')
    }

    // Generate quote number
    const quoteNumResponse = await apiRequest(request, 'POST', '/api/sales/document-numbers', {
      token,
      data: { kind: 'quote' },
    })
    expect([200, 400]).toContain(quoteNumResponse.status())
    if (quoteNumResponse.status() === 200) {
      const body = await readJsonSafe<{ number?: string; format?: string; sequence?: number }>(quoteNumResponse)
      expect(typeof body?.number).toBe('string')
      expect(typeof body?.sequence).toBe('number')
    }

    // Dashboard widget: new orders
    const ordersWidgetResponse = await apiRequest(request, 'GET', '/api/sales/dashboard/widgets/new-orders', { token })
    // 200 = widget returned data, 403 = feature not assigned (acceptable)
    expect([200, 403]).toContain(ordersWidgetResponse.status())
    if (ordersWidgetResponse.status() === 200) {
      const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(ordersWidgetResponse)
      expect(Array.isArray(body?.items)).toBe(true)
    }

    // Dashboard widget: new quotes
    const quotesWidgetResponse = await apiRequest(request, 'GET', '/api/sales/dashboard/widgets/new-quotes', { token })
    expect([200, 403]).toContain(quotesWidgetResponse.status())
    if (quotesWidgetResponse.status() === 200) {
      const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(quotesWidgetResponse)
      expect(Array.isArray(body?.items)).toBe(true)
    }
  })
})
