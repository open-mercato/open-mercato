import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function pickIntegrationId(request: APIRequestContext, token: string): Promise<string | null> {
  const listResponse = await apiRequest(request, 'GET', '/api/integrations', { token })
  if (listResponse.status() !== 200) return null
  const body = await readJson(listResponse)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.length > 0 ? String(items[0].id) : null
}

/**
 * TC-INT-004: Integration credentials payload validation and constraints [P0]
 *
 * Surface: PUT /api/integrations/:id/credentials (requires integrations.credentials.manage)
 *
 * saveCredentialsSchema runs BEFORE the encrypted save, so every 422 case here is
 * independent of the tenant-encryption configuration. Only the valid-save step
 * touches the encrypted store; when encryption is unavailable the route returns
 * 503 and the persistence checks skip (the standard harness returns 200, matching
 * the successful save asserted by TC-INT-002).
 */
test.describe('TC-INT-004: Integration credentials payload validation', () => {
  test('rejects malformed and structurally invalid credential payloads', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const integrationId = await pickIntegrationId(request, token)
    if (!integrationId) {
      test.skip(true, 'No integration provider modules registered — skipping credentials validation')
      return
    }
    const path = `/api/integrations/${integrationId}/credentials`

    // Malformed JSON body — req.json() throws, schema parse of null fails => 422.
    const malformed = await apiRequest(request, 'PUT', path, {
      token,
      data: Buffer.from('{ "credentials": ', 'utf8'),
    })
    expect(malformed.status(), 'malformed JSON body should be rejected').toBe(422)

    // Missing top-level credentials object => 422.
    const missing = await apiRequest(request, 'PUT', path, { token, data: {} })
    expect(missing.status(), 'missing credentials object should be rejected').toBe(422)

    // More than 200 credential fields => 422 with the documented message.
    const tooManyFields: JsonRecord = {}
    for (let index = 0; index < 201; index += 1) tooManyFields[`field_${index}`] = 'value'
    const tooMany = await apiRequest(request, 'PUT', path, { token, data: { credentials: tooManyFields } })
    expect(tooMany.status(), 'more than 200 credential fields should be rejected').toBe(422)
    expect(JSON.stringify(await readJson(tooMany))).toContain('At most 200')

    // Credential key longer than 128 chars => 422.
    const longKey = 'k'.repeat(129)
    const longKeyResponse = await apiRequest(request, 'PUT', path, {
      token,
      data: { credentials: { [longKey]: 'value' } },
    })
    expect(longKeyResponse.status(), 'credential key longer than 128 chars should be rejected').toBe(422)

    // Non-primitive credential values (array / nested object) => 422.
    const arrayValue = await apiRequest(request, 'PUT', path, {
      token,
      data: { credentials: { apiKey: ['not', 'allowed'] } },
    })
    expect(arrayValue.status(), 'array credential value should be rejected').toBe(422)

    const objectValue = await apiRequest(request, 'PUT', path, {
      token,
      data: { credentials: { apiKey: { nested: true } } },
    })
    expect(objectValue.status(), 'object credential value should be rejected').toBe(422)
  })

  test('accepts and persists mixed primitive credential values', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const integrationId = await pickIntegrationId(request, token)
    if (!integrationId) {
      test.skip(true, 'No integration provider modules registered — skipping credentials persistence')
      return
    }
    const path = `/api/integrations/${integrationId}/credentials`

    // Capture current credentials so the integration is restored afterwards.
    const initialResponse = await apiRequest(request, 'GET', path, { token })
    if (initialResponse.status() === 503) {
      test.skip(true, 'Integration credentials encryption is unavailable in this environment')
      return
    }
    expect(initialResponse.status()).toBe(200)
    const initialBody = await readJson(initialResponse)
    const originalCredentials =
      initialBody.credentials && typeof initialBody.credentials === 'object'
        ? (initialBody.credentials as JsonRecord)
        : {}

    try {
      const mixed = {
        stringField: 'integration-test-value',
        numberField: 42,
        booleanField: true,
        nullField: null,
      }
      const saveResponse = await apiRequest(request, 'PUT', path, { token, data: { credentials: mixed } })
      if (saveResponse.status() === 503) {
        test.skip(true, 'Integration credentials encryption is unavailable in this environment')
        return
      }
      expect(saveResponse.status(), 'valid mixed-type credentials should be accepted').toBe(200)

      const verifyResponse = await apiRequest(request, 'GET', path, { token })
      expect(verifyResponse.status()).toBe(200)
      const credentials = ((await readJson(verifyResponse)).credentials ?? {}) as JsonRecord
      expect(credentials.stringField).toBe('integration-test-value')
      expect(credentials.numberField).toBe(42)
      expect(credentials.booleanField).toBe(true)
      expect(credentials.nullField).toBeNull()

      // An empty object clears all credentials and is a valid payload.
      const clearResponse = await apiRequest(request, 'PUT', path, { token, data: { credentials: {} } })
      expect(clearResponse.status(), 'empty credentials object should be accepted').toBe(200)
      const clearedBody = await readJson(await apiRequest(request, 'GET', path, { token }))
      expect(clearedBody.credentials).toEqual({})
    } finally {
      await apiRequest(request, 'PUT', path, { token, data: { credentials: originalCredentials } }).catch(() => undefined)
    }
  })
})
