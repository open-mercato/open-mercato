import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/businessRulesFixtures'

test.describe('TC-BR-004: Rule execution and logs APIs', () => {
  test('should execute rules by context and by id, then expose execution logs', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    let ruleId: string | null = null

    try {
      ruleId = await createBusinessRuleFixture(request, token, {
        ruleId: `QA_EXEC_${Date.now()}`,
        ruleName: 'QA Execute Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: null,
        failureActions: null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      const executeResponse = await apiRequest(request, 'POST', '/api/business_rules/execute', {
        token,
        data: {
          entityType: 'WorkOrder',
          eventType: 'beforeSave',
          entityId: '00000000-0000-4000-8000-000000000101',
          data: { status: 'ACTIVE' },
        },
      })
      expect(executeResponse.status()).toBe(200)
      const executeBody = await readJsonSafe<{
        allowed?: boolean
        executedRules?: Array<{ ruleId?: string; logId?: string }>
      }>(executeResponse)
      expect(executeBody?.allowed).toBe(true)
      expect(executeBody?.executedRules?.some((entry) => typeof entry.ruleId === 'string')).toBe(true)

      const directExecuteResponse = await apiRequest(
        request,
        'POST',
        `/api/business_rules/execute/${encodeURIComponent(ruleId)}`,
        {
          token,
          data: {
            entityType: 'WorkOrder',
            eventType: 'beforeSave',
            entityId: '00000000-0000-4000-8000-000000000102',
            data: { status: 'ACTIVE' },
          },
        },
      )
      expect(directExecuteResponse.status()).toBe(200)
      const directExecuteBody = await readJsonSafe<{ success?: boolean; logId?: string }>(directExecuteResponse)
      expect(directExecuteBody?.success).toBe(true)
      expect(typeof directExecuteBody?.logId).toBe('string')

      const logsResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/logs?ruleId=${encodeURIComponent(ruleId)}`,
        { token },
      )
      expect(logsResponse.status()).toBe(200)
      const logsBody = await readJsonSafe<{
        items?: Array<{ id: string; ruleId: string; entityType: string }>
      }>(logsResponse)
      expect((logsBody?.items?.length ?? 0) >= 1).toBe(true)
      expect(logsBody?.items?.some((item) => item.ruleId === ruleId)).toBe(true)

      const logId = logsBody?.items?.[0]?.id
      expect(typeof logId).toBe('string')

      const logDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/logs/${encodeURIComponent(logId ?? '')}`,
        { token },
      )
      expect(logDetailResponse.status()).toBe(200)
      const logDetailBody = await readJsonSafe<{
        id?: string
        rule?: { id?: string; entityType?: string }
        entityType?: string
      }>(logDetailResponse)
      expect(logDetailBody?.id).toBe(logId)
      expect(logDetailBody?.rule?.id).toBe(ruleId)
      expect(logDetailBody?.entityType).toBe('WorkOrder')
    } finally {
      await deleteBusinessRuleIfExists(request, token, ruleId)
    }
  })
})
