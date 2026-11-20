import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture, createRoleFixture, createUserFixture, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export type AddressEncryptionActor = { token: string; tenantId: string; organizationId: string; unrelatedTenantId: string; unrelatedOrganizationId: string }

export async function withIsolatedAddressEncryptionActor(
  request: APIRequestContext,
  run: (actor: AddressEncryptionActor) => Promise<void>,
): Promise<void> {
  const superToken = await getAuthToken(request, 'superadmin')
  const stamp = randomUUID()
  let tenantId: string | null = null
  let organizationId: string | null = null
  let unrelatedTenantId: string | null = null
  let unrelatedOrganizationId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  try {
    const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token: superToken, data: { name: `Address encryption ${stamp}` } })
    expect(response.status()).toBe(201)
    tenantId = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'address fixture tenant')
    organizationId = await createOrganizationFixture(request, superToken, { name: `Address ${stamp}`, tenantId })
    const unrelated = await apiRequest(request, 'POST', '/api/directory/tenants', { token: superToken, data: { name: `Unrelated address ${stamp}` } })
    expect(unrelated.status()).toBe(201)
    unrelatedTenantId = expectId((await readJsonSafe<{ id?: string }>(unrelated))?.id, 'unrelated fixture tenant')
    unrelatedOrganizationId = await createOrganizationFixture(request, superToken, { name: `Unrelated ${stamp}`, tenantId: unrelatedTenantId })
    roleId = await createRoleFixture(request, superToken, { name: `Address ${stamp}`, tenantId })
    await setRoleAclFeatures(request, superToken, { roleId, features: ['customers.*'], organizations: [organizationId] })
    const email = `address-${stamp}@test.invalid`
    const password = `Test1!${stamp}`
    userId = await createUserFixture(request, superToken, { email, password, organizationId, roles: [roleId] })
    const token = await getAuthToken(request, email, password)
    await run({ token, tenantId, organizationId, unrelatedTenantId, unrelatedOrganizationId })
  } finally {
    const deleteOwned = async (resource: string, id: string | null, body = false) => {
      if (!id) return
      const response = await apiRequest(request, 'DELETE', body ? resource : `${resource}?id=${encodeURIComponent(id)}`, {
        token: superToken, ...(body ? { data: { id } } : {}),
      })
      if (!response.ok() && response.status() !== 404) {
        throw new Error(`[internal] Fixture deletion failed: ${resource} HTTP ${response.status()}`)
      }
    }
    const cleanup = [
      () => deleteOwned('/api/auth/users', userId),
      () => deleteOwned('/api/auth/roles', roleId),
      async () => { if (tenantId) await withClient((client) => client.query('delete from encryption_maps where tenant_id = $1', [tenantId])) },
      async () => { if (unrelatedTenantId) await withClient((client) => client.query('delete from encryption_maps where tenant_id = $1', [unrelatedTenantId])) },
      () => deleteOwned('/api/directory/organizations', organizationId, true),
      () => deleteOwned('/api/directory/organizations', unrelatedOrganizationId, true),
      () => deleteOwned('/api/directory/tenants', tenantId),
      () => deleteOwned('/api/directory/tenants', unrelatedTenantId),
    ]
    const errors: unknown[] = []
    for (const removeFixture of cleanup) {
      try { await removeFixture() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, '[internal] Address fixture cleanup failed')
  }
}
