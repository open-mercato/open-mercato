import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  createRuleSetFixture,
  deleteBusinessRuleIfExists,
  deleteRuleSetIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  BUSINESS_RULES_TEST_PASSWORD,
  buildBusinessRulePayload,
  cleanupBusinessRulesUser,
  createBusinessRulesUser,
  expectForbidden,
} from './helpers/businessRulesApi'

test.describe('TC-BR-006: RBAC enforcement for business_rules.manage_sets', () => {
  test('denies rule set CRUD and member mutation to a user without business_rules.manage_sets', async ({ request }) => {
    const stamp = Date.now()
    const userEmail = `tc-br-006-view-${stamp}@example.com`

    let adminToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let ruleSetId: string | null = null
    let ruleId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { organizationId } = getTokenScope(adminToken)
      expect(organizationId, 'admin token should carry an organization id').toBeTruthy()

      const limitedUser = await createBusinessRulesUser(request, adminToken, {
        email: userEmail,
        password: BUSINESS_RULES_TEST_PASSWORD,
        organizationId,
        features: ['business_rules.view'],
        roleName: `TC-BR-006 View Only ${stamp}`,
      })
      roleId = limitedUser.roleId
      userId = limitedUser.userId

      const deniedCreate = await apiRequest(request, 'POST', '/api/business_rules/sets', {
        token: limitedUser.token,
        data: {
          setId: `qa-br-006-denied-${stamp}`,
          setName: 'TC-BR-006 Denied Set',
        },
      })
      await expectForbidden(deniedCreate, 'business_rules.manage_sets', 'POST /sets without manage_sets must be forbidden')

      ruleSetId = await createRuleSetFixture(request, adminToken, {
        setId: `qa-br-006-set-${stamp}`,
        setName: 'TC-BR-006 Fixture Set',
      })
      ruleId = await createBusinessRuleFixture(
        request,
        adminToken,
        buildBusinessRulePayload(`TC_BR_006_RULE_${stamp}`),
      )

      const deniedUpdate = await apiRequest(request, 'PUT', '/api/business_rules/sets', {
        token: limitedUser.token,
        data: {
          id: ruleSetId,
          setName: 'TC-BR-006 Unauthorized Update',
        },
      })
      await expectForbidden(deniedUpdate, 'business_rules.manage_sets', 'PUT /sets without manage_sets must be forbidden')

      const deniedDelete = await apiRequest(
        request,
        'DELETE',
        `/api/business_rules/sets?id=${encodeURIComponent(ruleSetId)}`,
        { token: limitedUser.token },
      )
      await expectForbidden(deniedDelete, 'business_rules.manage_sets', 'DELETE /sets without manage_sets must be forbidden')

      const deniedMemberCreate = await apiRequest(
        request,
        'POST',
        `/api/business_rules/sets/${encodeURIComponent(ruleSetId)}/members`,
        {
          token: limitedUser.token,
          data: {
            ruleId,
            sequence: 10,
            enabled: true,
          },
        },
      )
      await expectForbidden(
        deniedMemberCreate,
        'business_rules.manage_sets',
        'POST /sets/[id]/members without manage_sets must be forbidden',
      )
    } finally {
      await deleteBusinessRuleIfExists(request, adminToken, ruleId)
      await deleteRuleSetIfExists(request, adminToken, ruleSetId)
      await cleanupBusinessRulesUser(request, adminToken, userId, roleId)
    }
  })
})
