import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { BAD_NIP, lookup, VALID_NIP } from './helpers/fixtures'

/**
 * TC-GUS-001: lookup route guards
 *
 * GET /api/gus_regon/lookup — 401 without auth, 400 without a NIP,
 * 400 for a NIP with a bad checksum. No upstream call is made in any of these cases.
 */
test.describe('TC-GUS-001: GUS REGON lookup route guards', () => {
  test('rejects unauthenticated requests', async ({ request }) => {
    const response = await lookup(request, null, VALID_NIP)
    expect(response.status()).toBe(401)
  })

  test('requires a nip query parameter', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await lookup(request, token)
    expect(response.status()).toBe(400)
  })

  test('rejects a NIP with an invalid checksum', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await lookup(request, token, BAD_NIP)
    expect(response.status()).toBe(400)
    const body = (await response.json()) as { error?: string }
    expect(body.error).toMatch(/checksum/i)
  })
})
