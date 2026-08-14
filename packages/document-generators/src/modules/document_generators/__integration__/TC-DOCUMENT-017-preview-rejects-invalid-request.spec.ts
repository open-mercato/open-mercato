import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { previewDocument, readJsonBody } from './helpers/document-generators-api'

/**
 * TC-DOCUMENT-017: the preview endpoint rejects malformed bodies as client errors.
 *
 * The route separates two failure modes that both belong to the caller: a body
 * that does not satisfy the preview schema (`invalid_request`) and a body naming
 * a template no module registered (`unknown_template`). Both must answer 400
 * with a machine-readable `error` code plus a translated `message`, so the UI can
 * branch on the code instead of matching prose.
 */
test.describe('TC-DOCUMENT-017: preview rejects an invalid request', () => {
  test('answers 400 for a body missing data and for an unregistered template', async ({ request }) => {
    const token = await getAuthToken(request)

    const missingData = await previewDocument(request, token, { template_id: 'any-template' })
    expect(missingData.status(), 'a body without data should be a client error').toBe(400)
    const missingDataBody = await readJsonBody(missingData)
    expect(missingDataBody.error, 'schema failures should be reported as invalid_request').toBe('invalid_request')
    expect(missingDataBody.message, 'the 400 should carry a translated message').toBeTruthy()

    const unknownTemplate = await previewDocument(request, token, {
      template_id: `does-not-exist-${randomUUID()}`,
      data: { id: randomUUID() },
    })
    expect(unknownTemplate.status(), 'an unregistered template should be a client error').toBe(400)
    const unknownTemplateBody = await readJsonBody(unknownTemplate)
    expect(unknownTemplateBody.error, 'unknown templates should be reported as unknown_template').toBe('unknown_template')
    expect(unknownTemplateBody.message, 'the 400 should carry a translated message').toBeTruthy()
  })
})
