import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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

      const traceCapture = await apiRequest(request, 'PUT', TRACE_CAPTURE_SETTINGS_PATH, {
        token: restrictedAdmin.token,
        data: { level: 'off' },
      })
      expect(traceCapture.status(), await traceCapture.text()).toBe(403)

      const otelExport = await apiRequest(request, 'PUT', OTEL_EXPORT_SETTINGS_PATH, {
        token: restrictedAdmin.token,
        data: { enabled: true, content: 'none', exportUserIds: false },
      })
      expect(otelExport.status(), await otelExport.text()).toBe(403)
    } finally {
      await deleteScopedAgentUser(request, adminToken, restrictedAdmin).catch(() => undefined)
    }
  })
})
