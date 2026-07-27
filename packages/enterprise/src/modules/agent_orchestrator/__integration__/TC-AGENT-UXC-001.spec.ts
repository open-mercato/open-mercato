import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { signTraceIngest, TRACE_INGEST_HEADERS } from '../lib/trace/ingestAuth'
import { deleteAgentOrchestratorRowsForOrganization } from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-UXC-001: a "Running" trace detail live-updates when its run
 * completes — no manual reload.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-consistency-pass.md
 * (Area 1: `run.ingested` is clientBroadcast; the detail page subscribes,
 * filtered by run id, through the coalesced reload).
 *
 * Flow: HMAC-signed ingest creates a `running` run → the detail page renders
 * the Running badge → a second ingest of the same (runtime, externalRunId)
 * flips the run to `ok` and emits the broadcast → the open page shows
 * "Completed" without any reload.
 *
 * NOTE: signing reuses the per-tenant derived secret, so the test process and
 * the server MUST share `JWT_SECRET` (TC-AGENT-TRACE-001 precedent).
 */

const BASE_URL = process.env.BASE_URL?.trim() || ''
const resolveUrl = (path: string) => (BASE_URL ? `${BASE_URL}${path}` : path)

async function postTrace(
  request: APIRequestContext,
  scope: { tenantId: string; organizationId: string },
  body: unknown,
): Promise<{ ok: boolean; runId: string | null }> {
  const raw = JSON.stringify(body)
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = signTraceIngest(scope.tenantId, msgId, timestamp, raw)
  const response = await request.fetch(resolveUrl('/api/agent_orchestrator/trace/ingest'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TRACE_INGEST_HEADERS.tenant]: scope.tenantId,
      [TRACE_INGEST_HEADERS.organization]: scope.organizationId,
      [TRACE_INGEST_HEADERS.id]: msgId,
      [TRACE_INGEST_HEADERS.timestamp]: timestamp,
      [TRACE_INGEST_HEADERS.signature]: signature,
    },
    data: raw,
  })
  const parsed = await readJsonSafe<{ runId?: string }>(response)
  return { ok: response.ok(), runId: parsed?.runId ?? null }
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-UXC-001: trace detail live refresh', () => {
  test('an open Running trace flips to Completed on run.ingested without reload', async ({ page, request }) => {
    test.slow()

    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'
    let tenantId = getTokenContext(superadminToken).tenantId
    if (!tenantId) {
      const existing = await apiRequest(request, 'GET', '/api/directory/organizations?page=1&pageSize=1', { token: superadminToken })
      const body = await readJsonSafe<{ items?: Array<{ tenantId?: string | null }> }>(existing)
      tenantId = body?.items?.[0]?.tenantId ?? ''
    }
    expect(tenantId, 'a tenant id is required to place the throwaway org').toBeTruthy()

    let orgId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    const email = `tc-uxc-001-${stamp}@example.com`
    const externalRunId = `tc-uxc-001-${stamp}`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-UXC-001 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-uxc-001-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['agent_orchestrator.trace.view'],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: orgId,
        roles: [roleId],
        name: 'QA TC-AGENT-UXC-001',
      })

      const scope = { tenantId: tenantId!, organizationId: orgId! }
      const startedAt = new Date().toISOString()

      // 1. First ingest: the run arrives still running (no output yet).
      const first = await postTrace(request, scope, {
        runtime: 'integration-test',
        externalRunId,
        agentId: 'deals.health_check',
        status: 'running',
        spans: [
          { externalSpanId: 'root', sequence: 0, name: 'root', kind: 'system', startedAt },
        ],
      })
      expect(first.ok, 'first ingest must be accepted').toBeTruthy()
      expect(first.runId, 'ingest must return the run id').toBeTruthy()

      // 2. The detail page renders the Running badge.
      await loginAs(page, email, password)
      await page.goto(`/backend/traces/${first.runId}`, { waitUntil: 'domcontentloaded' })
      const statusBadge = page.getByText('Running', { exact: true }).first()
      await expect(statusBadge).toBeVisible({ timeout: 15_000 })

      // 3. Second ingest of the same (runtime, externalRunId) completes the
      //    run. The run.ingested clientBroadcast reaches the open page (SSE);
      //    its coalesced, run-id-filtered subscription silently refetches —
      //    NO page.reload() in this test.
      const second = await postTrace(request, scope, {
        runtime: 'integration-test',
        externalRunId,
        agentId: 'deals.health_check',
        status: 'ok',
        output: { kind: 'informative', data: { ok: true } },
        spans: [
          {
            externalSpanId: 'llm',
            parentExternalSpanId: 'root',
            sequence: 1,
            name: 'llm-call',
            kind: 'llm',
            startedAt,
            endedAt: new Date().toISOString(),
          },
        ],
      })
      expect(second.ok, 'completing ingest must be accepted').toBeTruthy()
      expect(second.runId).toBe(first.runId)

      await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
