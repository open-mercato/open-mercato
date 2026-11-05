import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-HEALTH-003: reading health is reviewer-grade, spending on it is not.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-08-14-system-health-verification-ux.md
 * (§3.3, Phase 2, Step 2.5). The whole endpoint used to sit behind
 * `proposals.view`, so putting a probe control on the Overview would have let
 * every proposal reviewer spend the tenant's Firecrawl and Tavily credits. The
 * billable mode now requires `agents.manage`; every read path stays where it was.
 *
 * Self-contained: creates its own role and user, deletes both in teardown.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

const HEALTH_URL = '/api/agent_orchestrator/web-search/health'
const REVIEWER_PASSWORD = 'Reviewer!2345'

test.describe('TC-AGENT-HEALTH-003: the billable probe needs agents.manage', () => {
  test('a reviewer reads health but cannot pay for it', async ({ request }) => {
    const adminToken = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const { organizationId, tenantId } = getTokenContext(adminToken)

    const suffix = `${process.pid}-${Number(process.hrtime.bigint() % 1_000_000n)}`
    const roleName = `tc-agent-health-003-reviewer-${suffix}`
    const email = `tc-agent-health-003-${suffix}@example.test`

    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId })
      // Exactly the reads the overview needs, and nothing that spends.
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['agent_orchestrator.proposals.view'],
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password: REVIEWER_PASSWORD,
        organizationId,
        roles: [roleName],
        name: 'TC-AGENT-HEALTH-003 reviewer',
      })

      const reviewerToken = await getAuthToken(request, email, REVIEWER_PASSWORD)

      const readiness = await apiRequest(request, 'GET', HEALTH_URL, { token: reviewerToken })
      expect(readiness.status(), await readiness.text()).toBe(200)

      const auto = await apiRequest(request, 'GET', `${HEALTH_URL}?probe=auto`, { token: reviewerToken })
      expect(auto.status(), 'a reviewer must keep seeing verified free adapters').toBe(200)

      const live = await apiRequest(request, 'GET', `${HEALTH_URL}?probe=1`, { token: reviewerToken })
      expect(live.status(), 'a reviewer must not be able to spend a search credit').toBe(403)
      const liveBody = await readJsonSafe<{ error?: string }>(live)
      expect(liveBody?.error).toContain('agents.manage')

      const targeted = await apiRequest(
        request,
        'GET',
        `${HEALTH_URL}?probe=1&force=1&adapter=firecrawl`,
        { token: reviewerToken },
      )
      expect(targeted.status(), 'the per-adapter test is the same gate').toBe(403)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
