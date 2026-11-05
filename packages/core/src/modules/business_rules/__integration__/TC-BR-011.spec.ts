import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import { buildBusinessRulePayload, listRuleLogs } from './helpers/businessRulesApi'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test.describe('TC-BR-011: Execution log filtering', () => {
  test('filters logs by date range and execution result', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const entityType = `QaLogFilterEntity${stamp}`
    const successEntityId = crypto.randomUUID()
    const failureEntityId = crypto.randomUUID()
    let ruleId: string | null = null

    try {
      ruleId = await createBusinessRuleFixture(
        request,
        token,
        buildBusinessRulePayload(`TC_BR_011_${stamp}`, {
          entityType,
          conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        }),
      )

      const successResponse = await apiRequest(request, 'POST', '/api/business_rules/execute', {
        token,
        data: {
          entityType,
          eventType: 'beforeSave',
          entityId: successEntityId,
          data: { status: 'ACTIVE' },
        },
      })
      expect(successResponse.status(), 'successful execution should return 200').toBe(200)

      await sleep(50)
      const afterFirstExecution = new Date().toISOString()
      await sleep(50)

      const failureResponse = await apiRequest(request, 'POST', '/api/business_rules/execute', {
        token,
        data: {
          entityType,
          eventType: 'beforeSave',
          entityId: failureEntityId,
          data: { status: 'INACTIVE' },
        },
      })
      expect(failureResponse.status(), 'failed condition execution should return 200').toBe(200)

      const allLogs = await listRuleLogs(request, token, `?ruleId=${encodeURIComponent(ruleId)}&pageSize=10`)
      expect(allLogs.status, 'unfiltered rule log query should return 200').toBe(200)
      expect(allLogs.items.map((item) => item.entityId)).toEqual(
        expect.arrayContaining([successEntityId, failureEntityId]),
      )

      const successLogs = await listRuleLogs(
        request,
        token,
        `?ruleId=${encodeURIComponent(ruleId)}&executionResult=SUCCESS&pageSize=10`,
      )
      expect(successLogs.items.length, 'SUCCESS filter should include at least one success log').toBeGreaterThan(0)
      expect(successLogs.items.every((item) => item.executionResult === 'SUCCESS')).toBe(true)
      expect(successLogs.items.map((item) => item.entityId)).toContain(successEntityId)

      const dateRangeLogs = await listRuleLogs(
        request,
        token,
        `?ruleId=${encodeURIComponent(ruleId)}&executedAtFrom=${encodeURIComponent(afterFirstExecution)}&pageSize=10`,
      )
      expect(dateRangeLogs.items.map((item) => item.entityId)).toContain(failureEntityId)
      expect(dateRangeLogs.items.map((item) => item.entityId)).not.toContain(successEntityId)

      const combinedLogs = await listRuleLogs(
        request,
        token,
        `?ruleId=${encodeURIComponent(ruleId)}&executedAtFrom=${encodeURIComponent(afterFirstExecution)}&executionResult=FAILURE&pageSize=10`,
      )
      expect(combinedLogs.items).toHaveLength(1)
      expect(combinedLogs.items[0]?.entityId).toBe(failureEntityId)
      expect(combinedLogs.items[0]?.executionResult).toBe('FAILURE')
    } finally {
      await deleteBusinessRuleIfExists(request, token, ruleId)
    }
  })
})
