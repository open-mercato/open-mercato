import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createPersonFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  extractOperation,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 §4 — no undo affordance for non-undoable commands (#2572).
 *
 * A command that does not support undo must carry NO `x-om-operation` token on its mutating
 * response (so the UI shows no Undo affordance):
 *   - `customers.pipeline-stages.delete` intentionally returns `{ ok: true }` without an
 *     operation envelope — the active assertion below.
 *
 * The deprecated `customers.activities.create` / `customers.todos.create` bridge routes
 * (sunset 2026-06-30, #2506) were originally expected to expose no undo affordance, but on
 * `develop` they delegate to the UNDOABLE `customers.interactions.create` command and now
 * surface its `x-om-operation` token via `withOperationMetadata` — i.e. they are
 * undoable-by-delegation. Per the issue's "(or fixme until the route is retired)" guidance,
 * the no-token expectation for those legacy surfaces is quarantined with `test.fixme` until
 * the bridge is removed.
 *
 * Self-contained: fixtures are created via API and removed in teardown.
 */

const INTERACTIONS = '/api/customers/interactions'

test.describe('TC-UNDO-001 §4 non-undoable commands expose no undo token', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  // FIXME(#2506): the deprecated bridge now surfaces the delegated `customers.interactions.create`
  // undo token; flip back to an active assertion once the legacy route is retired (sunset 2026-06-30).
  test.fixme('activities.create (deprecated bridge) emits no undo token', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let activityId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'NoUndo',
        lastName: `Activity ${stamp}`,
        displayName: `NoUndo Activity ${stamp}`,
      })

      const res = await apiRequest(request, 'POST', '/api/customers/activities', {
        token,
        data: { entityId: personId, activityType: 'note', subject: `No undo activity ${stamp}` },
      })
      // Bridge enabled → 201 created; bridge retired → 410 gone. Neither issues an undo token.
      expect([201, 410]).toContain(res.status())
      expect(extractOperation(res), 'activities.create must not expose an undo token (§4)').toBeNull()
      if (res.status() === 201) {
        activityId = ((await readJsonSafe(res)) as { id?: string } | null)?.id ?? null
      }
    } finally {
      if (activityId) await apiRequest(request, 'DELETE', `${INTERACTIONS}?id=${activityId}`, { token }).catch(() => {})
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  // FIXME(#2506): the deprecated bridge now surfaces the delegated `customers.interactions.create`
  // undo token; flip back to an active assertion once the legacy route is retired (sunset 2026-06-30).
  test.fixme('todos.create (deprecated bridge) emits no undo token', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let todoId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'NoUndo',
        lastName: `Todo ${stamp}`,
        displayName: `NoUndo Todo ${stamp}`,
      })

      const res = await apiRequest(request, 'POST', '/api/customers/todos', {
        token,
        data: { entityId: personId, title: `No undo todo ${stamp}` },
      })
      expect([201, 410]).toContain(res.status())
      expect(extractOperation(res), 'todos.create must not expose an undo token (§4)').toBeNull()
      if (res.status() === 201) {
        // The todos bridge returns { linkId, todoId } (both the bridged interaction id), not { id }.
        const body = (await readJsonSafe(res)) as { todoId?: string; linkId?: string } | null
        todoId = body?.todoId ?? body?.linkId ?? null
      }
    } finally {
      if (todoId) await apiRequest(request, 'DELETE', `${INTERACTIONS}?id=${todoId}`, { token }).catch(() => {})
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('pipeline-stages.delete emits no undo token', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let pipelineId: string | null = null
    try {
      pipelineId = await createPipelineFixture(request, token, { name: `NoUndo Pipeline ${stamp}` })
      const stageId = await createPipelineStageFixture(request, token, { pipelineId, label: `NoUndo Stage ${stamp}` })

      const res = await apiRequest(request, 'DELETE', '/api/customers/pipeline-stages', { token, data: { id: stageId } })
      expect(res.ok(), `pipeline-stage delete status ${res.status()}`).toBeTruthy()
      expect(extractOperation(res), 'pipeline-stages.delete must not expose an undo token (§4)').toBeNull()
    } finally {
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId)
    }
  })
})
