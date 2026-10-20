import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr'],
}

const STATEMENTS_PATH = '/api/eudr/statements'
const RISK_PATH = '/api/eudr/risk-assessments'
const ALL_ORGANIZATIONS = '__all__'

type RiskListResponse = {
  items?: Array<{
    criteria?: Record<string, { note?: string | null }>
  }>
}

async function createStatement(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  title: string,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', STATEMENTS_PATH, {
    token,
    selectedOrgId: organizationId,
    data: { title, commodity: 'coffee', actorRole: 'operator' },
  })
  expect(response.status(), `statement fixture failed: ${response.status()}`).toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'statement fixture id')
}

async function createRiskAssessment(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  statementId: string,
  marker: string,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', RISK_PATH, {
    token,
    selectedOrgId: organizationId,
    data: {
      statementId,
      criteria: { land_title_permits: { answer: 'no_concern', note: marker } },
      conclusion: 'negligible',
    },
  })
  expect(response.status(), `risk fixture failed: ${response.status()}`).toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'risk fixture id')
}

async function deleteScopedRecord(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  path: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await apiRequestWithSelectedOrg(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, {
    token,
    selectedOrgId: organizationId,
  }).catch(() => undefined)
}

function containsMarker(body: RiskListResponse | null, marker: string): boolean {
  return (body?.items ?? []).some((item) => (
    Object.values(item.criteria ?? {}).some((criterion) => criterion.note === marker)
  ))
}

test.describe('TC-EUDR-018: all-organization feature scope', () => {
  test('never exposes risk assessments from organizations lacking eudr.risk.view', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId: homeOrganizationId, tenantId } = getTokenContext(superadminToken)
    const stamp = randomUUID().slice(0, 8)
    const password = 'StrongSecret123!'
    const scopedEmail = `qa-eudr-018-scoped-${stamp}@example.com`
    const noRiskEmail = `qa-eudr-018-none-${stamp}@example.com`
    const homeMarker = `TC-EUDR-018-HOME-${stamp}`
    const victimMarker = `TC-EUDR-018-VICTIM-${stamp}`
    let victimOrganizationId: string | null = null
    let statementsRoleId: string | null = null
    let riskRoleId: string | null = null
    let scopedUserId: string | null = null
    let noRiskUserId: string | null = null
    let homeStatementId: string | null = null
    let victimStatementId: string | null = null
    let homeRiskId: string | null = null
    let victimRiskId: string | null = null

    try {
      victimOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-EUDR-018 Victim ${stamp}`,
        tenantId,
      })
      statementsRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-eudr-018-statements-${stamp}`,
        tenantId,
      })
      riskRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-eudr-018-risk-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: statementsRoleId,
        features: ['eudr.statements.view'],
        organizations: null,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: riskRoleId,
        features: ['eudr.risk.view'],
        organizations: [homeOrganizationId],
      })
      scopedUserId = await createUserFixture(request, superadminToken, {
        email: scopedEmail,
        password,
        organizationId: homeOrganizationId,
        roles: [statementsRoleId, riskRoleId],
        name: 'QA TC-EUDR-018 Scoped',
      })
      noRiskUserId = await createUserFixture(request, superadminToken, {
        email: noRiskEmail,
        password,
        organizationId: homeOrganizationId,
        roles: [statementsRoleId],
        name: 'QA TC-EUDR-018 No Risk',
      })

      homeStatementId = await createStatement(
        request,
        superadminToken,
        homeOrganizationId,
        `TC-EUDR-018 Home ${stamp}`,
      )
      victimStatementId = await createStatement(
        request,
        superadminToken,
        victimOrganizationId,
        `TC-EUDR-018 Victim ${stamp}`,
      )
      homeRiskId = await createRiskAssessment(
        request,
        superadminToken,
        homeOrganizationId,
        homeStatementId,
        homeMarker,
      )
      victimRiskId = await createRiskAssessment(
        request,
        superadminToken,
        victimOrganizationId,
        victimStatementId,
        victimMarker,
      )

      const scopedToken = await getAuthToken(request, scopedEmail, password)
      const homeResponse = await apiRequestWithSelectedOrg(request, 'GET', `${RISK_PATH}?pageSize=100`, {
        token: scopedToken,
        selectedOrgId: homeOrganizationId,
      })
      expect(homeResponse.status(), 'explicit authorized organization should succeed').toBe(200)
      expect(containsMarker(await readJsonSafe<RiskListResponse>(homeResponse), homeMarker)).toBe(true)

      const victimResponse = await apiRequestWithSelectedOrg(request, 'GET', `${RISK_PATH}?pageSize=100`, {
        token: scopedToken,
        selectedOrgId: victimOrganizationId,
      })
      expect(victimResponse.status(), 'explicit unauthorized organization should be rejected').toBe(403)

      const allResponse = await apiRequestWithSelectedOrg(request, 'GET', `${RISK_PATH}?pageSize=100`, {
        token: scopedToken,
        selectedOrgId: ALL_ORGANIZATIONS,
      })
      expect(allResponse.status(), 'all-organizations request should retain authorized records').toBe(200)
      const allBody = await readJsonSafe<RiskListResponse>(allResponse)
      expect(containsMarker(allBody, homeMarker), 'authorized organization marker should remain visible').toBe(true)
      expect(containsMarker(allBody, victimMarker), 'victim organization marker must not cross the feature boundary').toBe(false)

      const noRiskToken = await getAuthToken(request, noRiskEmail, password)
      const emptyScopeResponse = await apiRequestWithSelectedOrg(request, 'GET', `${RISK_PATH}?pageSize=100`, {
        token: noRiskToken,
        selectedOrgId: ALL_ORGANIZATIONS,
      })
      expect(emptyScopeResponse.status(), 'an empty authorized organization set must fail closed').toBe(403)

      await setRoleAclFeatures(request, superadminToken, {
        roleId: statementsRoleId,
        features: ['eudr.statements.view', 'eudr.risk.view'],
        organizations: null,
      })
      const globalResponse = await apiRequestWithSelectedOrg(request, 'GET', `${RISK_PATH}?pageSize=100`, {
        token: noRiskToken,
        selectedOrgId: ALL_ORGANIZATIONS,
      })
      expect(globalResponse.status(), 'a legitimate global feature grant should remain tenant-wide').toBe(200)
      const globalBody = await readJsonSafe<RiskListResponse>(globalResponse)
      expect(containsMarker(globalBody, homeMarker)).toBe(true)
      expect(containsMarker(globalBody, victimMarker)).toBe(true)
    } finally {
      if (victimOrganizationId) {
        await deleteScopedRecord(request, superadminToken, victimOrganizationId, RISK_PATH, victimRiskId)
        await deleteScopedRecord(request, superadminToken, victimOrganizationId, STATEMENTS_PATH, victimStatementId)
      }
      await deleteScopedRecord(request, superadminToken, homeOrganizationId, RISK_PATH, homeRiskId)
      await deleteScopedRecord(request, superadminToken, homeOrganizationId, STATEMENTS_PATH, homeStatementId)
      await deleteUserIfExists(request, superadminToken, noRiskUserId)
      await deleteUserIfExists(request, superadminToken, scopedUserId)
      await deleteRoleIfExists(request, superadminToken, riskRoleId)
      await deleteRoleIfExists(request, superadminToken, statementsRoleId)
      await deleteOrganizationIfExists(request, superadminToken, victimOrganizationId)
    }
  })
})
