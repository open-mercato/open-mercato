import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-PROCDEF-004 — milestones: the authored, ordered business stages of a
 * process.
 *
 * Source: `.ai/specs/enterprise/agent-orchestrator/2026-08-11-triggered-process-model.md`
 * §Integration coverage — "a milestone naming an unknown step warns and stays
 * saveable; on an agent-targeted definition it is a validation error" and
 * "/backend/processes … milestone reorder".
 *
 * Self-contained: every definition is created here and removed in `finally`;
 * nothing depends on seeded or demo data.
 */

const DEFINITIONS = '/api/agent_orchestrator/process-definitions'

type Milestone = { id: string; label: string; stepId: string; order: number }
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
  const body = await readJsonSafe<{ task?: DefinitionDetail }>(response)
  expect(body?.task, 'detail carries the definition').toBeTruthy()
  return body!.task as DefinitionDetail
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
  test('a milestone naming an unknown step stays saveable', async ({ request }) => {
    // The drift diagnostic is a WARNING surfaced in the editor's Problems
    // panel: a definition mid-edit must never be blocked from saving because a
    // step it names has not been authored yet.
    const token = await getAuthToken(request, 'admin')
    let id: string | null = null
    try {
      id = await createDefinition(request, token, {
        name: `TC-PROCDEF-004 drift ${Date.now()}`,
        targetType: 'workflow',
        targetWorkflowId: 'tc-procdef-004-workflow',
        triggers: [{ kind: 'manual' }],
        milestones: [
          { id: 'ms-1', label: 'Reported', stepId: 'step_that_does_not_exist', order: 0 },
        ],
      })
      const stored = await readDefinition(request, token, id)
      expect(stored.milestones?.[0]?.stepId).toBe('step_that_does_not_exist')
    } finally {
      await deleteDefinitionIfExists(request, token, id)
    }
  })

  test('milestones on an agent-targeted definition are rejected', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', DEFINITIONS, {
      token,
      data: {
        name: `TC-PROCDEF-004 agent ${Date.now()}`,
        targetType: 'agent',
        targetAgentId: 'deals.health_check',
        triggers: [{ kind: 'manual' }],
        milestones: [{ id: 'ms-1', label: 'Reported', stepId: 'report', order: 0 }],
      },
    })
    expect(
      response.status(),
      'an agent target has no steps to map — a validation error, not a silent no-op',
    ).toBe(400)
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
        targetType: 'workflow',
        targetWorkflowId: 'tc-procdef-004-workflow',
        triggers: [{ kind: 'manual' }],
        milestones: [
          { id: 'a', label: 'Reported', stepId: 'report', order: 0 },
          { id: 'b', label: 'Assessed', stepId: 'assess', order: 1 },
          { id: 'c', label: 'Paid', stepId: 'pay', order: 2 },
        ],
      })
      const before = await readDefinition(request, token, id)
      expect((before.milestones ?? []).map((one) => one.id)).toEqual(['a', 'b', 'c'])

      const reordered = await apiRequest(request, 'PUT', DEFINITIONS, {
        token,
        data: {
          id,
          name,
          targetType: 'workflow',
          targetWorkflowId: 'tc-procdef-004-workflow',
          milestones: [
            { id: 'c', label: 'Paid', stepId: 'pay', order: 0 },
            { id: 'a', label: 'Reported', stepId: 'report', order: 1 },
            { id: 'b', label: 'Assessed', stepId: 'assess', order: 2 },
          ],
        },
      })
      expect(reordered.ok(), 'the reorder saves through the parent definition').toBeTruthy()

      const after = await readDefinition(request, token, id)
      expect((after.milestones ?? []).map((one) => one.id)).toEqual(['c', 'a', 'b'])
      expect((after.milestones ?? []).map((one) => one.order)).toEqual([0, 1, 2])
    } finally {
      await deleteDefinitionIfExists(request, token, id)
    }
  })
})
