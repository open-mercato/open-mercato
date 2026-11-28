import { readFile } from 'node:fs/promises'
import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
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
  loginAs,
  startEvalRun,
} from './helpers/evalReportFixtures'

/**
 * TC-AGENT-EVAL-REPORT-002: "Download report" menu on the eval run page.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-eval-reports-and-reproducible-regression.md
 * (UI/UX → eval run detail, Integration coverage).
 *
 * The menu is present for a caller holding eval.export and downloads a JSON
 * report that parses; a caller with eval.manage only sees the run but no menu.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'
const MANAGE_ONLY_FEATURES = ['agent_orchestrator.eval.manage']

test.describe('TC-AGENT-EVAL-REPORT-002: eval run page download menu', () => {
  test('menu downloads a JSON report with eval.export and is absent without it', async ({ page, browser, request }) => {
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
    const restrictedEmail = `qa-tc-agent-eval-report-002-${stamp}@example.com`
    const password = 'StrongSecret123!'

    try {
      const evalCaseId = await createApprovedEvalCase(request, adminToken, agentId, `qa-eval-report-002-${stamp}`)
      createdEvalCaseIds.push(evalCaseId)
      const suiteRunId = await startEvalRun(request, adminToken, agentId, [evalCaseId])
      suiteRunIds.push(suiteRunId)
      const runUrl = `/backend/eval-runs/${encodeURIComponent(suiteRunId)}`

      await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD)
      await page.goto(runUrl, { waitUntil: 'domcontentloaded' })
      const downloadButton = page.getByRole('button', { name: /download report/i })
      await expect(downloadButton).toBeVisible({ timeout: 15_000 })
      await downloadButton.click()

      const reportResponse = page.waitForResponse(
        (response) => response.url().includes(`/eval-runs/${suiteRunId}/report`) && response.request().method() === 'GET',
      )
      const downloadEvent = page.waitForEvent('download')
      await page.getByRole('option', { name: /json report/i }).click()
      const response = await reportResponse
      expect(response.status()).toBe(200)
      expect(response.url()).toContain('format=json')
      const download = await downloadEvent
      expect(download.suggestedFilename()).toBe(`eval-${suiteRunId}.json`)
      const downloadedPath = await download.path()
      expect(downloadedPath, 'the browser must save the report').toBeTruthy()
      const report = JSON.parse(await readFile(downloadedPath!, 'utf8')) as {
        schema?: string
        suiteRun?: { id?: string }
      }
      expect(report.schema).toBe('open-mercato.agent-eval-report')
      expect(report.suiteRun?.id).toBe(suiteRunId)

      const superadminToken = await getAuthToken(request, 'superadmin')
      restrictedRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-eval-report-002-role-${stamp}`,
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
        name: 'QA TC-AGENT-EVAL-REPORT-002 reader',
      })

      const restrictedContext = await browser.newContext()
      try {
        const restrictedPage = await restrictedContext.newPage()
        await loginAs(restrictedPage, restrictedEmail, password)
        const featureCheck = restrictedPage.waitForResponse((entry) => entry.url().includes('/api/auth/feature-check'))
        await restrictedPage.goto(runUrl, { waitUntil: 'domcontentloaded' })
        await featureCheck
        await expect(restrictedPage.getByText(agentId).first()).toBeVisible({ timeout: 15_000 })
        await expect(restrictedPage.getByRole('button', { name: /download report/i })).toHaveCount(0)
      } finally {
        await restrictedContext.close()
      }
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
