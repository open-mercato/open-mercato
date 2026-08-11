import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { getAuthToken } from './helpers/api'
import { generateDocument, listDocuments } from './helpers/fixtures'

/**
 * TC-PDF-004: generation history (Phase 5)
 *
 * A successful POST /generate that carries resource_kind + resource_id
 * persists a GeneratedDocument row, which then appears in
 * GET /api/document-generators/documents scoped to the active organization.
 *
 * The test creates its own order fixture, verifies server-derived resource
 * identity, and removes the order in finally.
 */
test.describe('TC-PDF-004: generation history', () => {
  test('a generated document appears in the history filtered by resource', async ({ request }) => {
    const token = await getAuthToken(request)
    let orderId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)
      const gen = await generateDocument(request, token, {
        template_id: 'order-invoice',
        data: { id: orderId },
        resource_kind: 'sales.order',
        resource_id: orderId,
      })

      expect(gen.status()).toBe(200)

      const history = await listDocuments(request, token, { resource_id: orderId })
      expect(history.total).toBeGreaterThanOrEqual(1)

      const row = history.items.find((item) => item.resourceId === orderId)
      expect(row).toBeDefined()
      expect(row?.resourceLabel).toBeTruthy()
      expect(row?.resourceLabel).not.toBe(orderId)
      expect(row?.resourceKind).toBe('sales.order')
      expect(row?.templateId).toBe('order-invoice')
      expect(typeof row?.templateLabel).toBe('string')
      expect(row?.templateLabel.length).toBeGreaterThan(0)
      expect(row?.generatedAt).toBeTruthy()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('rejects history metadata that does not match the rendered resource', async ({ request }) => {
    const token = await getAuthToken(request)
    let orderId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)
      const response = await generateDocument(request, token, {
        template_id: 'order-invoice',
        data: { id: orderId },
        resource_kind: 'sales.order',
        resource_id: randomUUID(),
      })

      expect(response.status()).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: 'Resource does not match the rendered document',
      })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('history requires authentication', async ({ request }) => {
    const response = await request.get('/api/document-generators/documents')
    expect(response.ok()).toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
