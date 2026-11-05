import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, deleteOrganizationInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'translations'] }

test.describe('TC-CRM-6197: Customer dictionary translation scope', () => {
  test('denies callers without dictionary-management permission', async ({ request }) => {
    const employee = await getAuthToken(request, 'employee')
    const denied = await apiRequest(request, 'GET', '/api/customers/customer-dictionary-entries', { token: employee })
    expect(denied.status()).toBe(403)
    await withCredentialIsolatedRequest(async (isolated) => {
      const anonymous = await isolated.get('/api/customers/customer-dictionary-entries')
      expect(anonymous.status()).toBe(401)
    })
  })

  test('does not return another organization’s entry by id', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(token)
    const organizationId = await createOrganizationInDb({ name: `Dictionary scope ${Date.now()}`, tenantId })
    let entryId: string | null = null
    try {
      const created = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/dictionaries/sources', {
        token, selectedOrgId: organizationId, data: { value: `scope_${Date.now()}`, label: 'Foreign source' },
      })
      expect(created.ok()).toBeTruthy()
      entryId = (await created.json()).id
      expect(entryId).toBeTruthy()
      const inScope = await apiRequestWithSelectedOrg(request, 'GET', `/api/customers/customer-dictionary-entries?id=${entryId}`, {
        token, selectedOrgId: organizationId,
      })
      expect(inScope.ok()).toBeTruthy()
      expect((await inScope.json()).items).toEqual([expect.objectContaining({ id: entryId, label: 'Foreign source' })])
      const outOfScope = await apiRequest(request, 'GET', `/api/customers/customer-dictionary-entries?id=${entryId}`, { token })
      expect(outOfScope.ok()).toBeTruthy()
      expect(await outOfScope.json()).toMatchObject({ items: [], total: 0 })
    } finally {
      if (entryId) await apiRequestWithSelectedOrg(request, 'DELETE', `/api/customers/dictionaries/sources/${entryId}`, {
        token, selectedOrgId: organizationId,
      })
      await deleteOrganizationInDb(organizationId)
    }
  })
})
