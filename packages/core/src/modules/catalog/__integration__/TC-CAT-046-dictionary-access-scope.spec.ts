import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test.describe('TC-CAT-046: catalog dictionary access scope (#9157)', () => {
  test('isolates organizations and requires dictionary permission for arbitrary keys', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenScope(token)
    const stamp = randomUUID()
    const password = randomUUID()
    const organizationIds: string[] = []
    const roleIds: string[] = []
    const userIds: string[] = []
    const dictionaries: Array<{ id: string; organizationId: string }> = []

    try {
      for (const suffix of ['a', 'b']) {
        organizationIds.push(await createOrganizationFixture(request, token, {
          name: `QA dictionary ${suffix} ${stamp}`, tenantId,
        }))
      }
      const [organizationA, organizationB] = organizationIds
      const customKey = `qa_catalog_${stamp}`

      for (const fixture of [
        { key: 'unit', organizationId: organizationA, value: 'outside-unit' },
        { key: customKey, organizationId: organizationB, value: 'private-value' },
      ]) {
        const create = await apiRequestWithSelectedOrg(request, 'POST', '/api/dictionaries', {
          token, selectedOrgId: fixture.organizationId,
          data: { key: fixture.key, name: `QA ${fixture.key} ${stamp}` },
        })
        expect(create.status()).toBe(201)
        const body = await readJsonSafe<{ id?: string }>(create)
        const id = expectId(body?.id, 'Created dictionary must have an id')
        dictionaries.push({ id, organizationId: fixture.organizationId })
        const entry = await apiRequestWithSelectedOrg(request, 'POST', `/api/dictionaries/${id}/entries`, {
          token, selectedOrgId: fixture.organizationId,
          data: { value: fixture.value, label: `QA ${fixture.value}` },
        })
        expect(entry.status()).toBe(201)
      }

      const callerTokens: string[] = []
      for (const [index, features] of [
        ['catalog.products.manage'],
        ['catalog.products.manage', 'dictionaries.*'],
      ].entries()) {
        const roleId = await createRoleFixture(request, token, { name: `qa_catalog_dict_${index}_${stamp}`, tenantId })
        roleIds.push(roleId)
        await setRoleAclFeatures(request, token, { roleId, features, organizations: [organizationB] })
        const email = `qa-catalog-dictionary-${index}-${stamp}@example.com`
        userIds.push(await createUserFixture(request, token, {
          email, password, organizationId: organizationB, roles: [roleId],
        }))
        callerTokens.push(await getAuthToken(request, email, password))
      }
      const [catalogToken, dictionaryToken] = callerTokens

      const foreignUnit = await apiRequest(request, 'GET', '/api/catalog/dictionaries/unit', { token: catalogToken })
      expect(foreignUnit.status()).toBe(404)
      const denied = await apiRequest(request, 'GET', `/api/catalog/dictionaries/${customKey}`, { token: catalogToken })
      expect(denied.status()).toBe(403)
      const authorized = await apiRequest(request, 'GET', `/api/catalog/dictionaries/${customKey}`, { token: dictionaryToken })
      expect(authorized.status()).toBe(200)
      expect(await readJsonSafe<{ id: string; entries: Array<{ value: string }> }>(authorized)).toMatchObject({
        id: dictionaries[1].id, entries: [{ value: 'private-value' }],
      })
      const foreignUnitWithPermission = await apiRequest(request, 'GET', '/api/catalog/dictionaries/unit', { token: dictionaryToken })
      expect(foreignUnitWithPermission.status()).toBe(404)

      const ownUnit = await apiRequestWithSelectedOrg(request, 'POST', '/api/dictionaries', {
        token, selectedOrgId: organizationB, data: { key: 'unit', name: `QA own unit ${stamp}` },
      })
      expect(ownUnit.status()).toBe(201)
      const ownUnitId = expectId((await readJsonSafe<{ id?: string }>(ownUnit))?.id, 'Own unit dictionary must have an id')
      dictionaries.push({ id: ownUnitId, organizationId: organizationB })
      const ownRead = await apiRequest(request, 'GET', '/api/catalog/dictionaries/unit', { token: catalogToken })
      expect(ownRead.status()).toBe(200)
      expect(await readJsonSafe<{ id: string }>(ownRead)).toMatchObject({ id: ownUnitId })
    } finally {
      for (const dictionary of dictionaries.reverse()) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `/api/dictionaries/${dictionary.id}`, {
          token, selectedOrgId: dictionary.organizationId,
        })
      }
      for (const userId of userIds.reverse()) await deleteUserIfExists(request, token, userId)
      for (const roleId of roleIds.reverse()) await deleteRoleIfExists(request, token, roleId)
      for (const organizationId of organizationIds.reverse()) await deleteOrganizationIfExists(request, token, organizationId)
    }
  })
})
