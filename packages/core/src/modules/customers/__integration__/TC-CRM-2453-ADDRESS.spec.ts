import { expect, test } from '@playwright/test'
import {
  createCompanyFixture,
  deleteEntityByBody,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CRM-2453-ADDRESS: Address update persists every scalar field (#2453 sibling)
 *
 * `updateAddressCommand` mutates the address entity scalars (addressLine1, city,
 * isPrimary, …) and then — still inside the same `withAtomicFlush` — runs
 * `enforcePrimaryAddress`, whose `em.nativeUpdate` demotes the other primary
 * address on the same EntityManager. That interleaved write is preceded by the
 * managed-entity changeset; under MikroORM v7 the still-pending scalar changeset
 * was dropped by the in-scope query/update, so the PUT returned 200 with
 * `updated_at` bumped while addressLine1 / city were never persisted. The fix
 * flushes the scalar mutations before `enforcePrimaryAddress` runs.
 *
 * The trigger that reproduces the bug: promote THIS address to primary
 * (`isPrimary: true`) while ANOTHER primary address already exists for the same
 * entity, so `enforcePrimaryAddress` issues its interleaved `nativeUpdate`. We
 * then re-fetch and assert the changed line1/city columns round-trip — not just
 * that the status was 200.
 */
const ADDRESSES_PATH = '/api/customers/addresses'

type AddressListItem = {
  id: string
  address_line1?: string | null
  city?: string | null
  is_primary?: boolean | null
}

async function createAddress(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', ADDRESSES_PATH, { token, data })
  const payload = await readJsonSafe(response)
  expect(response.ok(), `Failed to create address: ${response.status()}`).toBeTruthy()
  const id = (payload as { id?: string; addressId?: string }).id ?? (payload as { addressId?: string }).addressId
  expect(typeof id, 'address create response should expose id').toBe('string')
  return id as string
}

async function listAddresses(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  entityId: string,
): Promise<AddressListItem[]> {
  const response = await apiRequest(request, 'GET', `${ADDRESSES_PATH}?entityId=${encodeURIComponent(entityId)}`, {
    token,
  })
  expect(response.ok(), `Failed to list addresses: ${response.status()}`).toBeTruthy()
  const body = (await readJsonSafe(response)) as { items?: AddressListItem[] }
  return body.items ?? []
}

test('TC-CRM-2453-ADDRESS: promoting an address to primary still persists its scalar columns', async ({
  request,
}) => {
  const token = await getAuthToken(request, 'admin')
  let companyId: string | null = null
  let primaryAddressId: string | null = null
  let targetAddressId: string | null = null

  try {
    const stamp = Date.now()
    companyId = await createCompanyFixture(request, token, `TC2453 Addr Co ${stamp}`)

    // Existing primary address — its presence is what forces enforcePrimaryAddress
    // to run its interleaved nativeUpdate when we promote the second address.
    primaryAddressId = await createAddress(request, token, {
      entityId: companyId,
      addressLine1: `1 Primary St ${stamp}`,
      city: 'PrimaryCity',
      isPrimary: true,
    })

    // Target address starts non-primary with known scalar values we will change.
    targetAddressId = await createAddress(request, token, {
      entityId: companyId,
      addressLine1: `2 Original Ave ${stamp}`,
      city: 'OriginalCity',
      isPrimary: false,
    })

    const edits = {
      addressLine1: `2 Renamed Ave ${stamp}`,
      city: 'RenamedCity',
    }

    // PUT changes scalar columns AND sets isPrimary:true — the latter triggers
    // enforcePrimaryAddress's interleaved read/update that previously reverted
    // the scalar changeset.
    const putResponse = await apiRequest(request, 'PUT', ADDRESSES_PATH, {
      token,
      data: {
        id: targetAddressId,
        isPrimary: true,
        ...edits,
      },
    })
    expect(putResponse.status(), 'address PUT should succeed').toBe(200)
    const putBody = (await readJsonSafe(putResponse)) as { ok?: boolean }
    expect(putBody.ok, 'address PUT body should report ok').toBe(true)

    const after = await listAddresses(request, token, companyId)
    const target = after.find((item) => item.id === targetAddressId)
    expect(target, 'updated address should still be returned').toBeTruthy()

    // The interleaved-read fix: scalar columns must round-trip to the new values.
    expect(target?.address_line1, 'addressLine1 should persist').toBe(edits.addressLine1)
    expect(target?.city, 'city should persist').toBe(edits.city)

    // And the primary promotion still took effect (exactly one primary, the target).
    expect(Boolean(target?.is_primary), 'target address should be primary').toBe(true)
    expect(after.filter((item) => item.is_primary).length, 'exactly one primary address').toBe(1)
    const previousPrimary = after.find((item) => item.id === primaryAddressId)
    expect(Boolean(previousPrimary?.is_primary), 'previous primary should be demoted').toBe(false)
  } finally {
    await deleteEntityByBody(request, token, ADDRESSES_PATH, targetAddressId)
    await deleteEntityByBody(request, token, ADDRESSES_PATH, primaryAddressId)
    await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
  }
})
