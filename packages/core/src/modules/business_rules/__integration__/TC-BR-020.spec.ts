import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'

type StoredWindow = { effectiveFrom: string | null; effectiveTo: string | null }

async function readWindow(request: APIRequestContext, token: string, ruleId: string): Promise<StoredWindow> {
  const response = await apiRequest(request, 'GET', `/api/business_rules/rules/${encodeURIComponent(ruleId)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<StoredWindow>(response)
  return { effectiveFrom: body?.effectiveFrom ?? null, effectiveTo: body?.effectiveTo ?? null }
}

test.describe('TC-BR-020: Rule PUT checks the effective window against the stored dates', () => {
  test('a one-sided date patch cannot invert the stored window', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenContext(token)
    let ruleId: string | null = null

    try {
      ruleId = await createBusinessRuleFixture(request, token, {
        ruleId: `QA_WINDOW_${Date.now()}`,
        ruleName: 'QA Effective Window',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        conditionExpression: { field: 'status', operator: '=', value: 'open' },
        successActions: null,
        failureActions: null,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: '2026-02-01T00:00:00.000Z',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      const invertStart = await apiRequest(request, 'PUT', '/api/business_rules/rules', {
        token,
        data: { id: ruleId, effectiveFrom: '2026-03-01T00:00:00.000Z' },
      })
      expect(invertStart.status()).toBe(400)
      expect((await readJsonSafe<{ error?: string }>(invertStart))?.error).toContain('effectiveTo')

      const invertStartPolish = await apiRequest(request, 'PUT', '/api/business_rules/rules', {
        token,
        data: { id: ruleId, effectiveFrom: '2026-03-01T00:00:00.000Z' },
        headers: { 'Accept-Language': 'pl' },
      })
      expect(invertStartPolish.status()).toBe(400)
      expect((await readJsonSafe<{ error?: string }>(invertStartPolish))?.error).toBe(
        'Walidacja nie powiodła się: effectiveTo: Data „Obowiązuje Do” musi być późniejsza niż „Obowiązuje Od”',
      )

      const invertEnd = await apiRequest(request, 'PUT', '/api/business_rules/rules', {
        token,
        data: { id: ruleId, effectiveTo: '2025-12-01T00:00:00.000Z' },
      })
      expect(invertEnd.status()).toBe(400)

      expect(await readWindow(request, token, ruleId)).toEqual({
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: '2026-02-01T00:00:00.000Z',
      })

      const ordered = await apiRequest(request, 'PUT', '/api/business_rules/rules', {
        token,
        data: { id: ruleId, effectiveFrom: '2026-01-15T00:00:00.000Z' },
      })
      expect(ordered.status()).toBe(200)

      expect(await readWindow(request, token, ruleId)).toEqual({
        effectiveFrom: '2026-01-15T00:00:00.000Z',
        effectiveTo: '2026-02-01T00:00:00.000Z',
      })
    } finally {
      await deleteBusinessRuleIfExists(request, token, ruleId)
    }
  })
})
