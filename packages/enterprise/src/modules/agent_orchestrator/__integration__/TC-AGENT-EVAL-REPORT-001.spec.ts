import { randomUUID, randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteAgentEvalCasesByIds } from './helpers/agentPerfFixtures'
import {
  createApprovedEvalCase,
  deleteEvalSuiteRunsByIds,
  firstRegisteredAgentId,
  insertEvalSuiteRunFixture,
  startEvalRun,
} from './helpers/evalReportFixtures'

/**
 * TC-AGENT-EVAL-REPORT-001: GET /eval-runs/:id/report contract.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-eval-reports-and-reproducible-regression.md
 * (API Contracts → GET /eval-runs/:id/report, Integration coverage).
 *
 * The suite run is started through the public API (one approved case, executed
 * inline). The report renders whatever the replay produced — a scored case or an
 * errored one when the environment has no usable model — so the contract holds
 * without an LLM key.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'
const MANAGE_ONLY_FEATURES = ['agent_orchestrator.eval.manage']

type EvalReportBody = {
  schema?: string
  schemaVersion?: number
  status?: string
  suiteRun?: { id?: string; agentId?: string }
  cases?: unknown[]
}

function reportPath(suiteRunId: string, query = ''): string {
  return `/api/agent_orchestrator/eval-runs/${encodeURIComponent(suiteRunId)}/report${query}`
}

test.describe('TC-AGENT-EVAL-REPORT-001: eval run report download API', () => {
  test('json/md/junit render with attachment headers; 409 while running; 404 cross-org; 403 without eval.export', async ({
    request,
  }) => {
    test.slow()

    const adminToken = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const context = getTokenContext(adminToken)
    expect(context.tenantId, 'admin token must carry a tenant id').toBeTruthy()
    expect(context.organizationId, 'admin token must carry an organization id').toBeTruthy()

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const agentId = await firstRegisteredAgentId(request, adminToken)
    const createdEvalCaseIds: string[] = []
    const suiteRunIds: string[] = []
    let restrictedRoleId: string | null = null
    let restrictedUserId: string | null = null
    const restrictedEmail = `qa-tc-agent-eval-report-001-${stamp}@example.com`
    const password = 'StrongSecret123!'

    try {
      const evalCaseId = await createApprovedEvalCase(request, adminToken, agentId, `qa-eval-report-001-${stamp}`)
      createdEvalCaseIds.push(evalCaseId)
      const suiteRunId = await startEvalRun(request, adminToken, agentId, [evalCaseId])
      suiteRunIds.push(suiteRunId)

      const jsonRes = await apiRequest(request, 'GET', reportPath(suiteRunId), { token: adminToken })
      expect(jsonRes.status(), await jsonRes.text()).toBe(200)
      expect(jsonRes.headers()['content-type']).toContain('application/json')
      expect(jsonRes.headers()['content-disposition']).toBe(`attachment; filename="eval-${suiteRunId}.json"`)
      const report = (await readJsonSafe<EvalReportBody>(jsonRes)) ?? {}
      expect(report.schema).toBe('open-mercato.agent-eval-report')
      expect(report.schemaVersion).toBe(1)
      expect(report.suiteRun?.id).toBe(suiteRunId)
      expect(report.suiteRun?.agentId).toBe(agentId)
      expect(['completed', 'failed', 'cancelled']).toContain(report.status)
      expect(Array.isArray(report.cases)).toBe(true)

      const markdownRes = await apiRequest(request, 'GET', reportPath(suiteRunId, '?format=md'), { token: adminToken })
      expect(markdownRes.status()).toBe(200)
      expect(markdownRes.headers()['content-type']).toContain('text/markdown')
      expect(markdownRes.headers()['content-disposition']).toBe(`attachment; filename="eval-${suiteRunId}.md"`)
      expect(await markdownRes.text()).toContain(suiteRunId)

      const junitRes = await apiRequest(request, 'GET', reportPath(suiteRunId, '?format=junit'), { token: adminToken })
      expect(junitRes.status()).toBe(200)
      expect(junitRes.headers()['content-type']).toContain('application/xml')
      expect(junitRes.headers()['content-disposition']).toBe(`attachment; filename="eval-${suiteRunId}.xml"`)
      const junit = await junitRes.text()
      expect(junit.startsWith('<?xml')).toBe(true)
      expect(junit).toContain('<testsuites')

      const invalidFormat = await apiRequest(request, 'GET', reportPath(suiteRunId, '?format=html'), { token: adminToken })
      expect(invalidFormat.status()).toBe(400)

      const runningId = await insertEvalSuiteRunFixture({
        tenantId: context.tenantId!,
        organizationId: context.organizationId!,
        agentDefinitionId: agentId,
        status: 'running',
      })
      suiteRunIds.push(runningId)
      const notFinished = await apiRequest(request, 'GET', reportPath(runningId), { token: adminToken })
      expect(notFinished.status()).toBe(409)
      expect((await readJsonSafe<{ error?: string }>(notFinished))?.error).toBe('run_not_finished')
      const partial = await apiRequest(request, 'GET', reportPath(runningId, '?partial=true'), { token: adminToken })
      expect(partial.status(), await partial.text()).toBe(200)
      expect((await readJsonSafe<EvalReportBody>(partial))?.status).toBe('running')

      const foreignId = await insertEvalSuiteRunFixture({
        tenantId: context.tenantId!,
        organizationId: randomUUID(),
        agentDefinitionId: agentId,
        status: 'completed',
      })
      suiteRunIds.push(foreignId)
      const crossOrg = await apiRequest(request, 'GET', reportPath(foreignId), { token: adminToken })
      expect(crossOrg.status(), 'another organization’s run must be indistinguishable from a missing one').toBe(404)

      const superadminToken = await getAuthToken(request, 'superadmin')
      restrictedRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-eval-report-001-role-${stamp}`,
        tenantId: context.tenantId!,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: restrictedRoleId,
        features: MANAGE_ONLY_FEATURES,
        organizations: null,
      })
      restrictedUserId = await createUserFixture(request, superadminToken, {
        email: restrictedEmail,
        password,
        organizationId: context.organizationId!,
        roles: [restrictedRoleId],
        name: 'QA TC-AGENT-EVAL-REPORT-001 reader',
      })
      const restrictedToken = await getAuthToken(request, restrictedEmail, password)
      const forbidden = await apiRequest(request, 'GET', reportPath(suiteRunId), { token: restrictedToken })
      expect(forbidden.status(), 'the report must 403 without eval.export').toBe(403)
      const detail = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/eval-runs/${encodeURIComponent(suiteRunId)}`,
        { token: restrictedToken },
      )
      expect(detail.status(), 'eval.manage alone still reads the run detail').toBe(200)
    } finally {
      await deleteEvalSuiteRunsByIds(suiteRunIds).catch(() => undefined)
      await deleteAgentEvalCasesByIds(createdEvalCaseIds).catch(() => undefined)
      const cleanupToken = await getAuthToken(request, 'superadmin').catch(() => null)
      if (cleanupToken) {
        await deleteUserIfExists(request, cleanupToken, restrictedUserId).catch(() => undefined)
        await deleteRoleIfExists(request, cleanupToken, restrictedRoleId).catch(() => undefined)
      }
    }
  })
})
