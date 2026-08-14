import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  generateDocument,
  listGeneratedDocuments,
  readJsonBody,
} from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'

/**
 * TC-DOCUMENT-008: generating against an unreachable order fails without side effects.
 *
 * Generate persists a history row after a successful render. When the render
 * fails the route must return before that write, so a failed download leaves no
 * trace claiming a document was produced. The spec checks both halves: the
 * `render_failed` response, and the absence of any history row for the id.
 */
test.describe('TC-DOCUMENT-008: generate an order that cannot be reached', () => {
  test('reports render_failed and records no generation history', async ({ request }) => {
    const token = await getAuthToken(request)
    const unreachableOrderId = randomUUID()

    const response = await generateDocument(request, token, {
      template_id: 'sales.order-invoice',
      data: { id: unreachableOrderId },
    })

    expect(response.status(), 'an unreachable order should not produce a document').toBe(500)
    const body = await readJsonBody(response)
    expect(body.error, 'the failure should be reported as render_failed').toBe('render_failed')
    expect(body.message, 'the failure should carry a translated message').toBeTruthy()

    const history = await listGeneratedDocuments(request, token, { resource_id: unreachableOrderId })
    expect(history.total, 'a failed generation must not be recorded in the history').toBe(0)
    expect(history.items, 'a failed generation must not be recorded in the history').toHaveLength(0)
  })
})
