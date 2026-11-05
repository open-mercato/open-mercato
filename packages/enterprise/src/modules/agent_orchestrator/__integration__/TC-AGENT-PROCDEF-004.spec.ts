import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-PROCDEF-004 — milestones: the declared, ordered business VOCABULARY
 * of a process.
 *
 * Source: `.ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md`
 * §6 — a milestone is a business EVENT a workflow emits, never an alias for a
 * step. It carries no `stepId`, it is declarable in BOTH workflow modes, and a
 * key nothing emits is a WARNING rather than a refusal.
 *
 * Self-contained: every definition is created here and removed in `finally`;
 * nothing depends on seeded or demo data.
 */

const DEFINITIONS = '/api/agent_orchestrator/processes'

type Milestone = { key: string; label: string; order: number }
type DefinitionDetail = { id?: string; milestones?: Milestone[] | null; updatedAt?: string | null }

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

async function readDefinition(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<DefinitionDetail> {
  const response = await apiRequest(request, 'GET', `${DEFINITIONS}/${encodeURIComponent(id)}`, { token })
  expect(response.ok(), 'definition detail must be readable').toBeTruthy()
  const body = await readJsonSafe<{ definition?: DefinitionDetail }>(response)
  expect(body?.definition, 'detail carries the definition').toBeTruthy()
  return body!.definition as DefinitionDetail
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

test.describe('TC-AGENT-PROCDEF-004: milestones', () => {
  test('a milestone key nothing emits stays saveable', async ({ request }) => {
    // The drift diagnostic is a WARNING surfaced in the editor's Problems
    // panel: a definition mid-edit must never be blocked from saving because the
    // step meant to announce the stage has not been authored yet.
    const token = await getAuthToken(request, 'admin')
    let id: string | null = null
    try {
      id = await createDefinition(request, token, {
        name: `TC-PROCDEF-004 drift ${Date.now()}`,
        workflowMode: 'workflow',
        workflowId: 'tc-procdef-004-workflow',
        triggers: [{ kind: 'manual' }],
        milestones: [{ key: 'nothing_emits_this', label: 'Reported', order: 0 }],
      })
      const stored = await readDefinition(request, token, id)
      expect(stored.milestones?.[0]?.key).toBe('nothing_emits_this')
    } finally {
      await deleteDefinitionIfExists(request, token, id)
    }
  })

  test('a milestone carries NO stepId — it is not an alias for a step', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let id: string | null = null
    try {
      id = await createDefinition(request, token, {
        name: `TC-PROCDEF-004 shape ${Date.now()}`,
        workflowMode: 'workflow',
        workflowId: 'tc-procdef-004-workflow',
        triggers: [{ kind: 'manual' }],
        // A caller still sending the retired field gets it dropped, not stored:
        // binding a stage to one step is what made "the stage after the parallel
        // join" unexpressible.
        milestones: [{ key: 'reported', label: 'Reported', order: 0, stepId: 'report' }],
      })
      const stored = await readDefinition(request, token, id)
      expect(stored.milestones?.[0]).toMatchObject({ key: 'reported', label: 'Reported', order: 0 })
      expect(stored.milestones?.[0] as Record<string, unknown>).not.toHaveProperty('stepId')
    } finally {
      await deleteDefinitionIfExists(request, token, id)
    }
  })

  test('milestones are declarable on a single-agent process too', async ({ request }) => {
    // The predecessor model refused them here because an agent target had no
    // steps to map onto. Nothing maps onto a step any more, so the restriction
    // had no reason to survive.
    const token = await getAuthToken(request, 'admin')
    let id: string | null = null
    try {
      id = await createDefinition(request, token, {
        name: `TC-PROCDEF-004 agent ${Date.now()}`,
        workflowMode: 'single_agent',
        singleAgent: { agentId: 'deals.health_check', onResult: { alwaysAsk: true } },
        triggers: [{ kind: 'manual' }],
        milestones: [{ key: 'reported', label: 'Reported', order: 0 }],
      })
      const stored = await readDefinition(request, token, id)
      expect(stored.milestones?.[0]?.key).toBe('reported')
    } finally {
      await deleteDefinitionIfExists(request, token, id)
    }
  })

  test('reordering milestones persists the new order on the parent definition', async ({ request }) => {
    // The rows have no record of their own: a reorder is an update of the
    // PARENT definition, which is why the parent's optimistic lock is the only
    // one involved and no per-child override exists.
    const token = await getAuthToken(request, 'admin')
    const name = `TC-PROCDEF-004 reorder ${Date.now()}`
    let id: string | null = null
    try {
      id = await createDefinition(request, token, {
        name,
        workflowMode: 'workflow',
        workflowId: 'tc-procdef-004-workflow',
        triggers: [{ kind: 'manual' }],
        milestones: [
          { key: 'reported', label: 'Reported', order: 0 },
          { key: 'assessed', label: 'Assessed', order: 1 },
          { key: 'paid', label: 'Paid', order: 2 },
        ],
      })
      const before = await readDefinition(request, token, id)
      expect((before.milestones ?? []).map((one) => one.key)).toEqual(['reported', 'assessed', 'paid'])

      const reordered = await apiRequest(request, 'PUT', DEFINITIONS, {
        token,
        data: {
          id,
          name,
          workflowMode: 'workflow',
          workflowId: 'tc-procdef-004-workflow',
          milestones: [
            { key: 'paid', label: 'Paid', order: 0 },
            { key: 'reported', label: 'Reported', order: 1 },
            { key: 'assessed', label: 'Assessed', order: 2 },
          ],
        },
      })
      expect(reordered.ok(), 'the reorder saves through the parent definition').toBeTruthy()

      const after = await readDefinition(request, token, id)
      expect((after.milestones ?? []).map((one) => one.key)).toEqual(['paid', 'reported', 'assessed'])
      expect((after.milestones ?? []).map((one) => one.order)).toEqual([0, 1, 2])
    } finally {
      await deleteDefinitionIfExists(request, token, id)
    }
  })
})
