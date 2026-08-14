import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  previewDocument,
  readJsonBody,
} from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'

/**
 * TC-DOCUMENT-004: previewing a template against an unreachable order fails closed.
 *
 * A well-formed request naming a registered template but an order the caller
 * cannot reach — deleted, or belonging to another organization — must not render.
 * The Sales document service scopes its lookup and raises, and the route reports
 * `render_failed` with a translated message. What matters here is that the
 * failure surfaces as an error rather than as a document built from empty data.
 */
test.describe('TC-DOCUMENT-004: preview an order that cannot be reached', () => {
  test('reports render_failed instead of rendering an empty invoice', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await previewDocument(request, token, {
      template_id: 'sales.order-invoice',
      data: { id: randomUUID() },
    })

    expect(response.status(), 'an unreachable order should not produce a document').toBe(500)
    expect(response.headers()['content-type'], 'the failure should be JSON, not a PDF stream')
      .toContain('application/json')

    const body = await readJsonBody(response)
    expect(body.error, 'the failure should be reported as render_failed').toBe('render_failed')
    expect(body.message, 'the failure should carry a translated message').toBeTruthy()
  })
})
