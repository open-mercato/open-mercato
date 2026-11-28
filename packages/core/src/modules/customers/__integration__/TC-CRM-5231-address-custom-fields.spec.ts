import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'

export const integrationMeta = { dependsOnModules: ['customers', 'entities', 'auth', 'directory', 'audit_logs', 'query_index'] }

const ADDRESSES = '/api/customers/addresses'
const COMPANIES = '/api/customers/companies'
const DEFINITIONS = '/api/entities/definitions'
const ADDRESS_HOST = 'customers:customer_address'

type AddressListItem = {
  id: string
  updated_at: string
  customValues?: Record<string, unknown>
}

async function readAddress(request: APIRequestContext, token: string, id: string): Promise<AddressListItem | undefined> {
  const response = await apiRequest(request, 'GET', `${ADDRESSES}?id=${id}`, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<{ items: AddressListItem[] }>(response))?.items.find((item) => item.id === id)
}

async function defineAddressField(request: APIRequestContext, token: string, key: string) {
  const response = await apiRequest(request, 'POST', DEFINITIONS, {
    token,
    data: { entityId: ADDRESS_HOST, key, kind: 'text', configJson: { label: key } },
  })
  expect(response.status()).toBe(200)
}

async function deleteAddressField(request: APIRequestContext, token: string, key: string) {
  await apiRequest(request, 'DELETE', DEFINITIONS, { token, data: { entityId: ADDRESS_HOST, key } })
}

test('customer addresses patch, clear and restore custom values with optimistic locking', async ({ request }) => {
  skipIfUndoTestsDisabled()
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID().replaceAll('-', '')
  const firstField = `access_note_${stamp}`
  const secondField = `delivery_slot_${stamp}`
  const initial = { [firstField]: `North gate ${stamp}`, [secondField]: '09:00' }
  const updated = { ...initial, [secondField]: '10:00' }
  let companyId: string | null = null
  let addressId: string | null = null

  try {
    await defineAddressField(request, token, firstField)
    await defineAddressField(request, token, secondField)
    companyId = await createCompanyFixture(request, token, `Address custom fields ${stamp}`)
    const created = await apiRequest(request, 'POST', ADDRESSES, {
      token, data: { entityId: companyId, addressLine1: 'First Street', customValues: initial },
    })
    expect(created.status()).toBe(201)
    addressId = expectId((await readJsonSafe<{ id: string }>(created))?.id, 'created address id')
    const original = await readAddress(request, token, addressId)
    expect(original?.customValues).toEqual(initial)
    const originalVersion = expectId(original?.updated_at, 'initial address version')

    const edit = await apiRequest(request, 'PUT', ADDRESSES, {
      token,
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: originalVersion },
      data: { id: addressId, customValues: { [secondField]: '10:00' } },
    })
    expect(edit.status()).toBe(200)
    const edited = await readAddress(request, token, addressId)
    expect(edited?.customValues).toEqual(updated)
    expect(edited?.updated_at).not.toBe(originalVersion)
    const stale = await apiRequest(request, 'PUT', ADDRESSES, {
      token,
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: originalVersion },
      data: { id: addressId, customValues: { [secondField]: '11:00' } },
    })
    expect(stale.status()).toBe(409)

    const postal = await apiRequest(request, 'PUT', ADDRESSES, { token, data: { id: addressId, city: 'Warsaw' } })
    expect(postal.status()).toBe(200)
    expect((await readAddress(request, token, addressId))?.customValues).toEqual(updated)

    const invalid = await apiRequest(request, 'PUT', ADDRESSES, {
      token, data: { id: addressId, customValues: { taxId: 'wrong' } },
    })
    expect([400, 422]).toContain(invalid.status())
    expect((await readAddress(request, token, addressId))?.customValues).toEqual(updated)

    const cleared = await apiRequest(request, 'PUT', ADDRESSES, {
      token, data: { id: addressId, customValues: { [secondField]: null } },
    })
    expect(cleared.status()).toBe(200)
    expect((await readAddress(request, token, addressId))?.customValues).toEqual({ [firstField]: initial[firstField] })
    await undoOk(request, token, expectOperation(cleared, 'address update').undoToken, 'address update')
    expect((await readAddress(request, token, addressId))?.customValues).toEqual(updated)

    const deleted = await apiRequest(request, 'DELETE', `${ADDRESSES}?id=${addressId}`, { token })
    expect(deleted.status()).toBe(200)
    expect(await readAddress(request, token, addressId)).toBeUndefined()
    await undoOk(request, token, expectOperation(deleted, 'address delete').undoToken, 'address delete')
    expect((await readAddress(request, token, addressId))?.customValues).toEqual(updated)

    const exported = await apiRequest(request, 'GET', `${ADDRESSES}?entityId=${companyId}&format=json`, { token })
    expect(exported.status()).toBe(200)
    expect(await exported.text()).not.toContain(initial[firstField])
    const audit = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?resourceKind=customers.address&resourceId=${addressId}`, { token })
    expect(audit.status()).toBe(200)
    const auditBody = await audit.text()
    expect(auditBody).toContain(addressId)
    expect(auditBody).not.toContain(initial[firstField])
    if (isTenantDataEncryptionEnabled()) {
      const stored = await withClient(async (client) => (await client.query<{ custom_values: unknown }>(
        'select custom_values from customer_addresses where id = $1', [addressId],
      )).rows[0]?.custom_values)
      expect(isEncryptedPayloadShape(stored)).toBe(true)
    }
    await expect.poll(() => withClient(async (client) => (await client.query<{ doc: Record<string, unknown> }>(
      'select doc from entity_indexes where entity_type = $1 and entity_id = $2 and deleted_at is null',
      [ADDRESS_HOST, addressId],
    )).rows[0]?.doc)).toBeDefined()
    await withClient(async (client) => {
      const indexed = (await client.query<{ doc: Record<string, unknown> }>(
        'select doc from entity_indexes where entity_type = $1 and entity_id = $2 and deleted_at is null',
        [ADDRESS_HOST, addressId],
      )).rows[0]?.doc
      expect(indexed).not.toHaveProperty('custom_values')
      expect(indexed).not.toHaveProperty(`cf:${firstField}`)
      expect(JSON.stringify(indexed)).not.toContain(initial[firstField])
    })

    const disjointPatches = { [firstField]: 'Changed entrance', [secondField]: '12:00' }
    const simultaneous = await Promise.all(Object.entries(disjointPatches).map(([key, value]) => (
      apiRequest(request, 'PUT', ADDRESSES, {
        token, data: { id: addressId, customValues: { [key]: value } },
      })
    )))
    expect(simultaneous.map((response) => response.status())).toEqual([200, 200])
    expect((await readAddress(request, token, addressId))?.customValues).toEqual(disjointPatches)
  } finally {
    await deleteEntityIfExists(request, token, ADDRESSES, addressId)
    await deleteEntityIfExists(request, token, COMPANIES, companyId)
    await deleteAddressField(request, token, secondField)
    await deleteAddressField(request, token, firstField)
  }
})

test('customer address custom values follow address ACL and organization scope', async ({ request }) => {
  const [token, root] = await Promise.all([getAuthToken(request, 'admin'), getAuthToken(request, 'superadmin')])
  const scope = getTokenContext(token)
  const stamp = randomUUID().replaceAll('-', '')
  const key = `scoped_route_${stamp}`
  const secretValue = `Private route ${stamp}`
  const password = `Aa1!${randomUUID()}`
  let companyId: string | null = null
  let addressId: string | null = null
  let roleId: string | null = null
  let otherOrganization: string | null = null
  const userIds: string[] = []

  try {
    await defineAddressField(request, token, key)
    companyId = await createCompanyFixture(request, token, `Address scope ${stamp}`)
    const created = await apiRequest(request, 'POST', ADDRESSES, {
      token, data: { entityId: companyId, addressLine1: 'Scope Street', customValues: { [key]: secretValue } },
    })
    expect(created.status()).toBe(201)
    addressId = expectId((await readJsonSafe<{ id: string }>(created))?.id, 'scoped address id')

    roleId = await createRoleFixture(request, root, { name: `Address read ${stamp}`, tenantId: scope.tenantId })
    const companyViewerEmail = `no-address-view-${stamp}@example.test`
    await setRoleAclFeatures(request, root, { roleId, features: ['customers.companies.view'], organizations: [scope.organizationId] })
    userIds.push(await createUserFixture(request, root, {
      email: companyViewerEmail, password, organizationId: scope.organizationId, roles: [roleId],
    }))
    const companyViewer = await getAuthToken(request, companyViewerEmail, password)
    const denied = await apiRequest(request, 'GET', `${ADDRESSES}?id=${addressId}`, { token: companyViewer })
    expect(denied.status()).toBe(403)
    const embedded = await apiRequest(request, 'GET', `${COMPANIES}/${companyId}?include=addresses`, { token: companyViewer })
    expect(embedded.status()).toBe(200)
    const embeddedBody = await embedded.text()
    expect(embeddedBody).toContain(addressId)
    expect(embeddedBody).not.toContain(secretValue)

    otherOrganization = await createOrganizationFixture(request, root, { name: `Address sibling ${stamp}`, tenantId: scope.tenantId })
    const otherViewerEmail = `address-other-org-${stamp}@example.test`
    await setRoleAclFeatures(request, root, { roleId, features: ['customers.activities.view'], organizations: [otherOrganization] })
    userIds.push(await createUserFixture(request, root, {
      email: otherViewerEmail, password, organizationId: otherOrganization, roles: [roleId],
    }))
    const otherViewer = await getAuthToken(request, otherViewerEmail, password)
    expect(await readAddress(request, otherViewer, addressId)).toBeUndefined()
  } finally {
    for (const userId of userIds) await deleteUserIfExists(request, root, userId)
    await deleteRoleIfExists(request, root, roleId)
    await deleteOrganizationIfExists(request, root, otherOrganization)
    await deleteEntityIfExists(request, token, ADDRESSES, addressId)
    await deleteEntityIfExists(request, token, COMPANIES, companyId)
    await deleteAddressField(request, token, key)
  }
})
