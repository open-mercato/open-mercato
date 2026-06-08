import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  BUSINESS_RULES_TEST_PASSWORD,
  buildBusinessRulePayload,
  createOrganizationInTenant,
  createTenantFixture,
  scopeCookie,
  setRoleAclFeaturesForTenant,
  type ExecutionRuleEntry,
} from './helpers/businessRulesApi'

test.describe('TC-BR-010: Tenant and organization scoping', () => {
  test('does not expose or execute a rule outside the selected tenant or organization', async ({ request }) => {
    const stamp = Date.now()
    const orgCUserEmail = `tc-br-010-org-c-${stamp}@example.com`
    const tenantBUserEmail = `tc-br-010-tenant-b-${stamp}@example.com`
    const ruleKey = `TC_BR_010_A_${stamp}`

    let adminToken: string | null = null
    let superadminToken: string | null = null
    let orgCToken: string | null = null
    let tenantBToken: string | null = null
    let organizationCId: string | null = null
    let roleCId: string | null = null
    let userCId: string | null = null
    let tenantBId: string | null = null
    let organizationBId: string | null = null
    let roleBId: string | null = null
    let userBId: string | null = null
    let ruleAId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      superadminToken = await getAuthToken(request, 'superadmin')
      const adminScope = getTokenScope(adminToken)
      const superScope = getTokenScope(superadminToken)
      expect(adminScope.tenantId, 'admin token should carry tenant A').toBeTruthy()
      expect(adminScope.organizationId, 'admin token should carry organization A').toBeTruthy()

      const ruleARecordId = await createBusinessRuleFixture(
        request,
        adminToken,
        buildBusinessRulePayload(stamp, {
          ruleId: ruleKey,
          ruleName: 'TC-BR-010 Tenant A Rule',
          entityType: `QaTenantScopeEntity${stamp}`,
        }),
      )
      ruleAId = ruleARecordId

      const expectRuleHiddenFrom = async (token: string, label: string) => {
        const listResponse = await apiRequest(
          request,
          'GET',
          `/api/business_rules/rules?ruleId=${encodeURIComponent(ruleKey)}`,
          { token },
        )
        expect(listResponse.status(), `${label} rule list should succeed`).toBe(200)
        const listBody = await readJsonSafe<{ items?: Array<{ id?: string; ruleId?: string }> }>(listResponse)
        expect(listBody?.items?.some((item) => item.id === ruleARecordId || item.ruleId === ruleKey)).toBe(false)

        const detailResponse = await apiRequest(
          request,
          'GET',
          `/api/business_rules/rules/${encodeURIComponent(ruleARecordId)}`,
          { token },
        )
        expect(detailResponse.status(), `${label} must not read tenant A organization A rule detail`).toBe(404)

        const updateResponse = await apiRequest(request, 'PUT', '/api/business_rules/rules', {
          token,
          data: {
            id: ruleARecordId,
            ruleName: `TC-BR-010 Unauthorized ${label} Update`,
          },
        })
        expect(updateResponse.status(), `${label} must not update tenant A organization A rule`).toBe(404)

        const executeResponse = await apiRequest(request, 'POST', '/api/business_rules/execute', {
          token,
          data: {
            entityType: `QaTenantScopeEntity${stamp}`,
            eventType: 'beforeSave',
            entityId: crypto.randomUUID(),
            data: { status: 'ACTIVE' },
          },
        })
        expect(executeResponse.status(), `${label} execute request should stay scoped`).toBe(200)
        const executeBody = await readJsonSafe<{ executedRules?: ExecutionRuleEntry[] }>(executeResponse)
        expect(executeBody?.executedRules?.some((entry) => entry.ruleId === ruleKey)).toBe(false)
      }

      organizationCId = await createOrganizationInTenant(
        request,
        superadminToken,
        scopeCookie(adminScope.tenantId, adminScope.organizationId || null),
        adminScope.tenantId,
        `TC-BR-010 Org C ${stamp}`,
      )
      roleCId = await createRoleFixture(request, superadminToken, {
        name: `TC-BR-010 Org C Role ${stamp}`,
        tenantId: adminScope.tenantId,
      })
      await setRoleAclFeaturesForTenant(request, superadminToken, {
        roleId: roleCId,
        tenantId: adminScope.tenantId,
        features: ['business_rules.*'],
        organizations: null,
      })
      userCId = await createUserFixture(request, superadminToken, {
        email: orgCUserEmail,
        password: BUSINESS_RULES_TEST_PASSWORD,
        organizationId: organizationCId,
        roles: [roleCId],
      })
      orgCToken = await getAuthToken(request, orgCUserEmail, BUSINESS_RULES_TEST_PASSWORD)
      const orgCScope = getTokenScope(orgCToken)
      expect(orgCScope.tenantId, 'organization C user token should stay in tenant A').toBe(adminScope.tenantId)
      expect(orgCScope.organizationId, 'organization C user token should be scoped to organization C').toBe(
        organizationCId,
      )
      await expectRuleHiddenFrom(orgCToken, 'same-tenant organization C')

      tenantBId = await createTenantFixture(request, superadminToken, `TC-BR-010 Tenant B ${stamp}`)
      organizationBId = await createOrganizationInTenant(
        request,
        superadminToken,
        scopeCookie(superScope.tenantId, superScope.organizationId || null),
        tenantBId,
        `TC-BR-010 Org B ${stamp}`,
      )
      roleBId = await createRoleFixture(request, superadminToken, {
        name: `TC-BR-010 Tenant B Role ${stamp}`,
        tenantId: tenantBId,
      })
      await setRoleAclFeaturesForTenant(request, superadminToken, {
        roleId: roleBId,
        tenantId: tenantBId,
        features: ['business_rules.*'],
        organizations: null,
      })
      userBId = await createUserFixture(request, superadminToken, {
        email: tenantBUserEmail,
        password: BUSINESS_RULES_TEST_PASSWORD,
        organizationId: organizationBId,
        roles: [roleBId],
      })
      tenantBToken = await getAuthToken(request, tenantBUserEmail, BUSINESS_RULES_TEST_PASSWORD)
      const tenantBScope = getTokenScope(tenantBToken)
      expect(tenantBScope.tenantId, 'tenant B user token should be scoped to tenant B').toBe(tenantBId)
      expect(tenantBScope.organizationId, 'tenant B user token should be scoped to organization B').toBe(organizationBId)
      await expectRuleHiddenFrom(tenantBToken, 'tenant B')
    } finally {
      await deleteBusinessRuleIfExists(request, adminToken, ruleAId)
      await deleteUserAclInDb(userCId ?? '').catch(() => undefined)
      await deleteUserIfExists(request, superadminToken, userCId)
      await deleteRoleIfExists(request, superadminToken, roleCId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/organizations', organizationCId)
      await deleteUserAclInDb(userBId ?? '').catch(() => undefined)
      await deleteUserIfExists(request, superadminToken, userBId)
      await deleteRoleIfExists(request, superadminToken, roleBId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/organizations', organizationBId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantBId)
    }
  })
})
