import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { generateDocument, readJsonBody } from './helpers/document-generators-api'

/**
 * TC-DOCUMENT-018: the generate endpoint rejects malformed bodies as client errors.
 *
 * Generate mirrors the preview contract on the way in — a body failing the schema
 * answers `invalid_request`, a body naming an unregistered template answers
 * `unknown_template` — and both must fail before the side-effecting part of the
 * route, so neither leaves a history row behind.
 */
test.describe('TC-DOCUMENT-018: generate rejects an invalid request', () => {
  test('answers 400 for a body missing template_id and for an unregistered template', async ({ request }) => {
    const token = await getAuthToken(request)

    const missingTemplate = await generateDocument(request, token, { data: { id: randomUUID() } })
    expect(missingTemplate.status(), 'a body without template_id should be a client error').toBe(400)
    const missingTemplateBody = await readJsonBody(missingTemplate)
    expect(missingTemplateBody.error, 'schema failures should be reported as invalid_request').toBe('invalid_request')
    expect(missingTemplateBody.message, 'the 400 should carry a translated message').toBeTruthy()

    const unknownTemplate = await generateDocument(request, token, {
      template_id: `does-not-exist-${randomUUID()}`,
      data: { id: randomUUID() },
    })
    expect(unknownTemplate.status(), 'an unregistered template should be a client error').toBe(400)
    const unknownTemplateBody = await readJsonBody(unknownTemplate)
    expect(unknownTemplateBody.error, 'unknown templates should be reported as unknown_template').toBe('unknown_template')
    expect(unknownTemplateBody.message, 'the 400 should carry a translated message').toBeTruthy()
  })
})
