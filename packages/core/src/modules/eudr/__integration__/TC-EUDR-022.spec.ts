import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, redoByLogId, redoOk, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = { dependsOnModules: ['eudr', 'audit_logs', 'customers'] }

for (const resource of ['plots', 'statements', 'product-mappings']) {
  test.describe(`TC-EUDR-022: ${resource} update redo`, () => {
    test.beforeEach(() => skipIfUndoTestsDisabled())

    for (const laterEdit of [false, true]) {
      test(laterEdit ? 'keeps a colleague edit made after undo' : 'reapplies the update when there is no later edit', async ({ request }) => {
        const token = await getAuthToken(request, 'admin')
        const superadminToken = await getAuthToken(request, 'superadmin')
        const { tenantId, organizationId } = getTokenContext(token)
        const stamp = randomUUID()
        const path = `/api/eudr/${resource}`
        const field = resource === 'plots' ? 'name' : 'notes'
        let recordId: string | null = null
        let supplierId: string | null = null
        let roleId: string | null = null
        let userId: string | null = null

        try {
          const payload: Record<string, unknown> = resource === 'statements'
            ? { title: `TC-EUDR-022 ${stamp}`, commodity: 'coffee', notes: 'Original' }
            : resource === 'product-mappings'
              ? { productId: randomUUID(), commodity: 'coffee', notes: 'Original' }
              : { name: `TC-EUDR-022 ${stamp}`, originCountry: 'CI', geometry: { type: 'Point', coordinates: [-5.3, 6.8] }, areaHa: 1 }
          if (resource === 'plots') {
            supplierId = await createCompanyFixture(request, token, `TC-EUDR-022 supplier ${stamp}`)
            payload.supplierEntityId = supplierId
          }
          const create = await apiRequest(request, 'POST', path, { token, data: payload })
          expect(create.status()).toBe(201)
          recordId = expectId((await readJsonSafe<{ id?: string }>(create))?.id, 'EUDR fixture')
          const update = await apiRequest(request, 'PUT', path, { token, data: { id: recordId, [field]: 'My update' } })
          expect(update.status()).toBe(200)
          const operation = expectOperation(update, `${resource} update`)
          await undoOk(request, token, operation.undoToken, `${resource} update`)

          if (laterEdit) {
            roleId = await createRoleFixture(request, superadminToken, { name: `TC-EUDR-022-${stamp}`, tenantId })
            await setRoleAclFeatures(request, superadminToken, { roleId, features: ['eudr.*'], organizations: [organizationId] })
            const email = `eudr-022-${stamp}@example.com`
            const password = `Aa1!${randomUUID()}`
            userId = await createUserFixture(request, superadminToken, { email, password, organizationId, roles: [roleId] })
            const colleagueToken = await getAuthToken(request, email, password)
            const edit = await apiRequest(request, 'PUT', path, { token: colleagueToken, data: { id: recordId, [field]: 'Colleague update' } })
            expect(edit.status()).toBe(200)
            const redo = await redoByLogId(request, token, operation.logId)
            expect(redo.status()).toBe(409)
            const body = await readJsonSafe<{ code?: string; error?: string }>(redo)
            expect(body?.code).toBe('eudr.errors.redoConflict')
            expect(body?.error).toContain('Reload the record')
          } else {
            await redoOk(request, token, operation.logId, `${resource} update`)
          }

          const read = await apiRequest(request, 'GET', `${path}?id=${encodeURIComponent(recordId)}`, { token })
          expect(read.status()).toBe(200)
          const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(read)
          expect(body?.items?.find((item) => item.id === recordId)?.[field]).toBe(laterEdit ? 'Colleague update' : 'My update')
        } finally {
          if (recordId) await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(recordId)}`, { token })
          if (supplierId) await apiRequest(request, 'DELETE', `/api/customers/companies?id=${encodeURIComponent(supplierId)}`, { token })
          await deleteUserIfExists(request, superadminToken, userId)
          await deleteRoleIfExists(request, superadminToken, roleId)
        }
      })
    }
  })
}
