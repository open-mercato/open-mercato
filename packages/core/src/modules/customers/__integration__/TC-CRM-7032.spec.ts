import { expect, test, type APIRequestContext } from '@playwright/test'
import { deleteEntityByBody, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CRM-7032: changing an existing encrypted company profile field persists (#7032)
 *
 * `updateCompanyCommand.prepare` loaded the before-snapshot on the shared request
 * EntityManager. When the PUT also carried `customFields` (the company edit form always
 * sends them), `setCompanyCustomFields` flushed that request EntityManager after the
 * command had committed, and the encryption subscriber re-encrypted the stale snapshot
 * profile — writing the previous legal name / brand name / domain / website / industry
 * back over the new values. Setting a field from empty was unaffected (nothing stale to
 * write back), which is why existing coverage never caught it.
 */
const COMPANY_PROFILE_ENTITY_ID = 'customers:customer_company_profile'
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type CompanyDetail = {
  company: { updatedAt?: string | null }
  profile: {
    legalName?: string | null
    brandName?: string | null
    domain?: string | null
    websiteUrl?: string | null
    industry?: string | null
  } | null
}

async function fetchCompanyDetail(request: APIRequestContext, token: string, companyId: string): Promise<CompanyDetail> {
  const response = await apiRequest(request, 'GET', `/api/customers/companies/${encodeURIComponent(companyId)}`, { token })
  expect(response.status(), 'GET /api/customers/companies/:id should return 200').toBe(200)
  return (await readJsonSafe(response)) as CompanyDetail
}

async function deleteCustomFieldDefinition(request: APIRequestContext, token: string | null, key: string): Promise<void> {
  if (!token) return
  await apiRequest(request, 'DELETE', '/api/entities/definitions', {
    token,
    data: { entityId: COMPANY_PROFILE_ENTITY_ID, key },
  }).catch(() => undefined)
}

test('TC-CRM-7032: changing existing encrypted company profile fields persists alongside custom fields', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const stamp = Date.now()
  const fieldKey = `tc7032_note_${stamp}`
  let companyId: string | null = null

  try {
    const definitionResponse = await apiRequest(request, 'POST', '/api/entities/definitions', {
      token,
      data: {
        entityId: COMPANY_PROFILE_ENTITY_ID,
        key: fieldKey,
        kind: 'text',
        configJson: { label: `TC7032 note ${stamp}`, validation: [] },
      },
    })
    expect(definitionResponse.status(), 'custom field definition should be created').toBe(200)

    const createResponse = await apiRequest(request, 'POST', '/api/customers/companies', {
      token,
      data: {
        displayName: `TC7032 Co ${stamp}`,
        legalName: `TC7032 Legal 1 ${stamp}`,
        brandName: `TC7032 Brand 1 ${stamp}`,
        domain: `tc7032-1-${stamp}.example.com`,
        websiteUrl: `https://tc7032-1-${stamp}.example.com`,
        industry: `TC7032 Industry 1 ${stamp}`,
      },
    })
    expect(createResponse.status(), 'company should be created').toBe(201)
    const created = (await readJsonSafe(createResponse)) as { id?: string; entityId?: string }
    companyId = created.id ?? created.entityId ?? null
    expect(typeof companyId, 'create response should expose the company id').toBe('string')

    const before = await fetchCompanyDetail(request, token, companyId as string)
    expect(before.profile?.legalName).toBe(`TC7032 Legal 1 ${stamp}`)

    const edits = {
      legalName: `TC7032 Legal 2 ${stamp}`,
      brandName: `TC7032 Brand 2 ${stamp}`,
      domain: `tc7032-2-${stamp}.example.com`,
      websiteUrl: `https://tc7032-2-${stamp}.example.com`,
      industry: `TC7032 Industry 2 ${stamp}`,
    }
    const lockToken = before.company.updatedAt ? new Date(Date.parse(before.company.updatedAt)).toISOString() : null
    const putResponse = await apiRequest(request, 'PUT', '/api/customers/companies', {
      token,
      headers: lockToken ? { [OPTIMISTIC_LOCK_HEADER]: lockToken } : undefined,
      data: {
        id: companyId,
        displayName: `TC7032 Co ${stamp}`,
        ...edits,
        customFields: { [fieldKey]: `note ${stamp}` },
      },
    })
    expect(putResponse.status(), 'PUT should succeed').toBe(200)

    const after = await fetchCompanyDetail(request, token, companyId as string)
    expect(after.profile?.legalName, 'legalName should persist').toBe(edits.legalName)
    expect(after.profile?.brandName, 'brandName should persist').toBe(edits.brandName)
    expect(after.profile?.domain, 'domain should persist').toBe(edits.domain)
    expect(after.profile?.websiteUrl, 'websiteUrl should persist').toBe(edits.websiteUrl)
    expect(after.profile?.industry, 'industry should persist').toBe(edits.industry)
  } finally {
    await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
    await deleteCustomFieldDefinition(request, token, fieldKey)
  }
})
