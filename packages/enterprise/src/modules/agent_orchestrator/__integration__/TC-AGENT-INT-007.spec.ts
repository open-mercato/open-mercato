import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  POLICY_CHECK_AGENT_ID,
  RULE_LESS_AGENT_ID,
  deleteSeededIntegrityRuns,
  seedReviewHoldRun,
  seedRuleLessRun,
  type SeededRun,
} from './helpers/integrityFixtures'

/**
 * TC-AGENT-INT-007: runs that asked for a human through `abstain_or_review` reach the Traces "needs review" facet (B-7).
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md (Changelog 2026-11-16).
 *
 * No model needed:
 *   - `GET /runs?filter=needs-review` returns a run whose only signal is an
 *     `abstain_or_review` warn check (no eval failure, no confidence);
 *   - a run without such a check stays out of the facet;
 *   - a review-hold run seeded under another organization is not returned;
 *   - `/backend/traces?agent=<id>&facet=needs-review` (the notification link)
 *     opens with the facet selected and requests the filtered list.
 *
 * Documented gap: no registered example agent declares `abstain_or_review`
 * with `route: 'review'`, so the notification itself (emit → subscriber →
 * bell) cannot be driven end to end without a model; the subscriber unit test
 * `run-review-requested-notification.test.ts` covers recipients and scoping.
 *
 * Fixtures: runs and check rows are seeded through dbFixtures and removed in `finally`.
 */

const integrationDirectory = path.dirname(fileURLToPath(import.meta.url))
const englishMessages = JSON.parse(
  readFileSync(path.join(integrationDirectory, '../i18n/en.json'), 'utf8'),
) as Record<string, string>

type RunListBody = { items?: Array<{ id?: string }> }

function needsReviewPath(agentId: string): string {
  const params = new URLSearchParams({ filter: 'needs-review', agentId, window: '24h', pageSize: '100' })
  return `/api/agent_orchestrator/runs?${params.toString()}`
}

async function listIds(request: Parameters<typeof apiRequest>[0], token: string, agentId: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', needsReviewPath(agentId), { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<RunListBody>(response)
  return (body?.items ?? []).map((item) => String(item.id))
}

test.describe('TC-AGENT-INT-007: needs-review facet includes integrity review requests', () => {
  test('the runs list facet returns review-hold runs of the caller organization only', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    expect(tenantId, 'the admin token carries a tenant').toBeTruthy()
    expect(organizationId, 'the admin token carries an organization').toBeTruthy()

    const seeds: SeededRun[] = []
    try {
      const held = await seedReviewHoldRun({ tenantId, organizationId })
      seeds.push(held)
      const ruleLess = await seedRuleLessRun({ tenantId, organizationId })
      seeds.push(ruleLess)
      const foreign = await seedReviewHoldRun({ tenantId, organizationId: randomUUID() })
      seeds.push(foreign)

      const policyIds = await listIds(request, token, POLICY_CHECK_AGENT_ID)
      expect(policyIds).toContain(held.runId)
      expect(policyIds, 'another organization run is not listed').not.toContain(foreign.runId)

      const ruleLessIds = await listIds(request, token, RULE_LESS_AGENT_ID)
      expect(ruleLessIds, 'a run without a review request stays out of the facet').not.toContain(ruleLess.runId)
    } finally {
      await deleteSeededIntegrityRuns(seeds).catch(() => undefined)
    }
  })

  test('the notification deep link opens Traces filtered to the agent and the needs-review facet', async ({
    page,
    request,
  }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)

    const seeds: SeededRun[] = []
    try {
      const held = await seedReviewHoldRun({ tenantId, organizationId })
      seeds.push(held)

      await login(page, 'admin')
      const filteredList = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return (
          url.pathname === '/api/agent_orchestrator/runs' &&
          url.searchParams.get('filter') === 'needs-review' &&
          url.searchParams.get('agentId') === POLICY_CHECK_AGENT_ID &&
          url.searchParams.get('pageSize') !== '1'
        )
      })
      const params = new URLSearchParams({ agent: POLICY_CHECK_AGENT_ID, facet: 'needs-review' })
      await page.goto(`/backend/traces?${params.toString()}`, { waitUntil: 'domcontentloaded' })

      const response = await filteredList
      expect(response.status()).toBe(200)
      const body = (await response.json()) as RunListBody
      expect((body.items ?? []).map((item) => item.id)).toContain(held.runId)

      const needsReviewTab = page.getByRole('tab', { name: new RegExp(englishMessages['agent_orchestrator.traces.facet.needsReview']) })
      await expect(needsReviewTab).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })

      await test.info().attach('traces-needs-review-deep-link', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    } finally {
      await deleteSeededIntegrityRuns(seeds).catch(() => undefined)
    }
  })
})
