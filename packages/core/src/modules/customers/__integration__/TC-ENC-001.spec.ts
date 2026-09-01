import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

// TC-ENC-001 — the no-regression guarantee for #5430.
//
// Binding decryption to the caller's tenant (resolveDecryptScope) sits on every read path that
// decrypts. This test locks in the other half of that contract: an ordinary, correctly scoped
// request from an authenticated caller MUST still receive plaintext for encrypted fields.
// `customers:customer_entity` declares display_name / primary_email in its encryption map
// (packages/core/src/modules/customers/encryption.ts), so a person round-trips through real
// encrypt-on-write and decrypt-on-read.

type PersonPayload = {
  id?: unknown
  displayName?: unknown
  primaryEmail?: unknown
}

type PersonList = { items?: Array<Record<string, unknown>> }

test.describe('TC-ENC-001: correctly scoped reads still return decrypted plaintext', () => {
  const stamp = `${Date.now()}`
  const displayName = `EncBinding ${stamp}`
  const primaryEmail = `enc-binding-${stamp}@example.test`
  let personId: string | null = null

  test.afterAll(async ({ request }) => {
    if (!personId) return
    const token = await getAuthToken(request, 'admin')
    await apiRequest(request, 'DELETE', `/api/customers/people?id=${personId}`, { token }).catch(() => {})
  })

  test('a person created through the API reads back with encrypted fields in the clear', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const createResponse = await apiRequest(request, 'POST', '/api/customers/people', {
      token,
      data: { firstName: 'EncBinding', lastName: stamp, displayName, primaryEmail },
    })
    expect(createResponse.ok(), `Create person failed: ${await createResponse.text()}`).toBeTruthy()
    const created = (await readJsonSafe<PersonPayload>(createResponse)) ?? {}
    personId = typeof created.id === 'string' ? created.id : null
    expect(personId).toBeTruthy()

    // Detail read — the single-record path.
    const detailResponse = await apiRequest(request, 'GET', `/api/customers/people?id=${personId}`, { token })
    expect(detailResponse.status(), 'Detail read should return 200').toBe(200)
    const detailBody = await readJsonSafe<PersonList & PersonPayload>(detailResponse)
    const detail = (detailBody?.items?.[0] ?? detailBody) as Record<string, unknown>
    expect(detail?.displayName ?? detail?.display_name).toBe(displayName)

    // List read — the paged path, where decryption runs per row inside the query engine.
    const listResponse = await apiRequest(
      request,
      'GET',
      `/api/customers/people?search=${encodeURIComponent(stamp)}&page=1&pageSize=25`,
      { token },
    )
    expect(listResponse.status(), 'List read should return 200').toBe(200)
    const listBody = await readJsonSafe<PersonList>(listResponse)
    const match = (listBody?.items ?? []).find((item) => String(item.id) === personId)
    expect(match, 'The created person should appear in a scoped list read').toBeTruthy()

    const listedName = String(match?.displayName ?? match?.display_name ?? '')
    expect(listedName).toBe(displayName)
    // Ciphertext for this map is an `enc:`-prefixed envelope; a decrypt failure would surface it.
    expect(listedName.startsWith('enc:')).toBe(false)
  })
})
