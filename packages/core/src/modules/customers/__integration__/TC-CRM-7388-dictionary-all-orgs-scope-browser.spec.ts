import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CRM-7388 [P1]: PersonCompaniesSection and DealForm dictionaries stay scoped to
 * the record's own organization under "All organizations" (#7388).
 *
 * Before the fix, the dictionary lookups behind the person Companies tab and the
 * deal status field carried no organization context, so under "All organizations"
 * the server rejected them (`organization_required`) and the UI fell back to the
 * raw dictionary value instead of its label. This drives both screens in a real
 * browser under "All organizations" and asserts each shows the record's OWN
 * organization's label — never the sibling organization's label, never the
 * `organization_required` message, and never a restricted actor's read of a
 * sibling organization's entries.
 */
const PASSWORD = 'StrongSecret123!'

type DictionaryListResponse = { items?: Array<{ id?: string; label?: string; value?: string }> }

async function createDictionaryEntry(
  request: APIRequestContext,
  token: string,
  kind: string,
  organizationId: string,
  value: string,
  label: string,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', `/api/customers/dictionaries/${kind}`, {
    token,
    selectedOrgId: organizationId,
    data: { value, label },
  })
  expect(response.status(), `POST dictionaries/${kind} in organization ${organizationId} should return 201`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'dictionary entry creation response should include id')
}

async function deleteDictionaryEntry(
  request: APIRequestContext,
  token: string | null,
  kind: string,
  organizationId: string | null,
  entryId: string | null,
): Promise<void> {
  if (!token || !organizationId || !entryId) return
  await apiRequestWithSelectedOrg(request, 'DELETE', `/api/customers/dictionaries/${kind}/${entryId}`, {
    token,
    selectedOrgId: organizationId,
  }).catch(() => undefined)
}

test.describe('TC-CRM-7388: customer dictionary org scope under "All organizations" (#7388)', () => {
  test('person Companies tab and deal status field show the record\'s own organization label', async ({ page, request, baseURL }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}${randomInt(1_000_000)}`
    const statusValue = `qa7388status${stamp}`
    const dealStatusValue = `qa7388dealstatus${stamp}`
    const orgALabel = `QA 7388 Org A Status ${stamp}`
    const orgBLabel = `QA 7388 Org B Status ${stamp}`
    const dealOrgALabel = `QA 7388 Org A Deal Status ${stamp}`
    const dealOrgBLabel = `QA 7388 Org B Deal Status ${stamp}`

    let orgA: string | null = null
    let orgB: string | null = null
    let personId: string | null = null
    let companyId: string | null = null
    let dealId: string | null = null
    let statusEntryAId: string | null = null
    let statusEntryBId: string | null = null
    let dealStatusEntryAId: string | null = null
    let dealStatusEntryBId: string | null = null

    try {
      orgA = await createOrganizationFixture(request, adminToken, { name: `QA TC-CRM-7388 A ${stamp}`, tenantId })
      orgB = await createOrganizationFixture(request, adminToken, { name: `QA TC-CRM-7388 B ${stamp}`, tenantId })

      // Same dictionary `value` in both organizations, with a different label each —
      // if the owning-organization scope is lost, the wrong sibling label (or the
      // raw value) would render instead.
      statusEntryAId = await createDictionaryEntry(request, adminToken, 'statuses', orgA, statusValue, orgALabel)
      statusEntryBId = await createDictionaryEntry(request, adminToken, 'statuses', orgB, statusValue, orgBLabel)
      dealStatusEntryAId = await createDictionaryEntry(request, adminToken, 'deal-statuses', orgA, dealStatusValue, dealOrgALabel)
      dealStatusEntryBId = await createDictionaryEntry(request, adminToken, 'deal-statuses', orgB, dealStatusValue, dealOrgBLabel)

      const personCreate = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/people', {
        token: adminToken,
        selectedOrgId: orgA,
        data: { firstName: 'QA7388', lastName: 'Person', displayName: `QA 7388 Person ${stamp}` },
      })
      expect(personCreate.status(), 'person fixture create should return 201').toBe(201)
      personId = expectId((await readJsonSafe<{ id?: string }>(personCreate))?.id, 'person id')

      const companyCreate = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/companies', {
        token: adminToken,
        selectedOrgId: orgA,
        data: { displayName: `QA 7388 Company ${stamp}`, status: statusValue },
      })
      expect(companyCreate.status(), 'company fixture create should return 201').toBe(201)
      companyId = expectId((await readJsonSafe<{ id?: string }>(companyCreate))?.id, 'company id')

      const link = await apiRequestWithSelectedOrg(request, 'POST', `/api/customers/people/${personId}/companies`, {
        token: adminToken,
        selectedOrgId: orgA,
        data: { companyId, isPrimary: true },
      })
      expect(link.ok(), 'linking the company to the person should succeed').toBeTruthy()

      const dealCreate = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/deals', {
        token: adminToken,
        selectedOrgId: orgA,
        data: { title: `QA 7388 Deal ${stamp}`, status: dealStatusValue, companyIds: [companyId] },
      })
      expect(dealCreate.status(), 'deal fixture create should return 201').toBe(201)
      dealId = expectId((await readJsonSafe<{ id?: string }>(dealCreate))?.id, 'deal id')

      await login(page, 'admin')
      expect(baseURL).toBeTruthy()
      await page.context().addCookies([{ name: 'om_selected_org', value: '__all__', url: baseURL!, sameSite: 'Lax' }])

      const companiesDictResponse = page.waitForResponse((response) => response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/customers/dictionaries/statuses'
        && new URL(response.url()).searchParams.get('organizationId') === orgA)
      await page.goto(`/backend/customers/people-v2/${personId}?tab=companies`)
      const dictResponse = await companiesDictResponse
      expect(
        dictResponse.ok(),
        'the Companies tab dictionary request must scope to the person\'s own organization and succeed under "All organizations"',
      ).toBeTruthy()

      await expect(page.getByText(orgALabel, { exact: true })).toBeVisible()
      await expect(page.getByText(orgBLabel, { exact: true })).toHaveCount(0)
      await expect(page.getByText('Organization context is required')).toHaveCount(0)

      const dealStatusDictResponse = page.waitForResponse((response) => response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/customers/dictionaries/deal-statuses'
        && new URL(response.url()).searchParams.get('organizationId') === orgA)
      await page.goto(`/backend/customers/deals/${dealId}`)
      const dealDictResponse = await dealStatusDictResponse
      expect(
        dealDictResponse.ok(),
        'the deal status field must scope to the deal\'s own organization and succeed under "All organizations"',
      ).toBeTruthy()

      // The deal detail form zone renders as a collapsed rail below the
      // side-by-side breakpoint — the fields still mount and fetch (the dict
      // request above already proved that) but stay hidden until expanded.
      const expandFormPanel = page.getByRole('button', { name: 'Expand form panel' })
      if (await expandFormPanel.isVisible().catch(() => false)) {
        await expandFormPanel.click()
      }

      const statusField = page.locator('[data-crud-field-id="status"]')
      await expect(statusField.getByText('Organization context is required')).toHaveCount(0)
      // Radix Select mirrors its value into a visually hidden native <select><option>
      // for autofill support, so a DOM-based getByText() match on the field container
      // resolves to both it and the visible trigger. Scope to the trigger explicitly
      // (same pattern as TC-CRM-007.spec.ts) instead.
      const statusTrigger = statusField.getByRole('combobox')
      await expect(statusTrigger).toHaveText(dealOrgALabel)
      await statusTrigger.click()
      await expect(page.getByRole('option', { name: dealOrgALabel, exact: true })).toBeVisible()
      await expect(page.getByRole('option', { name: dealOrgBLabel, exact: true })).toHaveCount(0)
      await page.keyboard.press('Escape')
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/customers/deals', dealId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      await deleteDictionaryEntry(request, adminToken, 'statuses', orgA, statusEntryAId)
      await deleteDictionaryEntry(request, adminToken, 'statuses', orgB, statusEntryBId)
      await deleteDictionaryEntry(request, adminToken, 'deal-statuses', orgA, dealStatusEntryAId)
      await deleteDictionaryEntry(request, adminToken, 'deal-statuses', orgB, dealStatusEntryBId)
      await deleteOrganizationIfExists(request, adminToken, orgA)
      await deleteOrganizationIfExists(request, adminToken, orgB)
    }
  })

  test('a user restricted to a sibling organization cannot read another organization\'s dictionary entries under "All organizations" (#7388)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}${randomInt(1_000_000)}`
    const statusValue = `qa7388restricted${stamp}`
    const orgALabel = `QA 7388 Restricted Org A ${stamp}`
    const email = `qa-tc-crm-7388-${stamp}@example.com`

    let orgA: string | null = null
    let orgB: string | null = null
    let statusEntryAId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      orgA = await createOrganizationFixture(request, adminToken, { name: `QA TC-CRM-7388 Restricted A ${stamp}`, tenantId })
      orgB = await createOrganizationFixture(request, adminToken, { name: `QA TC-CRM-7388 Restricted B ${stamp}`, tenantId })
      statusEntryAId = await createDictionaryEntry(request, adminToken, 'statuses', orgA, statusValue, orgALabel)

      roleId = await createRoleFixture(request, adminToken, { name: `qa-tc-crm-7388-${stamp}` })
      userId = await createUserFixture(request, adminToken, {
        email,
        password: PASSWORD,
        organizationId: orgB,
        roles: [roleId],
        name: 'QA TC-CRM-7388 Restricted',
      })
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: [orgB],
        features: ['customers.people.view'],
      })
      const restrictedToken = await getAuthToken(request, email, PASSWORD)

      // Asking for orgA's dictionary while restricted to orgB must never surface
      // orgA's label — fail closed, not fail open.
      const response = await apiRequest(request, 'GET', `/api/customers/dictionaries/statuses?organizationId=${orgA}`, {
        token: restrictedToken,
      })
      const body = await readJsonSafe<DictionaryListResponse>(response)
      const labels = (body?.items ?? []).map((item) => item.label)
      expect(response.status(), 'a sibling-organization dictionary read must not succeed as a 500/leak').toBeLessThan(500)
      expect(
        labels,
        'a restricted actor must never see another organization\'s dictionary label, regardless of status code',
      ).not.toContain(orgALabel)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteDictionaryEntry(request, adminToken, 'statuses', orgA, statusEntryAId)
      await deleteOrganizationIfExists(request, adminToken, orgA)
      await deleteOrganizationIfExists(request, adminToken, orgB)
    }
  })
})
