import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-HEALTH-001: the default mode still reports configuration only.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-08-14-system-health-verification-ux.md
 * (§3.3, Phase 2). `probe=auto` and the probe cache were added underneath this
 * endpoint; the mode every existing caller uses — the web-search settings page's
 * initial load — must keep meaning "configured", never "verified", so a plain
 * GET may not report a single row as probed.
 *
 * Read-only: no fixtures, nothing to clean up.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

const HEALTH_URL = '/api/agent_orchestrator/web-search/health'

type HealthRow = {
  id?: string
  enabled?: boolean
  ready?: boolean
  ok?: boolean
  probed?: boolean
  probeCost?: string
  checkedAt?: string | null
}

type HealthBody = {
  status?: string
  source?: string
  adapters?: HealthRow[]
  problems?: unknown[]
  probed?: boolean
  checkedAt?: string
}

test.describe('TC-AGENT-HEALTH-001: readiness mode claims nothing it did not call', () => {
  test('a plain GET reports configuration only', async ({ request }) => {
    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)

    const response = await apiRequest(request, 'GET', HEALTH_URL, { token })
    expect(response.status(), await response.text()).toBe(200)

    const body = await readJsonSafe<HealthBody>(response)
    expect(body?.status).toMatch(/^(ok|degraded|not_configured)$/)
    expect(body?.source).toMatch(/^(tenant|instance)$/)
    expect(Array.isArray(body?.adapters)).toBe(true)
    expect(Array.isArray(body?.problems)).toBe(true)
    expect(typeof body?.checkedAt).toBe('string')

    // The contract that matters: nothing was called, and every row says so.
    expect(body?.probed).toBe(false)
    for (const row of body?.adapters ?? []) {
      expect(row.probed, `${row.id} must not be reported as probed`).toBe(false)
      expect(row.checkedAt, `${row.id} must carry no probe timestamp`).toBeNull()
      // The new field is what lets a caller know why a row went unchecked.
      expect(row.probeCost, `${row.id} must declare a probe cost`).toMatch(/^(free|heavy|billable)$/)
    }
  })

  test('rejects an unauthenticated caller', async ({ request }) => {
    // Deliberately raw: the shared helper always attaches a token, and the point
    // here is what happens without one.
    const response = await request.get(HEALTH_URL)
    expect([401, 403]).toContain(response.status())
  })
})
