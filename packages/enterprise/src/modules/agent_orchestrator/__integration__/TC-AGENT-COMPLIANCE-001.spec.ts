import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

type ModelUsageResponse = {
  items?: Array<{
    providerId?: string
    modelId?: string
    dataLocation?: string
    retentionPolicy?: string
    runCount?: number
  }>
}

test.describe('TC-AGENT-COMPLIANCE-001: tenant model usage export', () => {
  test('requires authentication and exports the scoped registry as JSON and CSV', async ({ request }) => {
    const anonymous = await request.get('/api/agent_orchestrator/model-usage')
    expect(anonymous.status()).toBe(401)

    const token = await getAuthToken(request, 'admin@acme.com', 'secret')
    const context = getTokenContext(token)
    expect(context.tenantId).toBeTruthy()
    expect(context.organizationId).toBeTruthy()
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const restrictedEmail = `qa-agent-compliance-${stamp}@example.com`
    let restrictedRoleId: string | null = null
    let restrictedUserId: string | null = null

    try {
      restrictedRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-agent-compliance-${stamp}`,
        tenantId: context.tenantId!,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: restrictedRoleId,
        features: ['agent_orchestrator.agents.view'],
        organizations: null,
      })
      restrictedUserId = await createUserFixture(request, superadminToken, {
        email: restrictedEmail,
        password: 'StrongSecret123!',
        organizationId: context.organizationId!,
        roles: [restrictedRoleId],
        name: 'QA model usage restricted reader',
      })
      const restrictedToken = await getAuthToken(request, restrictedEmail, 'StrongSecret123!')
      const forbidden = await apiRequest(request, 'GET', '/api/agent_orchestrator/model-usage', {
        token: restrictedToken,
      })
      expect(forbidden.status(), 'model-use export requires trace.view').toBe(403)

      const jsonResponse = await apiRequest(request, 'GET', '/api/agent_orchestrator/model-usage', { token })
      expect(jsonResponse.status(), await jsonResponse.text()).toBe(200)
      const body = await readJsonSafe<ModelUsageResponse>(jsonResponse)
      expect(Array.isArray(body?.items)).toBe(true)
      for (const item of body?.items ?? []) {
        expect(typeof item.providerId).toBe('string')
        expect(typeof item.modelId).toBe('string')
        expect(typeof item.dataLocation).toBe('string')
        expect(typeof item.retentionPolicy).toBe('string')
        expect(typeof item.runCount).toBe('number')
      }

      const csvResponse = await apiRequest(
        request,
        'GET',
        '/api/agent_orchestrator/model-usage?format=csv',
        { token },
      )
      expect(csvResponse.status(), await csvResponse.text()).toBe(200)
      expect(csvResponse.headers()['content-type']).toContain('text/csv')
      expect(csvResponse.headers()['content-disposition']).toContain('open-mercato-ai-model-usage.csv')
      expect(await csvResponse.text()).toContain('providerId,modelId,dataLocation,retentionPolicy')
    } finally {
      if (restrictedUserId) await deleteUserIfExists(request, superadminToken, restrictedUserId)
      if (restrictedRoleId) await deleteRoleIfExists(request, superadminToken, restrictedRoleId)
    }
  })
})
