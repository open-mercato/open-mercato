import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-PROCDEF-003 — declared triggers gate manual entry, `triggeredBy`
 * records which trigger fired, and the Phase 2 migration's manual backfill left
 * every pre-existing definition still startable by hand.
 *
 * Source: `.ai/specs/enterprise/agent-orchestrator/2026-08-11-triggered-process-model.md`
 * §Integration coverage (`POST /process-definitions/[id]/run`: 403 without a
 * declared manual trigger; `triggeredBy.kind === 'manual'` recorded) and
 * §Phasing step 6 (the backfill, "covered by an integration assertion, not left
 * to review").
 *
 * Self-contained: every definition is created here and removed in `finally`;
 * nothing depends on seeded or demo data. The backfill leg reads whatever
 * definitions the database already carries and asserts only about them.
 */

const DEFINITIONS = '/api/agent_orchestrator/process-definitions'
const RUNS = '/api/agent_orchestrator/process-runs'

type DefinitionListItem = { id?: string; name?: string; triggers?: unknown }
type RunListItem = { id?: string; triggered_by?: { kind?: string; ref?: string } | null }

async function createDefinition(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', DEFINITIONS, { token, data })
  expect(response.status(), 'create returns 201').toBe(201)
  const id = (await readJsonSafe<{ id?: string }>(response))?.id ?? null
  expect(id, 'create response carries the new id').toBeTruthy()
  return id as string
}

async function deleteDefinitionIfExists(
  request: APIRequestContext,
  token: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `${DEFINITIONS}?id=${encodeURIComponent(id)}`, { token }).catch(
    () => undefined,
  )
}

test.describe('TC-AGENT-PROCDEF-003: manual entry is a declared capability', () => {
  test('403s a definition with no manual trigger and records triggeredBy on one that has it', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let scheduleOnlyId: string | null = null
    let manualId: string | null = null

    try {
      scheduleOnlyId = await createDefinition(request, token, {
        name: `TC-PROCDEF-003 schedule-only ${stamp}`,
        targetType: 'agent',
        targetAgentId: 'deals.health_check',
        triggers: [{ kind: 'schedule', cron: '0 7 * * 1', timezone: 'UTC' }],
      })

      const denied = await apiRequest(
        request,
        'POST',
        `${DEFINITIONS}/${encodeURIComponent(scheduleOnlyId)}/run`,
        { token, data: {} },
      )
      expect(denied.status(), 'no declared manual trigger → 403, not a silent run').toBe(403)

      manualId = await createDefinition(request, token, {
        name: `TC-PROCDEF-003 manual ${stamp}`,
        targetType: 'agent',
        targetAgentId: 'deals.health_check',
        triggers: [{ kind: 'manual' }],
      })

      const accepted = await apiRequest(
        request,
        'POST',
        `${DEFINITIONS}/${encodeURIComponent(manualId)}/run`,
        { token, data: {} },
      )
      expect(accepted.status(), 'a declared manual trigger → 202').toBe(202)
      const runId = (await readJsonSafe<{ processRunId?: string }>(accepted))?.processRunId ?? null
      expect(runId, 'the 202 body carries the run id').toBeTruthy()

      const runsResponse = await apiRequest(
        request,
        'GET',
        `${RUNS}?processDefinitionId=${encodeURIComponent(manualId)}&pageSize=10`,
        { token },
      )
      expect(runsResponse.ok(), 'run ledger must be readable').toBeTruthy()
      const runs = (await readJsonSafe<{ items?: RunListItem[] }>(runsResponse))?.items ?? []
      const run = runs.find((item) => item.id === runId)
      expect(run, 'the started run appears in the ledger').toBeTruthy()
      expect(run?.triggered_by?.kind, 'the run records WHICH trigger fired').toBe('manual')
      expect(run?.triggered_by?.ref, 'a manual entry records the acting user').toBeTruthy()
    } finally {
      await deleteDefinitionIfExists(request, token, scheduleOnlyId)
      await deleteDefinitionIfExists(request, token, manualId)
    }
  })

  test('every pre-existing definition kept run-now (the Phase 2 manual backfill)', async ({ request }) => {
    // Gating `/run` on a declared manual trigger without backfilling one onto
    // every existing definition would silently remove run-now from all of them.
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', `${DEFINITIONS}?pageSize=100`, { token })
    expect(response.ok(), 'definition list must succeed').toBeTruthy()
    const all = (await readJsonSafe<{ items?: DefinitionListItem[] }>(response))?.items ?? []
    // Exclude other specs' in-flight fixtures; only migrated rows are the subject.
    const items = all.filter((item) => !String(item.name ?? '').startsWith('TC-'))
    test.skip(items.length === 0, 'no pre-existing definitions in this database')

    for (const item of items) {
      const triggers = Array.isArray(item.triggers) ? (item.triggers as Array<{ kind?: string }>) : []
      expect(
        triggers.some((trigger) => trigger?.kind === 'manual'),
        `definition "${item.name}" must keep a manual trigger after the migration`,
      ).toBe(true)
    }
  })
})
