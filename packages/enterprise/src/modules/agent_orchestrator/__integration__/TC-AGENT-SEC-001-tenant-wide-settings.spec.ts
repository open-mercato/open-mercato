import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createScopedAgentUser, deleteScopedAgentUser, type ScopedAgentUser } from './helpers/agentAccessFixtures'

const TRACE_CAPTURE_SETTINGS_PATH = '/api/agent_orchestrator/trace-capture/settings'
const OTEL_EXPORT_SETTINGS_PATH = '/api/agent_orchestrator/otel-export/settings'
const WRITE_FEATURES = [
  'agent_orchestrator.agents.manage',
  'agent_orchestrator.trace.view',
  'agent_orchestrator.trace.view_content',
]

test.describe('TC-AGENT-SEC-001: tenant-wide agent settings authorization', () => {
  async function expectSettingsDenied(request: APIRequestContext, token: string) {
    const traceCapture = await apiRequest(request, 'PUT', TRACE_CAPTURE_SETTINGS_PATH, {
      token,
      data: { level: 'off' },
    })
    expect(traceCapture.status(), await traceCapture.text()).toBe(403)

    const otelExport = await apiRequest(request, 'PUT', OTEL_EXPORT_SETTINGS_PATH, {
      token,
      data: { enabled: true, content: 'none', exportUserIds: false },
    })
    expect(otelExport.status(), await otelExport.text()).toBe(403)
  }

  test('an organization-restricted admin cannot change trace capture or OTel export settings', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenScope(adminToken)
    test.skip(!organizationId, 'the integration admin has no selected organization for a scoped role fixture')

    let restrictedAdmin: ScopedAgentUser | null = null
    try {
      restrictedAdmin = await createScopedAgentUser(request, adminToken, {
        label: 'tenant-wide-settings',
        features: WRITE_FEATURES,
        organizations: [organizationId!],
      })
      await expectSettingsDenied(request, restrictedAdmin.token)
    } finally {
      await deleteScopedAgentUser(request, adminToken, restrictedAdmin).catch(() => undefined)
    }
  })

  test('uses the exact feature scope when merged roles include unrelated unrestricted visibility', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    test.skip(!organizationId, 'the integration admin has no selected organization for a scoped role fixture')
    const roleIds: string[] = []
    let userId: string | null = null
    const email = `it-tenant-settings-mixed-${Date.now()}@example.com`
    try {
      const scopedRole = await createRoleFixture(request, adminToken, {
        name: `tenant-settings-scoped-write-${Date.now()}`,
        tenantId,
      })
      roleIds.push(scopedRole)
      await setRoleAclFeatures(request, adminToken, {
        roleId: scopedRole,
        features: WRITE_FEATURES,
        organizations: [organizationId!],
      })

      const visibilityRole = await createRoleFixture(request, adminToken, {
        name: `tenant-settings-unrelated-visibility-${Date.now()}`,
        tenantId,
      })
      roleIds.push(visibilityRole)
      await setRoleAclFeatures(request, adminToken, {
        roleId: visibilityRole,
        features: ['agent_orchestrator.agents.view'],
        organizations: null,
      })

      userId = await createUserFixture(request, adminToken, {
        email,
        password: 'AgentAccess!2345',
        organizationId: organizationId!,
        roles: roleIds,
      })
      const token = await getAuthToken(request, email, 'AgentAccess!2345')
      await expectSettingsDenied(request, token)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('does not treat an organization-scoped super-admin role as tenant-wide', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    test.skip(!organizationId, 'the integration super-admin has no selected organization for a scoped role fixture')
    let roleId: string | null = null
    let userId: string | null = null
    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `tenant-settings-scoped-superadmin-${Date.now()}`,
        tenantId,
      })
      const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: {
          roleId,
          isSuperAdmin: true,
          features: WRITE_FEATURES,
          organizations: [organizationId!],
        },
      })
      expect(aclResponse.status(), await aclResponse.text()).toBe(200)

      const email = `it-tenant-settings-scoped-superadmin-${Date.now()}@example.com`
      userId = await createUserFixture(request, adminToken, {
        email,
        password: 'AgentAccess!2345',
        organizationId: organizationId!,
        roles: [roleId],
      })
      const token = await getAuthToken(request, email, 'AgentAccess!2345')
      await expectSettingsDenied(request, token)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
