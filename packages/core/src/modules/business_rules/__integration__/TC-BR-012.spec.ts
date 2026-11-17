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
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildBusinessRulePayload, expectForbidden } from './helpers/businessRulesApi'

const RULES_PATH = '/api/business_rules/rules'
const ALL_ORGANIZATIONS = '__all__'

type RuleListResponse = {
  items?: Array<{ id?: string; ruleId?: string }>
}

async function findRuleInOrganization(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  ruleCode: string,
): Promise<string | null> {
  const response = await apiRequestWithSelectedOrg(
    request,
    'GET',
    `${RULES_PATH}?ruleId=${encodeURIComponent(ruleCode)}&pageSize=10`,
    { token, selectedOrgId: organizationId },
  )
  expect(response.status(), 'rule lookup in the home organization should succeed').toBe(200)
  const body = await readJsonSafe<RuleListResponse>(response)
  return body?.items?.find((item) => item.ruleId === ruleCode)?.id ?? null
}

test.describe('TC-BR-012: all-organization feature gate keeps the home organization', () => {
  test('rejects an all-organization write when business_rules.manage is granted only outside the home organization', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId: homeOrganizationId, tenantId } = getTokenContext(superadminToken)
    const stamp = randomUUID().slice(0, 8)
    const password = 'StrongSecret123!'
    const email = `qa-br-012-split-${stamp}@example.com`
    const ruleCode = `TC_BR_012_${stamp}`
    let featureOrganizationId: string | null = null
    let viewRoleId: string | null = null
    let manageRoleId: string | null = null
    let userId: string | null = null
    let leakedRuleId: string | null = null

    try {
      featureOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-BR-012 Feature ${stamp}`,
        tenantId,
      })
      viewRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-br-012-view-${stamp}`,
        tenantId,
      })
      manageRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-br-012-manage-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: viewRoleId,
        features: ['business_rules.view'],
        organizations: null,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: manageRoleId,
        features: ['business_rules.view', 'business_rules.manage'],
        organizations: [featureOrganizationId],
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: homeOrganizationId,
        roles: [viewRoleId, manageRoleId],
        name: 'QA TC-BR-012 Split Grant',
      })

      const userToken = await getAuthToken(request, email, password)
      const readResponse = await apiRequestWithSelectedOrg(request, 'GET', `${RULES_PATH}?pageSize=10`, {
        token: userToken,
        selectedOrgId: ALL_ORGANIZATIONS,
      })
      expect(readResponse.status(), 'a tenant-wide view grant should keep all-organization reads working').toBe(200)

      const writeResponse = await apiRequestWithSelectedOrg(request, 'POST', RULES_PATH, {
        token: userToken,
        selectedOrgId: ALL_ORGANIZATIONS,
        data: buildBusinessRulePayload(ruleCode, { ruleId: ruleCode }),
      })
      if (writeResponse.status() === 201) {
        leakedRuleId = (await readJsonSafe<{ id?: string }>(writeResponse))?.id ?? null
      }
      await expectForbidden(
        writeResponse,
        'business_rules.manage',
        'an all-organization write must not borrow a grant held only outside the home organization',
      )

      leakedRuleId = await findRuleInOrganization(request, superadminToken, homeOrganizationId, ruleCode)
      expect(leakedRuleId, 'the rejected write must not create a rule in the home organization').toBeNull()
    } finally {
      if (leakedRuleId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `${RULES_PATH}?id=${encodeURIComponent(leakedRuleId)}`, {
          token: superadminToken,
          selectedOrgId: homeOrganizationId,
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, manageRoleId)
      await deleteRoleIfExists(request, superadminToken, viewRoleId)
      await deleteOrganizationIfExists(request, superadminToken, featureOrganizationId)
    }
  })
})
