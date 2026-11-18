import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'

async function executeRule(
  request: APIRequestContext,
  token: string,
  ruleId: string,
  data: Record<string, unknown>,
): Promise<boolean | undefined> {
  const response = await apiRequest(request, 'POST', `/api/business_rules/execute/${encodeURIComponent(ruleId)}`, {
    token,
    data: {
      entityType: 'WorkOrder',
      eventType: 'beforeSave',
      entityId: '00000000-0000-4000-8000-000000000191',
      data,
      dryRun: true,
    },
  })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ conditionResult?: boolean }>(response)
  return body?.conditionResult
}

test.describe('TC-BR-019: Blank field values are not compared as numeric 0', () => {
  test('equality and ordering conditions against 0 do not match a blank field', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenContext(token)
    const stamp = Date.now()
    const ruleIds: string[] = []

    try {
      const equalsRuleId = await createBusinessRuleFixture(request, token, {
        ruleId: `QA_BLANK_EQ_${stamp}`,
        ruleName: 'QA Blank Equals Zero',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        conditionExpression: { field: 'discountPercent', operator: '=', value: 0 },
        successActions: null,
        failureActions: null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      ruleIds.push(equalsRuleId)

      const orderingRuleId = await createBusinessRuleFixture(request, token, {
        ruleId: `QA_BLANK_GTE_${stamp}`,
        ruleName: 'QA Blank Greater Or Equal Zero',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        conditionExpression: { field: 'quantity', operator: '>=', value: 0 },
        successActions: null,
        failureActions: null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      ruleIds.push(orderingRuleId)

      expect(await executeRule(request, token, equalsRuleId, { discountPercent: '' })).toBe(false)
      expect(await executeRule(request, token, equalsRuleId, { discountPercent: 0 })).toBe(true)
      expect(await executeRule(request, token, orderingRuleId, { quantity: '' })).toBe(false)
      expect(await executeRule(request, token, orderingRuleId, { quantity: 0 })).toBe(true)
    } finally {
      for (const ruleId of ruleIds) {
        await deleteBusinessRuleIfExists(request, token, ruleId)
      }
    }
  })
})
