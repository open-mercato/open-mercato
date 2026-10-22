import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-021: history sort allowlist', () => {
  test('rejects sort=resource_label, accepts the allowlist and returns decrypted labels', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await dg.createOrderWithLine(request, token)
      const generated = await dg.generateDocument(request, token, { template_id: dg.ORDER_PDF_TEMPLATE, data: { id: orderId } })
      expect(generated.status()).toBe(200)
      await dg.pollResourceHistory(request, token, dg.ORDER_KIND, orderId, 1)

      await dg.readErrorEnvelope(await dg.listDocuments(request, token, { sort: 'resource_label' }), 400, 'invalid_query')
      for (const sort of ['template_label', 'format', 'generated_by', 'generated_at']) {
        const page = await dg.readHistoryPage(await dg.listDocuments(request, token, { sort, sort_direction: 'asc' }))
        expect(page.pageSize).toBeGreaterThan(0)
      }

      const scoped = await dg.fetchResourceHistory(request, token, dg.ORDER_KIND, orderId)
      expect(scoped.items.length).toBeGreaterThan(0)
      for (const row of scoped.items) {
        expect(typeof row.resourceLabel).toBe('string')
        expect(row.resourceLabel.length).toBeGreaterThan(0)
        expect(row.resourceLabel).not.toMatch(/^[a-z0-9]+:.*:.*:/i)
      }
    } finally {
      await dg.deleteOrder(request, token, orderId)
    }
  })
})
