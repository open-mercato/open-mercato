import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  deleteRoleIfExists,
  setRoleAclFeatures,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteBusinessRuleIfExists } from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  buildBusinessRulePayload,
  cleanupBusinessRulesUser,
  createBusinessRulesUser,
  type ExecutionRuleEntry,
} from './helpers/businessRulesApi'

const API_KEYS_PATH = '/api/api_keys/keys'
const RULES_PATH = '/api/business_rules/rules'
const OPTIONS_PATH = '/api/business_rules/openmercato-call-options'
const PROFILE_ENDPOINT = '/api/customers/people'
const PROFILE_FEATURE = 'customers.people.view'
const CONFIGURATOR_FEATURES = [
  'business_rules.view',
  'business_rules.manage',
  'api_keys.view',
  'api_keys.create',
]

test.describe('TC-BR-015: CALL_OPEN_MERCATO is limited to API key roles the rule author can grant', () => {
  test('save, options, update and execution enforce the author grant ceiling', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    expect(organizationId, 'admin token should carry an organization').toBeTruthy()
    const stamp = Date.now()
    const entityType = `QaCallOpenMercatoCeiling${stamp}`
    const ruleKey = `TC_BR_015_${stamp}`

    let profileRoleId: string | null = null
    let apiKeyId: string | null = null
    let ruleId: string | null = null
    let restricted: { token: string; roleId: string; userId: string } | null = null
    let grantor: { token: string; roleId: string; userId: string } | null = null

    const executeRule = async () => {
      const response = await apiRequest(request, 'POST', '/api/business_rules/execute', {
        token: adminToken,
        data: {
          entityType,
          eventType: 'beforeSave',
          entityId: crypto.randomUUID(),
          data: { status: 'ACTIVE' },
        },
      })
      expect(response.status(), `rule execution failed: ${response.status()}`).toBe(200)
      const body = await readJsonSafe<{ executedRules?: ExecutionRuleEntry[] }>(response)
      return body?.executedRules?.find((item) => item.ruleId === ruleKey) ?? null
    }

    try {
      profileRoleId = await createRoleFixture(request, adminToken, {
        name: `QA TC-BR-015 profile ${stamp}`,
        tenantId: tenantId || undefined,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId: profileRoleId,
        features: [PROFILE_FEATURE],
        organizations: organizationId ? [organizationId] : null,
      })
      const apiKeyResponse = await apiRequest(request, 'POST', API_KEYS_PATH, {
        token: adminToken,
        data: {
          name: `QA TC-BR-015 profile key ${stamp}`,
          roles: [profileRoleId],
          organizationId,
        },
      })
      expect(apiKeyResponse.status(), 'create api key profile').toBe(201)
      apiKeyId = expectId((await readJsonSafe<{ id?: string }>(apiKeyResponse))?.id, 'api key id')

      restricted = await createBusinessRulesUser(request, adminToken, {
        email: `qa-tc-br-015-restricted-${stamp}@example.com`,
        organizationId: organizationId as string,
        features: CONFIGURATOR_FEATURES,
        roleName: `QA TC-BR-015 restricted ${stamp}`,
      })
      grantor = await createBusinessRulesUser(request, adminToken, {
        email: `qa-tc-br-015-grantor-${stamp}@example.com`,
        organizationId: organizationId as string,
        features: [...CONFIGURATOR_FEATURES, PROFILE_FEATURE],
        roleName: `QA TC-BR-015 grantor ${stamp}`,
      })

      const action = {
        type: 'CALL_OPEN_MERCATO',
        config: { endpoint: PROFILE_ENDPOINT, method: 'GET', apiKeyId },
      }
      const rulePayload = buildBusinessRulePayload(stamp, {
        ruleId: ruleKey,
        ruleType: 'ACTION',
        entityType,
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: [action],
      })

      const restrictedOptions = await apiRequest(request, 'GET', OPTIONS_PATH, { token: restricted.token })
      expect(restrictedOptions.status()).toBe(200)
      const restrictedKeys = (await readJsonSafe<{ apiKeys?: Array<{ id?: string }> }>(restrictedOptions))?.apiKeys ?? []
      expect(restrictedKeys.map((key) => key.id), 'restricted author must not be offered the profile').not.toContain(apiKeyId)

      const restrictedCreate = await apiRequest(request, 'POST', RULES_PATH, { token: restricted.token, data: rulePayload })
      const restrictedCreateBody = await readJsonSafe<{ id?: string; error?: string }>(restrictedCreate)
      if (restrictedCreateBody?.id) ruleId = restrictedCreateBody.id
      expect(restrictedCreate.status(), 'restricted author must not save the profile').toBe(400)
      expect(restrictedCreateBody?.error).toContain('roles you cannot grant')

      const grantorOptions = await apiRequest(request, 'GET', OPTIONS_PATH, { token: grantor.token })
      const grantorKeys = (await readJsonSafe<{ apiKeys?: Array<{ id?: string }> }>(grantorOptions))?.apiKeys ?? []
      expect(grantorKeys.map((key) => key.id), 'grantor is offered the profile').toContain(apiKeyId)

      const grantorCreate = await apiRequest(request, 'POST', RULES_PATH, { token: grantor.token, data: rulePayload })
      expect(grantorCreate.status(), 'grantor saves the rule').toBe(201)
      ruleId = expectId((await readJsonSafe<{ id?: string }>(grantorCreate))?.id, 'rule id')

      const allowedEntry = await executeRule()
      expect(allowedEntry?.actionsExecuted?.results).toEqual([{ type: 'CALL_OPEN_MERCATO', success: true }])

      const restrictedConditionEdit = await apiRequest(request, 'PUT', RULES_PATH, {
        token: restricted.token,
        data: { id: ruleId, conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' } },
      })
      expect(restrictedConditionEdit.status(), 'restricted author must not retarget the stored privileged action').toBe(400)
      expect((await readJsonSafe<{ error?: string }>(restrictedConditionEdit))?.error).toContain('roles you cannot grant')

      const restrictedDisable = await apiRequest(request, 'PUT', RULES_PATH, {
        token: restricted.token,
        data: { id: ruleId, enabled: false },
      })
      expect(restrictedDisable.status(), 'restricted author may still disable the rule').toBe(200)

      const grantorEnable = await apiRequest(request, 'PUT', RULES_PATH, {
        token: grantor.token,
        data: { id: ruleId, enabled: true },
      })
      expect(grantorEnable.status(), 'grantor re-enables the rule').toBe(200)

      await setUserAclVisibility(request, adminToken, {
        userId: grantor.userId,
        features: CONFIGURATOR_FEATURES,
        organizations: null,
      })

      const refusedEntry = await executeRule()
      expect(refusedEntry?.conditionResult).toBe(true)
      expect(refusedEntry?.actionsExecuted?.results?.[0]?.type).toBe('CALL_OPEN_MERCATO')
      expect(refusedEntry?.actionsExecuted?.results?.[0]?.success, 'author lost the grant: the call must fail closed').toBe(false)
    } finally {
      await deleteBusinessRuleIfExists(request, adminToken, ruleId)
      if (apiKeyId) {
        await apiRequest(request, 'DELETE', `${API_KEYS_PATH}?id=${encodeURIComponent(apiKeyId)}`, { token: adminToken }).catch(() => undefined)
      }
      await cleanupBusinessRulesUser(request, adminToken, restricted?.userId ?? null, restricted?.roleId ?? null)
      await cleanupBusinessRulesUser(request, adminToken, grantor?.userId ?? null, grantor?.roleId ?? null)
      await deleteRoleIfExists(request, adminToken, profileRoleId)
    }
  })
})
