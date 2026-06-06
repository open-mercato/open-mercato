import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import { buildBusinessRulePayload } from './helpers/businessRulesApi'

async function expectBadRequest(response: Awaited<ReturnType<typeof apiRequest>>, expectedText: string) {
  expect(response.status(), `request should fail validation with ${expectedText}`).toBe(400)
  const body = await readJsonSafe<{ error?: string }>(response)
  expect(body?.error ?? '').toContain(expectedText)
}

test.describe('TC-BR-007: Condition and action validation', () => {
  test('rejects malformed conditions and actions, then accepts a valid payload', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let validRuleId: string | null = null

    try {
      const invalidConditionResponse = await apiRequest(request, 'POST', '/api/business_rules/rules', {
        token,
        data: buildBusinessRulePayload(`TC_BR_007_BAD_CONDITION_${stamp}`, {
          conditionExpression: { operator: 'AND', rules: [] },
        }),
      })
      await expectBadRequest(invalidConditionResponse, 'condition expression')

      const invalidActionResponse = await apiRequest(request, 'POST', '/api/business_rules/rules', {
        token,
        data: buildBusinessRulePayload(`TC_BR_007_BAD_ACTION_${stamp}`, {
          ruleType: 'ACTION',
          successActions: [{ config: { message: 'Missing type' } }],
        }),
      })
      await expectBadRequest(invalidActionResponse, 'successActions')

      const unsafeConditionResponse = await apiRequest(request, 'POST', '/api/business_rules/rules', {
        token,
        data: buildBusinessRulePayload(`TC_BR_007_UNSAFE_${stamp}`, {
          conditionExpression: {
            field: `status.${'nested'.repeat(40)}`,
            operator: '=',
            value: 'ACTIVE',
          },
        }),
      })
      await expectBadRequest(unsafeConditionResponse, 'safety limits')

      validRuleId = await createBusinessRuleFixture(
        request,
        token,
        buildBusinessRulePayload(`TC_BR_007_VALID_${stamp}`, {
          ruleType: 'ACTION',
          successActions: [{ type: 'LOG', config: { message: 'TC-BR-007 valid action' } }],
        }),
      )
      expect(validRuleId, 'valid rule creation should return an id').toBeTruthy()
    } finally {
      await deleteBusinessRuleIfExists(request, token, validRuleId)
    }
  })
})
