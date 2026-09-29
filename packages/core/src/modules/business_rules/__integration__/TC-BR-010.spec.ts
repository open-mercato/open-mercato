import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, deleteRoleIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  buildBusinessRulePayload,
  type ExecutionRuleEntry,
} from './helpers/businessRulesApi'

const API_KEYS_PATH = '/api/api_keys/keys'
const RULES_PATH = '/api/business_rules/rules'

test.describe('TC-BR-010: CALL_OPEN_MERCATO action config and execution', () => {
  test('persists and executes a Call OpenMercato action without webhook url validation', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(token)
    const stamp = Date.now()
    const entityId = crypto.randomUUID()
    const entityType = `QaCallOpenMercatoEntity${stamp}`
    const ruleKey = `TC_BR_010_${stamp}`

    let roleId: string | null = null
    let apiKeyId: string | null = null
    let ruleId: string | null = null

    try {
      roleId = await createRoleFixture(request, token, {
        name: `QA BR OpenMercato Caller ${stamp}`,
        tenantId: tenantId || undefined,
      })
      await setRoleAclFeatures(request, token, {
        roleId,
        features: ['business_rules.view'],
        organizations: organizationId ? [organizationId] : null,
      })

      const apiKeyResponse = await apiRequest(request, 'POST', API_KEYS_PATH, {
        token,
        data: {
          name: `QA BR OpenMercato Profile ${stamp}`,
          description: 'Temporary profile for CALL_OPEN_MERCATO integration coverage',
          roles: [roleId],
          organizationId,
        },
      })
      expect(apiKeyResponse.status(), `create api key failed: ${apiKeyResponse.status()}`).toBe(201)
      const apiKeyBody = await readJsonSafe<{ id?: string }>(apiKeyResponse)
      apiKeyId = expectId(apiKeyBody?.id, 'api key profile creation should return id')

      const optionsResponse = await apiRequest(request, 'GET', '/api/business_rules/openmercato-call-options', { token })
      expect(optionsResponse.status(), 'OpenMercato options should load').toBe(200)
      const optionsBody = await readJsonSafe<{ endpoints?: Array<{ id?: string }>; apiKeys?: Array<{ id?: string }> }>(optionsResponse)
      expect(optionsBody?.endpoints?.map((endpoint) => endpoint.id)).toContain('GET /api/business_rules/rules')
      expect(optionsBody?.apiKeys?.map((apiKey) => apiKey.id)).toContain(apiKeyId)

      const action = {
        type: 'CALL_OPEN_MERCATO',
        config: {
          endpoint: RULES_PATH,
          method: 'GET',
          apiKeyId,
        },
      }

      ruleId = await createBusinessRuleFixture(
        request,
        token,
        buildBusinessRulePayload(stamp, {
          ruleId: ruleKey,
          ruleType: 'ACTION',
          entityType,
          conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
          successActions: [action],
        }),
      )

      const detailResponse = await apiRequest(request, 'GET', `${RULES_PATH}/${encodeURIComponent(ruleId)}`, { token })
      expect(detailResponse.status(), 'created rule detail should load').toBe(200)
      const detail = await readJsonSafe<{ successActions?: unknown[] }>(detailResponse)
      expect(detail?.successActions).toEqual([action])

      const executeResponse = await apiRequest(request, 'POST', '/api/business_rules/execute', {
        token,
        data: {
          entityType,
          eventType: 'beforeSave',
          entityId,
          data: { status: 'ACTIVE' },
        },
      })
      expect(executeResponse.status(), `rule execution failed: ${executeResponse.status()}`).toBe(200)
      const executeBody = await readJsonSafe<{ executedRules?: ExecutionRuleEntry[] }>(executeResponse)
      const entry = executeBody?.executedRules?.find((item) => item.ruleId === ruleKey)
      expect(entry?.conditionResult).toBe(true)
      expect(entry?.actionsExecuted?.success).toBe(true)
      expect(entry?.actionsExecuted?.results).toEqual([
        { type: 'CALL_OPEN_MERCATO', success: true },
      ])
    } finally {
      await deleteBusinessRuleIfExists(request, token, ruleId)
      if (apiKeyId) {
        await apiRequest(request, 'DELETE', `${API_KEYS_PATH}?id=${encodeURIComponent(apiKeyId)}`, { token }).catch(() => undefined)
      }
      await deleteRoleIfExists(request, token, roleId)
    }
  })
})
