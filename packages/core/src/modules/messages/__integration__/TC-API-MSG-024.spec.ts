import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type ValidationBody = { fieldErrors?: Record<string, unknown>; details?: unknown }

/**
 * TC-API-MSG-024: Compose validation for multiple external recipients
 * More than 50 `externalEmails`, or `externalEmail` combined with `externalEmails`,
 * is rejected with 400 and nothing is created.
 */
test.describe('TC-API-MSG-024: externalEmails validation', () => {
  test('rejects more than 50 addresses and the externalEmail + externalEmails combination', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const base = {
      visibility: 'public',
      recipients: [],
      subject: `QA TC-API-MSG-024 ${stamp}`,
      body: 'Validation coverage',
    }

    const tooMany = await apiRequest(request, 'POST', '/api/messages', {
      token: adminToken,
      data: {
        ...base,
        externalEmails: Array.from({ length: 51 }, (_, index) => `tc-api-msg-024-${index}-${stamp}@example.com`),
      },
    })
    expect(tooMany.status()).toBe(400)
    expect(JSON.stringify((await tooMany.json()) as ValidationBody)).toContain('externalEmails')

    const combined = await apiRequest(request, 'POST', '/api/messages', {
      token: adminToken,
      data: {
        ...base,
        externalEmail: `tc-api-msg-024-single-${stamp}@example.com`,
        externalEmails: [`tc-api-msg-024-list-${stamp}@example.com`],
      },
    })
    expect(combined.status()).toBe(400)
    expect(JSON.stringify((await combined.json()) as ValidationBody)).toContain('externalEmails')
  })
})
