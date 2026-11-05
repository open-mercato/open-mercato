import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  BUSINESS_RULES_TEST_PASSWORD,
  buildBusinessRulePayload,
  cleanupBusinessRulesUser,
  createBusinessRulesUser,
  expectForbidden,
} from './helpers/businessRulesApi'

test.describe('TC-BR-005: RBAC enforcement for business_rules.manage', () => {
  test('denies rule create, update, and delete to a user without business_rules.manage', async ({ request }) => {
    const stamp = Date.now()
    const userEmail = `tc-br-005-view-${stamp}@example.com`

    let adminToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
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
        roleName: `TC-BR-005 View Only ${stamp}`,
      })
      roleId = limitedUser.roleId
      userId = limitedUser.userId

      const deniedCreate = await apiRequest(request, 'POST', '/api/business_rules/rules', {
        token: limitedUser.token,
        data: buildBusinessRulePayload(`TC_BR_005_DENIED_${stamp}`),
      })
      await expectForbidden(deniedCreate, 'business_rules.manage', 'POST /rules without manage must be forbidden')

      ruleId = await createBusinessRuleFixture(
        request,
        adminToken,
        buildBusinessRulePayload(`TC_BR_005_ALLOWED_${stamp}`, {
          ruleName: 'TC-BR-005 Allowed Rule',
        }),
      )

      const deniedUpdate = await apiRequest(request, 'PUT', '/api/business_rules/rules', {
        token: limitedUser.token,
        data: {
          id: ruleId,
          ruleName: 'TC-BR-005 Unauthorized Update',
        },
      })
      await expectForbidden(deniedUpdate, 'business_rules.manage', 'PUT /rules without manage must be forbidden')

      const deniedDelete = await apiRequest(
        request,
        'DELETE',
        `/api/business_rules/rules?id=${encodeURIComponent(ruleId)}`,
        { token: limitedUser.token },
      )
      await expectForbidden(deniedDelete, 'business_rules.manage', 'DELETE /rules without manage must be forbidden')
    } finally {
      await deleteBusinessRuleIfExists(request, adminToken, ruleId)
      await cleanupBusinessRulesUser(request, adminToken, userId, roleId)
    }
  })
})
