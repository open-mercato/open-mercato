import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

const encryptedEnvelope = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:v1$/

test('TC-CRM-10179: encrypted people remain decrypted without entering the CRUD response cache', async ({ request }) => {
  expect(process.env.ENABLE_CRUD_API_CACHE, 'Use the cache-enabled managed integration runner').toBe('true')
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID()
  const displayName = `Cache Privacy ${stamp}`
  const primaryEmail = `cache-${stamp}@example.test`
  let personId: string | null = null

  try {
    personId = await createPersonFixture(request, token, {
      firstName: 'Cache',
      lastName: stamp,
      displayName,
      primaryEmail,
    })
    const stored = await withClient(async (client) => {
      const result = await client.query<{ display_name: string; primary_email: string }>(
        'select display_name, primary_email from customer_entities where id = $1',
        [personId],
      )
      return result.rows[0]
    })
    expect(stored.display_name).toMatch(encryptedEnvelope)
    expect(stored.primary_email).toMatch(encryptedEnvelope)

    const url = `/api/customers/people?ids=${personId}&pageSize=1`
    const responses: unknown[] = []
    for (let occurrence = 0; occurrence < 2; occurrence += 1) {
      const response = await apiRequest(request, 'GET', url, { token })
      expect(response.status()).toBe(200)
      expect(response.headers()['x-om-cache']).toBeUndefined()
      const body = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(response)
      expect(body?.items).toHaveLength(1)
      expect(body?.items[0].display_name ?? body?.items[0].displayName).toBe(displayName)
      expect(body?.items[0].primary_email ?? body?.items[0].primaryEmail).toBe(primaryEmail)
      responses.push(body)
    }
    expect(responses[1]).toEqual(responses[0])
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
  }
})
