import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-HEALTH-002: opening a page never spends a search credit.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-08-14-system-health-verification-ux.md
 * (§3.1/§3.3, Phase 2). `probe=auto` is what the overview tile calls on mount.
 * It may verify adapters whose health check is free — that is how the tile turns
 * green without an operator — and it may NEVER initiate a call that bills or
 * spawns a process.
 *
 * The guarantee is asserted on the response rather than on a network counter,
 * because `probed: true` is precisely the server's claim that it made the call.
 *
 * Read-only: no fixtures, nothing to clean up.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

const HEALTH_URL = '/api/agent_orchestrator/web-search/health'

type HealthRow = {
  id?: string
  ready?: boolean
  probed?: boolean
  probeCost?: string
  checkedAt?: string | null
}

type HealthBody = { adapters?: HealthRow[]; probed?: boolean }

test.describe('TC-AGENT-HEALTH-002: probe=auto verifies only what is free', () => {
  test('no heavy or billable adapter is called on a page view', async ({ request }) => {
    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)

    const response = await apiRequest(request, 'GET', `${HEALTH_URL}?probe=auto`, { token })
    expect(response.status(), await response.text()).toBe(200)

    const body = await readJsonSafe<HealthBody>(response)
    const rows = body?.adapters ?? []
    expect(rows.length, 'the installed adapter set must not be empty').toBeGreaterThan(0)

    for (const row of rows) {
      if (row.probed) {
        expect(row.probeCost, `${row.id} was called, so its probe must be free`).toBe('free')
        expect(typeof row.checkedAt, `${row.id} was called, so it must carry a timestamp`).toBe('string')
      }
      if (row.probeCost !== 'free') {
        expect(row.probed, `${row.id} costs to probe and must not be called unattended`).toBe(false)
      }
    }
  })

  test('a configured free adapter with a health check comes back verified', async ({ request }) => {
    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)

    const response = await apiRequest(request, 'GET', `${HEALTH_URL}?probe=auto`, { token })
    const body = await readJsonSafe<HealthBody>(response)
    const rows = body?.adapters ?? []

    // `model-native` is the one adapter that is free to probe AND implements a
    // health check, so it is the deterministic witness that entry really
    // verifies rather than merely relabelling. Adapters with no health check
    // (serp-html) legitimately stay unprobed — there is nothing to call.
    const modelNative = rows.find((row) => row.id === 'model-native')
    test.skip(!modelNative?.ready, 'model-native is not configured in this environment')

    expect(modelNative?.probeCost).toBe('free')
    expect(modelNative?.probed, 'entry must verify the free adapter, not just report it').toBe(true)
    expect(typeof modelNative?.checkedAt).toBe('string')
  })
})
