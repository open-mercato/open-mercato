import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['customers', 'dictionaries', 'auth', 'directory'],
}

test('TC-CRM-9450: deal-only and company-only roles can read customer dictionaries while writes stay restricted', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'superadmin')
  const tenantId = expectId(getTokenContext(adminToken).tenantId, 'Tenant context is required')
  const fixtureId = randomUUID()
  const password = `Test-${fixtureId}!`
  let organizationId: string | null = null
  let currencyDictionaryId: string | null = null
  let dealStatusEntryId: string | null = null
  let companyStatusEntryId: string | null = null
  const createdUserIds: string[] = []

  const createScopedUser = async (prefix: string, features: string[]) => {
    const email = `${prefix}-${fixtureId}@example.com`
    const userId = await createUserFixture(request, adminToken, {
      email,
      password,
      organizationId: organizationId!,
      roles: [],
    })
    createdUserIds.push(userId)
    await setUserAclVisibility(request, adminToken, {
      userId,
      organizations: [organizationId!],
      features,
    })
    return getAuthToken(request, email, password)
  }

  try {
    organizationId = await createOrganizationFixture(request, adminToken, {
      name: `TC-CRM-9450 ${fixtureId}`,
      tenantId,
    })

    const dealStatusRes = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/dictionaries/deal-statuses', {
      token: adminToken,
      selectedOrgId: organizationId,
      data: { value: 'qa_open', label: 'QA Open' },
    })
    expect(dealStatusRes.ok()).toBeTruthy()
    dealStatusEntryId = (await readJsonSafe<{ id?: string }>(dealStatusRes))?.id ?? null

    const statusRes = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/dictionaries/statuses', {
      token: adminToken,
      selectedOrgId: organizationId,
      data: { value: 'qa_active', label: 'QA Active' },
    })
    expect(statusRes.ok()).toBeTruthy()
    companyStatusEntryId = (await readJsonSafe<{ id?: string }>(statusRes))?.id ?? null

    const currencyDictRes = await apiRequestWithSelectedOrg(request, 'POST', '/api/dictionaries', {
      token: adminToken,
      selectedOrgId: organizationId,
      data: { key: 'currency', name: 'Currencies' },
    })
    expect(currencyDictRes.ok()).toBeTruthy()
    currencyDictionaryId = (await readJsonSafe<{ id?: string }>(currencyDictRes))?.id ?? null
    if (currencyDictionaryId) {
      const currencyEntryRes = await apiRequestWithSelectedOrg(
        request,
        'POST',
        `/api/dictionaries/${currencyDictionaryId}/entries`,
        {
          token: adminToken,
          selectedOrgId: organizationId,
          data: { value: 'USD', label: 'US Dollar' },
        },
      )
      expect(currencyEntryRes.ok()).toBeTruthy()
    }

    const dealViewerToken = await createScopedUser('qa-crm-9450-deals', ['customers.deals.view', 'dashboards.view'])
    const companyViewerToken = await createScopedUser('qa-crm-9450-companies', ['customers.companies.view', 'dashboards.view'])
    const noCustomerToken = await createScopedUser('qa-crm-9450-none', ['dashboards.view'])

    // Deal-only role reads deal dictionaries, currency, and kind-settings
    for (const path of [
      '/api/customers/dictionaries/deal-statuses',
      '/api/customers/dictionaries/pipeline-stages',
      '/api/customers/dictionaries/currency',
      '/api/customers/dictionaries/kind-settings',
    ]) {
      const res = await apiRequestWithSelectedOrg(request, 'GET', path, {
        token: dealViewerToken,
        selectedOrgId: organizationId,
      })
      expect(res.status(), `deal viewer GET ${path}`).toBe(200)
    }

    // Company-only role reads company dictionaries and kind-settings
    for (const path of [
      '/api/customers/dictionaries/statuses',
      '/api/customers/dictionaries/sources',
      '/api/customers/dictionaries/lifecycle-stages',
      '/api/customers/dictionaries/industries',
      '/api/customers/dictionaries/kind-settings',
    ]) {
      const res = await apiRequestWithSelectedOrg(request, 'GET', path, {
        token: companyViewerToken,
        selectedOrgId: organizationId,
      })
      expect(res.status(), `company viewer GET ${path}`).toBe(200)
    }

    // Writes still require customers.settings.manage
    const deniedWriteRes = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/dictionaries/deal-statuses', {
      token: dealViewerToken,
      selectedOrgId: organizationId,
      data: { value: 'qa_blocked', label: 'Blocked' },
    })
    expect(deniedWriteRes.status()).toBe(403)

    const deniedKindSettingsPatch = await apiRequestWithSelectedOrg(request, 'PATCH', '/api/customers/dictionaries/kind-settings', {
      token: companyViewerToken,
      selectedOrgId: organizationId,
      data: { kind: 'status', visibleInTags: false },
    })
    expect(deniedKindSettingsPatch.status()).toBe(403)

    // Non-customer role is denied on all dictionary reads
    for (const path of [
      '/api/customers/dictionaries/deal-statuses',
      '/api/customers/dictionaries/statuses',
      '/api/customers/dictionaries/currency',
      '/api/customers/dictionaries/kind-settings',
    ]) {
      const res = await apiRequestWithSelectedOrg(request, 'GET', path, {
        token: noCustomerToken,
        selectedOrgId: organizationId,
      })
      expect(res.status(), `non-customer GET ${path}`).toBe(403)
    }
  } finally {
    if (organizationId && dealStatusEntryId) {
      await apiRequestWithSelectedOrg(request, 'DELETE', `/api/customers/dictionaries/deal-statuses/${dealStatusEntryId}`, {
        token: adminToken,
        selectedOrgId: organizationId,
      }).catch(() => undefined)
    }
    if (organizationId && companyStatusEntryId) {
      await apiRequestWithSelectedOrg(request, 'DELETE', `/api/customers/dictionaries/statuses/${companyStatusEntryId}`, {
        token: adminToken,
        selectedOrgId: organizationId,
      }).catch(() => undefined)
    }
    if (organizationId && currencyDictionaryId) {
      await apiRequestWithSelectedOrg(request, 'DELETE', `/api/dictionaries/${currencyDictionaryId}`, {
        token: adminToken,
        selectedOrgId: organizationId,
      }).catch(() => undefined)
    }
    for (const userId of createdUserIds) {
      await deleteUserIfExists(request, adminToken, userId)
    }
    await deleteOrganizationIfExists(request, adminToken, organizationId)
  }
})
