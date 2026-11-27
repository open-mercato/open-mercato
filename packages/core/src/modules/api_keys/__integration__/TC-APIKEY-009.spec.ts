import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type ActionItem = { id: string; organizationId: string | null; resourceId: string | null }
type ActionsBody = { items?: ActionItem[] }
type RecordItem = { id: string }
type RecordsBody = { items?: RecordItem[] }

async function createCompanyInOrganization(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  displayName: string,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/companies', {
    token,
    selectedOrgId: organizationId,
    data: { displayName },
  })
  expect(response.status(), `Company fixture in ${organizationId} should be created`).toBe(201)
  const body = await readJsonSafe<{ id?: string; entityId?: string }>(response)
  return expectId(body?.entityId ?? body?.id, 'Company fixture id')
}

async function createRecordInOrganization(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  entityId: string,
): Promise<string> {
  const recordId = randomUUID()
  const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/entities/records', {
    token,
    selectedOrgId: organizationId,
    data: { entityId, recordId, values: {} },
  })
  expect(response.status(), `Record fixture in ${organizationId} should be created`).toBe(200)
  return recordId
}

async function getWithApiKey<T>(secret: string, path: string): Promise<{ status: number; body: T | null }> {
  return withCredentialIsolatedRequest(async (keyRequest) => {
    const response = await keyRequest.get(path, { headers: { 'x-api-key': secret } })
    return { status: response.status(), body: await readJsonSafe<T>(response) }
  })
}

test.describe('TC-APIKEY-009: an API key without an organization reads only the organizations its feature role covers', () => {
  test('audit-log actions and custom entity records stay inside organization A', async ({ request }) => {
    const operatorToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(operatorToken)
    const stamp = randomUUID()
    const startedAt = new Date(Date.now() - 1000).toISOString()
    const entityId = `qa_apikey_009_${stamp.replace(/-/g, '').slice(0, 12)}:record`
    let orgA: string | null = null
    let orgB: string | null = null
    let visibilityRoleId: string | null = null
    let featureRoleId: string | null = null
    let keyId: string | null = null
    let entityCreated = false
    const companies: Array<{ organizationId: string; id: string }> = []
    const records: Array<{ organizationId: string; id: string }> = []

    try {
      orgA = await createOrganizationFixture(request, operatorToken, { name: `QA APIKEY-009 A ${stamp}`, tenantId })
      orgB = await createOrganizationFixture(request, operatorToken, { name: `QA APIKEY-009 B ${stamp}`, tenantId })

      visibilityRoleId = await createRoleFixture(request, operatorToken, { name: `qa-apikey-009-visibility-${stamp}`, tenantId })
      await setRoleAclFeatures(request, operatorToken, {
        roleId: visibilityRoleId,
        features: ['dashboards.view'],
        organizations: null,
      })
      featureRoleId = await createRoleFixture(request, operatorToken, { name: `qa-apikey-009-feature-${stamp}`, tenantId })
      await setRoleAclFeatures(request, operatorToken, {
        roleId: featureRoleId,
        features: ['audit_logs.view_self', 'audit_logs.view_tenant', 'entities.records.view'],
        organizations: [orgA],
      })

      const companyA = await createCompanyInOrganization(request, operatorToken, orgA, `QA APIKEY-009 company A ${stamp}`)
      companies.push({ organizationId: orgA, id: companyA })
      const companyB = await createCompanyInOrganization(request, operatorToken, orgB, `QA APIKEY-009 company B ${stamp}`)
      companies.push({ organizationId: orgB, id: companyB })

      const entity = await apiRequest(request, 'POST', '/api/entities/entities', {
        token: operatorToken,
        data: { entityId, label: `QA APIKEY-009 ${stamp}` },
      })
      expect(entity.status()).toBe(200)
      entityCreated = true
      const recordA = await createRecordInOrganization(request, operatorToken, orgA, entityId)
      records.push({ organizationId: orgA, id: recordA })
      records.push({ organizationId: orgB, id: await createRecordInOrganization(request, operatorToken, orgB, entityId) })

      const created = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: operatorToken,
        data: { name: `QA APIKEY-009 ${stamp}`, organizationId: null, roles: [visibilityRoleId, featureRoleId] },
      })
      expect(created.status()).toBe(201)
      const createdBody = await readJsonSafe<{ id?: string; secret?: string; organizationId?: string | null }>(created)
      keyId = expectId(createdBody?.id, 'API key id')
      expect(createdBody?.organizationId ?? null).toBeNull()
      const secret = expectId(createdBody?.secret, 'API key secret')

      const operatorViewOfB = await apiRequest(
        request,
        'GET',
        `/api/audit_logs/audit-logs/actions?organizationId=${orgB}&after=${encodeURIComponent(startedAt)}&pageSize=200`,
        { token: operatorToken },
      )
      expect(operatorViewOfB.status()).toBe(200)
      const operatorItems = (await readJsonSafe<ActionsBody>(operatorViewOfB))?.items ?? []
      expect(operatorItems.some((item) => item.resourceId === companyB), 'Fixture must leave an organization B action log').toBe(true)

      for (const query of ['', `&organizationId=${orgB}`]) {
        const actions = await getWithApiKey<ActionsBody>(
          secret,
          `/api/audit_logs/audit-logs/actions?after=${encodeURIComponent(startedAt)}&pageSize=200${query}`,
        )
        expect(actions.status, `actions${query} should answer 200`).toBe(200)
        const items = actions.body?.items ?? []
        expect(items.filter((item) => item.organizationId !== orgA), `actions${query} must not leave organization A`).toEqual([])
        expect(items.some((item) => item.resourceId === companyB)).toBe(false)
        expect(items.some((item) => item.resourceId === companyA), `actions${query} should include organization A`).toBe(true)
      }

      const keyRecords = await getWithApiKey<RecordsBody>(
        secret,
        `/api/entities/records?entityId=${encodeURIComponent(entityId)}&page=1&pageSize=50&sortField=id&sortDir=asc`,
      )
      expect(keyRecords.status).toBe(200)
      const recordIds = (keyRecords.body?.items ?? []).map((item) => item.id)
      expect(recordIds).toEqual([recordA])
    } finally {
      if (keyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(keyId)}`, { token: operatorToken }).catch(() => undefined)
      }
      for (const record of records) {
        await apiRequestWithSelectedOrg(request, 'DELETE', '/api/entities/records', {
          token: operatorToken, selectedOrgId: record.organizationId, data: { entityId, recordId: record.id },
        }).catch(() => undefined)
      }
      for (const company of companies) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `/api/customers/companies?id=${encodeURIComponent(company.id)}`, {
          token: operatorToken, selectedOrgId: company.organizationId,
        }).catch(() => undefined)
      }
      if (entityCreated) {
        await apiRequest(request, 'DELETE', '/api/entities/entities', { token: operatorToken, data: { entityId } }).catch(() => undefined)
      }
      await deleteRoleIfExists(request, operatorToken, featureRoleId)
      await deleteRoleIfExists(request, operatorToken, visibilityRoleId)
      await deleteOrganizationIfExists(request, operatorToken, orgB)
      await deleteOrganizationIfExists(request, operatorToken, orgA)
    }
  })
})
