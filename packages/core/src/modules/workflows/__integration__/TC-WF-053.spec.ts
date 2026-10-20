import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildSlaBreachRouteDefinitionPayload,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-053 [P0] (API): every transition KIND survives a save.
 *
 * Regression for a live, silent data-loss bug this phase's research surfaced:
 * `graphToDefinition` persisted a transition `kind` only when it was `'error'`,
 * so opening a definition carrying a `kind: 'slaBreach'` route in the Studio and
 * saving it downgraded the route to a normal transition — the engine honours the
 * kind, so the breach simply stopped routing, with nothing logged anywhere.
 *
 * Surfaces under test:
 * - POST /api/workflows/definitions
 * - GET  /api/workflows/definitions/[id]
 * - PUT  /api/workflows/definitions/[id]  (the Studio's save shape: the whole
 *   definition body written back)
 *
 * The Studio round trip itself (`definitionToGraph → graphToDefinition`) is
 * unit-covered in `lib/__tests__/route-kinds.test.ts`; what this asserts is that
 * the API surface the Studio saves THROUGH preserves the kind end to end, so the
 * bug cannot come back at the persistence layer either.
 */

test.describe('TC-WF-053: transition kinds survive a definition save', () => {
  test('an SLA-breach route is still a breach route after a full save round trip', async ({ request }) => {
    test.setTimeout(60_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null

    try {
      const payload = buildSlaBreachRouteDefinitionPayload(stamp)
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      const readCreated = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token },
      )
      expect(readCreated.status(), 'the created definition reads back').toBe(200)
      const createdBody = await readJsonSafe<{
        data?: { definition?: { transitions?: Array<Record<string, unknown>> } }
      }>(readCreated)
      const createdBreach = (createdBody?.data?.definition?.transitions ?? []).find(
        (transition) => transition.transitionId === 'review-breach',
      )
      expect(createdBreach?.kind, 'the breach route is stored as a breach route').toBe('slaBreach')

      // The Studio's save: write the whole definition body back, exactly as the
      // canvas would after opening it. A `kind` the compiler forgets is dropped
      // right here, with a 200 and no warning.
      const saved = await apiRequest(
        request,
        'PUT',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token, data: { definition: createdBody?.data?.definition } },
      )
      expect(saved.status(), `the save succeeds (got ${saved.status()})`).toBeLessThan(300)

      const readSaved = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
        { token },
      )
      expect(readSaved.status(), 'the saved definition reads back').toBe(200)
      const savedBody = await readJsonSafe<{
        data?: { definition?: { transitions?: Array<Record<string, unknown>> } }
      }>(readSaved)
      const savedTransitions = savedBody?.data?.definition?.transitions ?? []
      const savedBreach = savedTransitions.find(
        (transition) => transition.transitionId === 'review-breach',
      )

      expect(
        savedBreach?.kind,
        'the breach route must NOT be silently downgraded to a normal transition by a save',
      ).toBe('slaBreach')

      // And the routes that never carried a kind must still carry none, so the
      // fix is additive rather than a blanket kind stamp.
      const normalRoute = savedTransitions.find(
        (transition) => transition.transitionId === 'review-to-end',
      )
      expect(normalRoute).toBeTruthy()
      expect(normalRoute?.kind, 'a normal route stays kind-less').toBeUndefined()
    } finally {
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
