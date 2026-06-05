import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  buildBusinessRulePayload,
  type ExecutionRuleEntry,
  listRuleLogs,
} from './helpers/businessRulesApi'

test.describe('TC-BR-009: Failure conditions and failureActions', () => {
  test('executes failureActions and records a FAILURE log when the condition is false', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const entityId = crypto.randomUUID()
    const entityType = `QaFailureEntity${stamp}`
    const ruleKey = `TC_BR_009_${stamp}`
    let ruleId: string | null = null

    try {
      ruleId = await createBusinessRuleFixture(
        request,
        token,
        buildBusinessRulePayload(stamp, {
          ruleId: ruleKey,
          ruleType: 'ACTION',
          entityType,
          conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
          failureActions: [
            {
              type: 'LOG',
              config: { level: 'warn', message: 'TC-BR-009 failure action executed' },
            },
          ],
        }),
      )

      const executeResponse = await apiRequest(request, 'POST', '/api/business_rules/execute', {
        token,
        data: {
          entityType,
          eventType: 'beforeSave',
          entityId,
          data: { status: 'INACTIVE' },
        },
      })
      expect(executeResponse.status(), 'execution with false condition should still return 200').toBe(200)
      const executeBody = await readJsonSafe<{ executedRules?: ExecutionRuleEntry[] }>(executeResponse)
      const entry = executeBody?.executedRules?.find((item) => item.ruleId === ruleKey)
      expect(entry?.conditionResult).toBe(false)
      expect(entry?.actionsExecuted?.success).toBe(true)
      expect(entry?.actionsExecuted?.results?.map((result) => result.type)).toContain('LOG')

      const logs = await listRuleLogs(
        request,
        token,
        `?ruleId=${encodeURIComponent(ruleId)}&entityId=${encodeURIComponent(entityId)}&executionResult=FAILURE`,
      )
      expect(logs.status, 'failure log query should succeed').toBe(200)
      expect(logs.items, 'a failed condition should create one FAILURE log for this entity').toHaveLength(1)
      expect(logs.items[0]?.executionResult).toBe('FAILURE')
      expect(logs.items[0]?.outputContext?.conditionResult).toBe(false)
      expect(logs.items[0]?.outputContext?.actionsExecuted?.map((action) => action.type)).toContain('LOG')
    } finally {
      await deleteBusinessRuleIfExists(request, token, ruleId)
    }
  })
})
