import { randomInt, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { firstRegisteredAgentId, loginAs } from './helpers/evalReportFixtures'
import {
  deleteRegressionFixtures,
  emptyFixtureIds,
  insertEvalCase,
  insertSuiteRun,
  type RegressionScope,
} from './helpers/evalRegressionFixtures'

/**
 * TC-AGENT-EVAL-REGRESSION-001: regression dashboard API and compare page.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-11-17-eval-regression-dashboard.md
 * (API Contracts, UI/UX, Testing Strategy).
 *
 * Two completed suite runs of one agent ran under agent versions v1 and v2 on
 * the same pinned dataset. Between them one case regressed, one was fixed, one
 * stayed, one was removed and one was added. No live model is involved.
 */

type TrendResponse = {
  points: Array<{ suiteRunId: string; agentVersions: Array<string | null>; previousSuiteRunId: string | null; passScoreDelta: number | null }>
  versions: Array<{ agentVersion: string | null; runCount: number; passScoreDelta: number | null; sameDataset: boolean | null }>
}

type CompareResponse = {
  base: { id: string; agentVersions: Array<string | null> }
  head: { id: string; agentVersions: Array<string | null> }
  passScoreDelta: number | null
  sameDataset: boolean | null
  totals: Record<string, number>
  assertions: Array<{ key: string; basePassRate: number | null; headPassRate: number | null; regressed: boolean }>
  cases: Array<{ caseId: string; name: string | null; change: string; flippedAssertions: Array<{ key: string }> }>
}

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'
const V1 = 'sha256:aaaaaaaaaaaa'
const V2 = 'sha256:bbbbbbbbbbbb'

test.describe('TC-AGENT-EVAL-REGRESSION-001: eval regression dashboard', () => {
  test('trend groups runs by agent version and compare diffs two runs case by case', async ({ page, request }) => {
    test.slow()

    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const context = getTokenContext(token)
    expect(context.tenantId, 'admin token must carry a tenant id').toBeTruthy()
    expect(context.organizationId, 'admin token must carry an organization id').toBeTruthy()
    const scope: RegressionScope = { tenantId: context.tenantId!, organizationId: context.organizationId! }

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const agentId = await firstRegisteredAgentId(request, token)
    const evalSetVersion = `qa-regression-${stamp}`
    const ids = emptyFixtureIds()

    try {
      const regressCase = await insertEvalCase(scope, agentId, `qa-regress-${stamp}`, ids)
      const fixCase = await insertEvalCase(scope, agentId, `qa-fix-${stamp}`, ids)
      const stableCase = await insertEvalCase(scope, agentId, `qa-stable-${stamp}`, ids)
      const removedCase = await insertEvalCase(scope, agentId, `qa-removed-${stamp}`, ids)
      const addedCase = await insertEvalCase(scope, agentId, `qa-added-${stamp}`, ids)

      const now = Date.now()
      const baseRunId = await insertSuiteRun(scope, {
        agentDefinitionId: agentId,
        status: 'completed',
        passScore: 0.5,
        evalSetVersion,
        agentVersion: V1,
        createdAt: new Date(now - 2 * 60 * 60 * 1000),
        caseRuns: [
          { caseId: regressCase, status: 'passed', verdicts: { schema: true } },
          { caseId: fixCase, status: 'failed', verdicts: { schema: false } },
          { caseId: stableCase, status: 'passed', verdicts: { schema: true } },
          { caseId: removedCase, status: 'failed', verdicts: { schema: false } },
        ],
      }, ids)
      const headRunId = await insertSuiteRun(scope, {
        agentDefinitionId: agentId,
        status: 'completed',
        passScore: 0.75,
        evalSetVersion,
        agentVersion: V2,
        createdAt: new Date(now - 60 * 60 * 1000),
        caseRuns: [
          { caseId: regressCase, status: 'failed', verdicts: { schema: false } },
          { caseId: fixCase, status: 'passed', verdicts: { schema: true } },
          { caseId: stableCase, status: 'passed', verdicts: { schema: true } },
          { caseId: addedCase, status: 'passed', verdicts: { schema: true } },
        ],
      }, ids)
      const runningRunId = await insertSuiteRun(scope, {
        agentDefinitionId: agentId,
        status: 'running',
        passScore: null,
        evalSetVersion,
        agentVersion: V2,
        createdAt: new Date(now - 30 * 60 * 1000),
        caseRuns: [],
      }, ids)
      const otherAgentRunId = await insertSuiteRun(scope, {
        agentDefinitionId: `qa.other-agent-${stamp}`,
        status: 'completed',
        passScore: 1,
        evalSetVersion,
        agentVersion: V1,
        createdAt: new Date(now - 45 * 60 * 1000),
        caseRuns: [],
      }, ids)

      const trendRes = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/eval-runs/trend?agentDefinitionId=${encodeURIComponent(agentId)}&evalSetVersion=${encodeURIComponent(evalSetVersion)}`,
        { token },
      )
      expect(trendRes.status(), await trendRes.text()).toBe(200)
      const trend = await readJsonSafe<TrendResponse>(trendRes)
      expect(trend?.points.map((point) => point.suiteRunId)).toEqual([baseRunId, headRunId])
      expect(trend?.points[0].agentVersions).toEqual([V1])
      expect(trend?.points[1]).toMatchObject({ agentVersions: [V2], previousSuiteRunId: baseRunId, passScoreDelta: 0.25 })
      expect(trend?.versions).toEqual([
        expect.objectContaining({ agentVersion: V1, runCount: 1, passScoreDelta: null }),
        expect.objectContaining({ agentVersion: V2, runCount: 1, passScoreDelta: 0.25, sameDataset: true }),
      ])

      const compareUrl = (base: string, head: string) =>
        `/api/agent_orchestrator/eval-runs/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`
      const compareRes = await apiRequest(request, 'GET', compareUrl(baseRunId, headRunId), { token })
      expect(compareRes.status(), await compareRes.text()).toBe(200)
      const comparison = await readJsonSafe<CompareResponse>(compareRes)
      expect(comparison?.base.agentVersions).toEqual([V1])
      expect(comparison?.head.agentVersions).toEqual([V2])
      expect(comparison?.passScoreDelta).toBe(0.25)
      expect(comparison?.sameDataset).toBeNull()
      expect(comparison?.totals).toEqual({ regressed: 1, fixed: 1, changed: 0, added: 1, removed: 1, unchanged: 1 })
      const changeOf = (caseId: string) => comparison?.cases.find((entry) => entry.caseId === caseId)?.change
      expect(changeOf(regressCase)).toBe('regressed')
      expect(changeOf(fixCase)).toBe('fixed')
      expect(changeOf(stableCase)).toBe('unchanged')
      expect(changeOf(removedCase)).toBe('removed')
      expect(changeOf(addedCase)).toBe('added')
      expect(comparison?.cases[0]).toMatchObject({ caseId: regressCase, name: `qa-regress-${stamp}`, flippedAssertions: [{ key: 'schema' }] })
      expect(comparison?.assertions).toEqual([
        expect.objectContaining({ key: 'schema', basePassRate: 0.5, headPassRate: 0.75, regressed: false }),
      ])

      const reverseRes = await apiRequest(request, 'GET', compareUrl(headRunId, baseRunId), { token })
      expect(reverseRes.status(), await reverseRes.text()).toBe(200)
      const reverse = await readJsonSafe<CompareResponse>(reverseRes)
      expect(reverse?.assertions[0]).toMatchObject({ key: 'schema', regressed: true })

      const sameRes = await apiRequest(request, 'GET', compareUrl(baseRunId, baseRunId), { token })
      expect(sameRes.status()).toBe(400)
      const missingRes = await apiRequest(request, 'GET', compareUrl(baseRunId, randomUUID()), { token })
      expect(missingRes.status()).toBe(404)
      const runningRes = await apiRequest(request, 'GET', compareUrl(baseRunId, runningRunId), { token })
      expect(runningRes.status()).toBe(409)
      expect((await readJsonSafe<{ code?: string }>(runningRes))?.code).toBe('run_not_finished')
      const mismatchRes = await apiRequest(request, 'GET', compareUrl(baseRunId, otherAgentRunId), { token })
      expect(mismatchRes.status()).toBe(422)
      expect((await readJsonSafe<{ code?: string }>(mismatchRes))?.code).toBe('agent_mismatch')
      const badTrendRes = await apiRequest(request, 'GET', '/api/agent_orchestrator/eval-runs/trend', { token })
      expect(badTrendRes.status()).toBe(400)

      await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD)
      await page.goto(`/backend/eval-runs/compare?base=${baseRunId}&head=${headRunId}`, { waitUntil: 'domcontentloaded' })
      const regressedRow = page.getByTestId(`eval-compare-case-${regressCase}`)
      await expect(regressedRow).toBeVisible({ timeout: 20_000 })
      await expect(regressedRow).toContainText(/regressed/i)
      await expect(page.getByTestId(`eval-compare-case-${stableCase}`)).toHaveCount(0)
      await page.getByRole('radio', { name: /all cases/i }).click()
      await expect(page.getByTestId(`eval-compare-case-${stableCase}`)).toBeVisible()

      await page.goto(`/backend/agents/${encodeURIComponent(agentId)}?tab=evaluation&section=regressions`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('eval-regression-section')).toBeVisible({ timeout: 20_000 })
      const headRow = page.getByTestId(`eval-regression-run-${headRunId}`)
      await expect(headRow).toBeVisible()
      await expect(headRow).toContainText(V2)
      await headRow.getByRole('link', { name: /compare with previous/i }).click()
      await expect(page).toHaveURL(new RegExp(`/backend/eval-runs/compare\\?base=${baseRunId}&head=${headRunId}`))
      await expect(page.getByTestId(`eval-compare-case-${regressCase}`)).toBeVisible({ timeout: 20_000 })
    } finally {
      await deleteRegressionFixtures(ids).catch(() => undefined)
    }
  })
})
