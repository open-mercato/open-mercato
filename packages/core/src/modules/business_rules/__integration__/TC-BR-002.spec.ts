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

test.describe('TC-BR-002: Business rule CRUD APIs', () => {
  test('should create, list, update, and soft-delete a business rule', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const ruleKey = `QA_RULE_${Date.now()}`
    let ruleId: string | null = null

    try {
      ruleId = await createBusinessRuleFixture(request, token, {
        ruleId: ruleKey,
        ruleName: 'QA Rule',
        description: 'Phase 2 business rule coverage',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        conditionExpression: {
          field: 'status',
          operator: '=',
          value: 'ACTIVE',
        },
        successActions: null,
        failureActions: null,
        enabled: true,
        priority: 100,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/rules?ruleId=${encodeURIComponent(ruleKey)}`,
        { token },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      expect(listBody?.items?.some((item) => item.id === ruleId && item.ruleId === ruleKey)).toBe(true)

      const updateResponse = await apiRequest(request, 'PUT', '/api/business_rules/rules', {
        token,
        data: {
          id: ruleId,
          ruleName: 'QA Rule Updated',
          priority: 10,
          enabled: false,
        },
      })
      expect(updateResponse.status()).toBe(200)

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/rules/${encodeURIComponent(ruleId)}`,
        { token },
      )
      const detailBody = await readJsonSafe<{
        ruleName?: string
        priority?: number
        enabled?: boolean
      }>(detailResponse)
      expect(detailResponse.status()).toBe(200)
      expect(detailBody?.ruleName).toBe('QA Rule Updated')
      expect(detailBody?.priority).toBe(10)
      expect(detailBody?.enabled).toBe(false)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/business_rules/rules?id=${encodeURIComponent(ruleId)}`,
        { token },
      )
      expect(deleteResponse.status()).toBe(200)
      ruleId = null

      const afterDeleteResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/rules?ruleId=${encodeURIComponent(ruleKey)}`,
        { token },
      )
      const afterDeleteBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(afterDeleteResponse)
      expect(afterDeleteBody?.items?.some((item) => item.ruleId === ruleKey)).toBe(false)
    } finally {
      await deleteBusinessRuleIfExists(request, token, ruleId)
    }
  })
})
