import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createRuleSetFixture,
  deleteRuleSetIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/businessRulesFixtures'

test.describe('TC-BR-001: Rule set CRUD APIs', () => {
  test('should create, list, update, and soft-delete a rule set', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const setId = `qa-ruleset-${Date.now()}`
    let ruleSetId: string | null = null

    try {
      ruleSetId = await createRuleSetFixture(request, token, {
        setId,
        setName: 'QA Rule Set',
        description: 'Phase 2 API coverage',
        enabled: true,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/sets?setId=${encodeURIComponent(setId)}`,
        { token },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      expect(listBody?.items?.some((item) => item.id === ruleSetId && item.setId === setId)).toBe(true)

      const updateResponse = await apiRequest(request, 'PUT', '/api/business_rules/sets', {
        token,
        data: {
          id: ruleSetId,
          setName: 'QA Rule Set Updated',
          enabled: false,
        },
      })
      expect(updateResponse.status()).toBe(200)

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/sets/${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      const detailBody = await readJsonSafe<{ setName?: string; enabled?: boolean }>(detailResponse)
      expect(detailResponse.status()).toBe(200)
      expect(detailBody?.setName).toBe('QA Rule Set Updated')
      expect(detailBody?.enabled).toBe(false)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/business_rules/sets?id=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      expect(deleteResponse.status()).toBe(200)
      ruleSetId = null

      const afterDeleteResponse = await apiRequest(
        request,
        'GET',
        `/api/business_rules/sets?setId=${encodeURIComponent(setId)}`,
        { token },
      )
      const afterDeleteBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(afterDeleteResponse)
      expect(afterDeleteBody?.items?.some((item) => item.setId === setId)).toBe(false)
    } finally {
      await deleteRuleSetIfExists(request, token, ruleSetId)
    }
  })
})
