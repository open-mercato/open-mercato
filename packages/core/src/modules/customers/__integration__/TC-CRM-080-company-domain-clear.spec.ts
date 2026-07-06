import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const COMPANIES_PATH = '/api/customers/companies'

// Regression for #2529 (alinadivante comment 4638514821, "TC C"): a previously-set
// company Domain must be clearable. Before the fix the blanked value was dropped
// from the update payload (and rejected by the non-nullable validator), so the old
// domain reappeared after reload. Website already cleared correctly.
test.describe('TC-CRM-080: Company domain is clearable on edit', () => {
  test('clearing a saved domain persists as empty', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const domain = `qa-domain-${stamp}.example.com`
    let companyId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', COMPANIES_PATH, {
        token,
        data: { displayName: `QA Domain Co ${stamp}`, domain },
      })
      expect(createResponse.status(), 'company create should return 201').toBe(201)
      companyId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'company id')

      const afterCreate = await apiRequest(request, 'GET', `${COMPANIES_PATH}?ids=${companyId}&pageSize=1`, { token })
      const created = (await readJsonSafe<{ items?: Array<{ domain?: string | null }> }>(afterCreate))?.items?.[0]
      expect(created?.domain, 'domain should be saved on create').toBe(domain)

      const clearResponse = await apiRequest(request, 'PUT', COMPANIES_PATH, {
        token,
        data: { id: companyId, domain: '' },
      })
      expect(clearResponse.status(), 'domain clear update should succeed').toBeLessThan(400)

      const afterClear = await apiRequest(request, 'GET', `${COMPANIES_PATH}?ids=${companyId}&pageSize=1`, { token })
      const cleared = (await readJsonSafe<{ items?: Array<{ domain?: string | null }> }>(afterClear))?.items?.[0]
      expect(cleared?.domain ?? null, 'domain should be cleared after save').toBeNull()
    } finally {
      await deleteGeneralEntityIfExists(request, token, COMPANIES_PATH, companyId)
    }
  })
})
