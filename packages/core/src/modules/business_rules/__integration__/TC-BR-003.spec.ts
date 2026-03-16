import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createBusinessRuleFixture,
  createRuleSetFixture,
  deleteBusinessRuleIfExists,
  deleteRuleSetIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/businessRulesFixtures'

test.describe('TC-BR-003: Rule set membership ordering APIs', () => {
  test('should add, reorder, update, and remove rule set members', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const suffix = Date.now()
    let ruleSetId: string | null = null
    let firstRuleId: string | null = null
    let secondRuleId: string | null = null

    try {
      ruleSetId = await createRuleSetFixture(request, token, {
        setId: `qa-members-${suffix}`,
        setName: 'QA Members Set',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      firstRuleId = await createBusinessRuleFixture(request, token, {
        ruleId: `QA_MEMBER_A_${suffix}`,
        ruleName: 'Rule A',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: null,
        failureActions: null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      secondRuleId = await createBusinessRuleFixture(request, token, {
        ruleId: `QA_MEMBER_B_${suffix}`,
        ruleName: 'Rule B',
        ruleType: 'VALIDATION',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'quantity', operator: '>', value: 0 },
        successActions: null,
        failureActions: null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      const addFirstResponse = await apiRequest(
        request,
        'POST',
        `/api/business_rules/sets/${encodeURIComponent(ruleSetId)}/members`,
        {
          token,
          data: { ruleId: firstRuleId, sequence: 20, enabled: true },
        },
      )
      const addFirstBody = await readJsonSafe<{ id?: string }>(addFirstResponse)
      expect(addFirstResponse.status()).toBe(201)

      const addSecondResponse = await apiRequest(
        request,
        'POST',
        `/api/business_rules/sets/${encodeURIComponent(ruleSetId)}/members`,
        {
          token,
          data: { ruleId: secondRuleId, sequence: 10, enabled: true },
        },
      )
      const addSecondBody = await readJsonSafe<{ id?: string }>(addSecondResponse)
      expect(addSecondResponse.status()).toBe(201)

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/sets/${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      const detailBody = await readJsonSafe<{
        members?: Array<{ id: string; ruleId: string; sequence: number; enabled: boolean }>
      }>(detailResponse)
      expect(detailResponse.status()).toBe(200)
      expect(detailBody?.members?.map((member) => member.ruleId)).toEqual([secondRuleId, firstRuleId])

      const updateSecondResponse = await apiRequest(
        request,
        'PUT',
        `/api/business_rules/sets/${encodeURIComponent(ruleSetId)}/members`,
        {
          token,
          data: {
            memberId: addSecondBody?.id,
            sequence: 30,
            enabled: false,
          },
        },
      )
      expect(updateSecondResponse.status()).toBe(200)

      const updatedDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/sets/${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      const updatedDetailBody = await readJsonSafe<{
        members?: Array<{ id: string; ruleId: string; sequence: number; enabled: boolean }>
      }>(updatedDetailResponse)
      expect(updatedDetailBody?.members?.map((member) => member.ruleId)).toEqual([firstRuleId, secondRuleId])
      expect(updatedDetailBody?.members?.find((member) => member.id === addSecondBody?.id)?.enabled).toBe(false)

      const deleteFirstResponse = await apiRequest(
        request,
        'DELETE',
        `/api/business_rules/sets/${encodeURIComponent(ruleSetId)}/members?memberId=${encodeURIComponent(addFirstBody?.id ?? '')}`,
        { token },
      )
      expect(deleteFirstResponse.status()).toBe(200)

      const finalDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/sets/${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      const finalDetailBody = await readJsonSafe<{
        members?: Array<{ id: string; ruleId: string }>
      }>(finalDetailResponse)
      expect(finalDetailBody?.members).toHaveLength(1)
      expect(finalDetailBody?.members?.[0]?.id).toBe(addSecondBody?.id)
    } finally {
      await deleteBusinessRuleIfExists(request, token, firstRuleId)
      await deleteBusinessRuleIfExists(request, token, secondRuleId)
      await deleteRuleSetIfExists(request, token, ruleSetId)
    }
  })
})
