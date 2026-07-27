import { expect, test, type Page } from '@playwright/test'
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
import {
  deleteAgentEvalCasesByIds,
  deleteAgentRunsByIds,
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-NAV-005: "Add to evals" is no longer a black hole — the created
 * draft is visible on the new read-only eval-cases page, the list route never
 * returns the encrypted `input`/`expected` payloads, and callers without
 * `eval.manage` get a 403.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-navigation-pass.md
 * (§5 Minimal eval-cases page, Integration Test Coverage).
 *
 * The source run is seeded directly (runs are not creatable via public API —
 * TC-AGENT-PERF precedent), so no LLM key is required.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'
const RESTRICTED_FEATURES = ['agent_orchestrator.trace.view']

type EvalCaseItem = Record<string, unknown>

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-NAV-005: eval-cases surfacing', () => {
  test('draft appears on the page; response is metadata-only; 403 without eval.manage', async ({ page, request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const context = getTokenContext(adminToken)
    expect(context.tenantId, 'admin token must carry a tenant id').toBeTruthy()
    expect(context.organizationId, 'admin token must carry an organization id').toBeTruthy()

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const agentId = `qa.nav005_${stamp.replace(/-/g, '_')}`
    const seededRunIds: string[] = []
    const createdEvalCaseIds: string[] = []
    let restrictedRoleId: string | null = null
    let restrictedUserId: string | null = null
    const restrictedEmail = `qa-tc-agent-nav-005-${stamp}@example.com`
    const password = 'StrongSecret123!'

    try {
      const [runId] = await insertAgentRunFixtures([
        {
          tenantId: context.tenantId!,
          organizationId: context.organizationId!,
          agentId,
          status: 'ok',
          createdAt: new Date(),
        },
      ])
      seededRunIds.push(runId)

      const createRes = await apiRequest(
        request,
        'POST',
        `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/eval-case`,
        { token: adminToken },
      )
      expect(createRes.status(), await createRes.text()).toBe(200)
      const created = await readJsonSafe<{ evalCase?: { id?: string; status?: string } }>(createRes)
      const evalCaseId = created?.evalCase?.id
      expect(evalCaseId, 'add-to-evals must return the created case id').toBeTruthy()
      createdEvalCaseIds.push(evalCaseId!)

      const listRes = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/eval-cases?status=draft&agentDefinitionId=${encodeURIComponent(agentId)}&pageSize=50`,
        { token: adminToken },
      )
      expect(listRes.status(), await listRes.text()).toBe(200)
      const listBody = await readJsonSafe<{ items?: EvalCaseItem[]; total?: number }>(listRes)
      const items = listBody?.items ?? []
      const mine = items.find((item) => item.id === evalCaseId)
      expect(mine, 'the created draft must be listed under status=draft').toBeTruthy()

      for (const item of items) {
        for (const forbidden of ['input', 'expected', 'assertions']) {
          expect(
            Object.keys(item).some((key) => key.toLowerCase() === forbidden),
            `list items must never carry the encrypted "${forbidden}" payload`,
          ).toBe(false)
        }
      }

      const filteredOut = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/eval-cases?status=approved&agentDefinitionId=${encodeURIComponent(agentId)}`,
        { token: adminToken },
      )
      expect(filteredOut.status()).toBe(200)
      const filteredBody = await readJsonSafe<{ items?: EvalCaseItem[] }>(filteredOut)
      expect(
        (filteredBody?.items ?? []).some((item) => item.id === evalCaseId),
        'the status filter must exclude the draft from status=approved',
      ).toBe(false)

      const superadminToken = await getAuthToken(request, 'superadmin')
      restrictedRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-nav005-role-${stamp}`,
        tenantId: context.tenantId!,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: restrictedRoleId,
        features: RESTRICTED_FEATURES,
        organizations: null,
      })
      restrictedUserId = await createUserFixture(request, superadminToken, {
        email: restrictedEmail,
        password,
        organizationId: context.organizationId!,
        roles: [restrictedRoleId],
        name: 'QA TC-AGENT-NAV-005 reader',
      })
      const restrictedToken = await getAuthToken(request, restrictedEmail, password)
      const forbiddenRes = await apiRequest(request, 'GET', '/api/agent_orchestrator/eval-cases', {
        token: restrictedToken,
      })
      expect(forbiddenRes.status(), 'eval-cases must 403 without eval.manage').toBe(403)

      await loginAsAdmin(page)
      await page.goto('/backend/eval-cases?status=draft', { waitUntil: 'domcontentloaded' })
      await expect(
        page.getByText(agentId).first(),
        'the eval-cases page must list the created draft on the draft tab',
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteAgentEvalCasesByIds(createdEvalCaseIds).catch(() => undefined)
      await deleteAgentRunsByIds(seededRunIds).catch(() => undefined)
      const cleanupToken = await getAuthToken(request, 'superadmin').catch(() => null)
      if (cleanupToken) {
        await deleteUserIfExists(request, cleanupToken, restrictedUserId).catch(() => undefined)
        await deleteRoleIfExists(request, cleanupToken, restrictedRoleId).catch(() => undefined)
      }
    }
  })
})
