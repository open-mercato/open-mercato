import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { deleteUserAclInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteEntityByPathIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, redoOk, skipIfUndoTestsDisabled, undoByToken, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

async function storedRows(entityId: string, addressId: string, labelId: string) {
  return withClient(async (client) => {
    const result = await client.query(
      `select
        exists(select 1 from customer_entities where id = $1) as customer,
        exists(select 1 from customer_addresses where id = $2) as address,
        exists(select 1 from customer_label_assignments where entity_id = $1 and label_id = $3) as assignment`,
      [entityId, addressId, labelId],
    )
    return result.rows[0]
  })
}

for (const collection of ['people', 'companies'] as const) {
  test(`TC-CRM-7614: undoing ${collection} creation removes later addresses and label assignments`, async ({ request }) => {
    skipIfUndoTestsDisabled()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const path = `/api/customers/${collection}`
    const addressesPath = '/api/customers/addresses'
    const name = `Create undo ${crypto.randomUUID()}`
    const email = `${crypto.randomUUID()}@example.test`
    const password = customerTestPassword()
    const replayFeatures = ['audit_logs.undo_self', 'audit_logs.redo_self']
    const manageFeatures = [`customers.${collection}.manage`, ...replayFeatures]
    let userId: string | null = null
    let entityId: string | undefined
    let labelId: string | undefined
    try {
      userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [] })
      const acl = { userId, tenantId, organizations: [organizationId] }
      await setUserAclInDb({ ...acl, features: manageFeatures })
      const token = await getAuthToken(request, email, password)
      const create = await apiRequest(request, 'POST', path, {
        token,
        data: collection === 'people' ? { firstName: 'Undo', lastName: name, displayName: name } : { displayName: name },
      })
      entityId = expectId((await readJsonSafe<{ id?: string }>(create))?.id, `create ${collection}`)
      const operation = expectOperation(create, `customers.${collection}.create`)
      const address = await apiRequest(request, 'POST', addressesPath, {
        token: adminToken,
        data: { entityId, addressLine1: 'Added after creation' },
      })
      const addressId = expectId((await readJsonSafe<{ id?: string }>(address))?.id, 'create customer address')
      const label = await apiRequest(request, 'POST', '/api/customers/labels', { token: adminToken, data: { label: name } })
      labelId = expectId((await readJsonSafe<{ id?: string }>(label))?.id, 'create customer label')
      const assign = await apiRequest(request, 'POST', '/api/customers/labels/assign', { token: adminToken, data: { entityId, labelId } })
      expect(assign.status()).toBe(201)
      const addressListPath = `${addressesPath}?entityId=${entityId}`
      const before = await apiRequest(request, 'GET', addressListPath, { token: adminToken })
      expect(await readJsonSafe(before)).toMatchObject({ items: [expect.objectContaining({ id: addressId })] })

      await setUserAclInDb({ ...acl, features: replayFeatures })
      expect((await undoByToken(request, token, operation.undoToken)).status()).toBe(403)
      expect(await storedRows(entityId, addressId, labelId)).toEqual({ customer: true, address: true, assignment: true })
      await setUserAclInDb({ ...acl, features: manageFeatures })

      await undoOk(request, token, operation.undoToken, `undo ${collection} create`)
      const after = await apiRequest(request, 'GET', addressListPath, { token: adminToken })
      expect(await readJsonSafe(after)).toMatchObject({ items: [] })
      expect(await storedRows(entityId, addressId, labelId)).toEqual({ customer: false, address: false, assignment: false })
      await redoOk(request, token, operation.logId, `redo ${collection} create`)
      const restored = await apiRequest(request, 'GET', `${path}/${entityId}`, { token: adminToken })
      expect(restored.ok()).toBe(true)
    } finally {
      if (labelId) await withClient(async (client) => {
        await client.query('delete from customer_label_assignments where label_id = $1', [labelId])
        await client.query('delete from customer_labels where id = $1', [labelId])
      })
      if (entityId) await deleteEntityByPathIfExists(request, adminToken, `${path}?id=${entityId}`)
      if (userId) {
        await deleteUserAclInDb(userId)
        await deleteUserIfExists(request, adminToken, userId)
      }
    }
  })
}
