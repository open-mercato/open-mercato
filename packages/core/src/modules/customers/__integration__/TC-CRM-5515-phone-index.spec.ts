import { randomInt, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { hasPersonPhoneLookupPepper } from '../lib/personPhoneLookup'

type PhoneState = {
  phone: string | null
  digest: string | null
  version: Date
}

async function readPhoneState(id: string): Promise<PhoneState> {
  return withClient(async (client) => {
    const result = await client.query<PhoneState>(
      'select primary_phone as phone, primary_phone_digits_hash as digest, updated_at as version from customer_entities where id = $1',
      [id],
    )
    expect(result.rows).toHaveLength(1)
    return result.rows[0]
  })
}

async function updatePhone(request: APIRequestContext, token: string, id: string, primaryPhone: string | null) {
  const { version } = await readPhoneState(id)
  const response = await apiRequest(request, 'PUT', '/api/customers/people', {
    token,
    data: { id, primaryPhone },
    headers: { 'x-om-ext-optimistic-lock-expected-updated-at': version.toISOString() },
  })
  expect(response.ok()).toBe(true)
}

async function checkPhone(request: APIRequestContext, token: string, phone: string) {
  const digits = phone.replace(/\D/g, '')
  const response = await apiRequest(request, 'GET', `/api/customers/people/check-phone?digits=${digits}`, { token })
  expect(response.ok()).toBe(true)
  return readJsonSafe<{ match: { id: string; displayName: string | null } | null }>(response)
}

test('TC-CRM-5515: an older person stays discoverable and a phone edit replaces its digest', async ({ request }) => {
  test.skip(!hasPersonPhoneLookupPepper(), 'The integration app must have a lookup pepper or encryption key')
  const token = await getAuthToken(request, 'admin')
  const subscriber = String(randomInt(2_000_000, 9_000_000))
  const phone = `+1 646 ${subscriber.slice(0, 3)} ${subscriber.slice(3)}`
  const editedPhone = `+1 724 ${subscriber.slice(0, 3)} ${subscriber.slice(3)}`
  const fixtureName = `CRM Phone Index ${randomUUID()}`
  const decoyMarker = `Decoy for ${fixtureName}`
  let personId: string | undefined

  const clearDecoys = () => withClient((client) => client.query(
    'delete from customer_entities where display_name = $1',
    [decoyMarker],
  ))

  try {
    const created = await apiRequest(request, 'POST', '/api/customers/people', {
      token,
      data: { firstName: 'Phone', lastName: 'Index', displayName: fixtureName, primaryPhone: phone },
    })
    expect(created.ok()).toBe(true)
    personId = (await readJsonSafe<{ id: string }>(created))?.id
    if (!personId) throw new Error('Expected a person ID from the create API')

    const original = await readPhoneState(personId)
    expect(original.digest).toMatch(/^v2:[0-9a-f]{64}$/)
    if (isTenantDataEncryptionEnabled()) expect(isEncryptedPayloadShape(original.phone)).toBe(true)
    await withClient(async (client) => {
      await client.query("update customer_entities set created_at = '2000-01-01' where id = $1", [personId])
      await client.query(
        `insert into customer_entities
          (id, tenant_id, organization_id, kind, display_name, primary_phone, is_active, created_at, updated_at)
        select gen_random_uuid(), entity.tenant_id, entity.organization_id, 'person', $2, '+1 646 555 0100', true, now(), now()
        from customer_entities as entity cross join generate_series(1, 501)
        where entity.id = $1`,
        [personId, decoyMarker],
      )
    })
    expect(await checkPhone(request, token, phone)).toEqual({ match: { id: personId, displayName: fixtureName } })
    await clearDecoys()

    await updatePhone(request, token, personId, editedPhone)
    const changed = await readPhoneState(personId)
    expect(changed.digest).toMatch(/^v2:[0-9a-f]{64}$/)
    expect(changed.digest).not.toBe(original.digest)
    expect(await checkPhone(request, token, phone)).toEqual({ match: null })
    expect(await checkPhone(request, token, editedPhone)).toEqual({ match: { id: personId, displayName: fixtureName } })

    await updatePhone(request, token, personId, null)
    expect(await readPhoneState(personId)).toMatchObject({ phone: null, digest: null })
    expect(await checkPhone(request, token, editedPhone)).toEqual({ match: null })
  } finally {
    try {
      await clearDecoys()
    } finally {
      if (personId) {
        await apiRequest(request, 'DELETE', '/api/customers/people', { token, data: { id: personId } })
      }
    }
  }
})
