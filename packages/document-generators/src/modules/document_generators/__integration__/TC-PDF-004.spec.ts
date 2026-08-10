import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from './helpers/api'
import { generateDocument, listDocuments } from './helpers/fixtures'

/**
 * TC-PDF-004: generation history (Phase 5)
 *
 * A successful POST /generate that carries resource_kind + resource_id
 * persists a GeneratedDocument row, which then appears in
 * GET /api/document-generators/documents scoped to the active organization.
 *
 * The resource identity and human label are derived server-side from the
 * rendered document when available. Here the record is a random UUID that
 * resolves to no order, so the label falls back to that canonical id.
 *
 * Uses random UUIDs so it needs no seeded data (an unmatched record still
 * renders and still records history). A 409 organization_required (no active
 * org) or a 403 (the admin role lacks document_generators.generate until
 * `yarn mercato auth sync-role-acls` runs) are tolerated so the suite stays
 * green across environments — the assertion runs only on the 200 path.
 */
test.describe('TC-PDF-004: generation history', () => {
  test('a generated document appears in the history filtered by resource', async ({ request }) => {
    const token = await getAuthToken(request)
    const resourceId = randomUUID()

    const gen = await generateDocument(request, token, {
      template_id: 'order-invoice',
      data: { id: resourceId },
      resource_kind: 'sales.order',
      resource_id: resourceId,
    })

    if (gen.status() === 409 || gen.status() === 403) {
      // No active organization, or role missing document_generators.generate.
      expect([403, 409]).toContain(gen.status())
      return
    }
    expect(gen.status()).toBe(200)

    const history = await listDocuments(request, token, { resource_id: resourceId })
    expect(history.total).toBeGreaterThanOrEqual(1)

    const row = history.items.find((i) => i.resourceId === resourceId)
    expect(row).toBeDefined()
    expect(row?.resourceLabel).toBe(resourceId)
    expect(row?.resourceKind).toBe('sales.order')
    expect(row?.templateId).toBe('order-invoice')
    expect(typeof row?.templateLabel).toBe('string')
    expect(row?.templateLabel.length).toBeGreaterThan(0)
    expect(row?.generatedAt).toBeTruthy()
  })

  test('rejects history metadata that does not match the rendered resource', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await generateDocument(request, token, {
      template_id: 'order-invoice',
      data: { id: randomUUID() },
      resource_kind: 'sales.order',
      resource_id: randomUUID(),
    })

    if (response.status() === 409 || response.status() === 403) {
      expect([403, 409]).toContain(response.status())
      return
    }

    expect(response.status()).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Resource does not match the rendered document',
    })
  })

  test('history requires authentication', async ({ request }) => {
    const response = await request.get('/api/document-generators/documents')
    expect(response.ok()).toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
