import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectOperation,
  undoOk,
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 customers.interactions (#2572).
 *
 * Covers the interaction relation entity (create→undo I3/I5, update→undo→redo I1/I6,
 * delete→undo I2) plus the status-flip action commands `.complete` / `.cancel`: completing
 * or cancelling a planned interaction and undoing it must revert the status back to its
 * pre-action value. Each test is self-contained around its own parent person.
 */

const INTERACTIONS = '/api/customers/interactions'

async function readInteractionStatus(
  request: APIRequestContext,
  token: string,
  personId: string,
  interactionId: string,
): Promise<string | undefined> {
  const res = await apiRequest(request, 'GET', `${INTERACTIONS}?entityId=${encodeURIComponent(personId)}&limit=100`, { token })
  const body = (await readJsonSafe(res)) as { items?: Array<{ id: string; status?: string }> } | null
  return body?.items?.find((item) => item.id === interactionId)?.status
}

test.describe('TC-UNDO-001 customers.interactions undo/redo', () => {
  test.setTimeout(120_000)

  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('interaction CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `InteractionParent ${stamp}`,
        displayName: `Undo InteractionParent ${stamp}`,
      })

      await runCrudUndoRoundTrip(request, token, {
        label: 'customers.interactions',
        collectionPath: INTERACTIONS,
        readPath: () => `${INTERACTIONS}?entityId=${encodeURIComponent(personId as string)}&limit=100`,
        field: 'title',
        createPayload: (s) => ({
          entityId: personId,
          interactionType: 'note',
          title: `Undo Interaction ${s}`,
        }),
        updatePayload: (id, s) => ({
          id,
          title: `Undo Interaction Changed ${s}`,
        }),
      })
    } finally {
      // The harness deletes the interactions it created; the test owns only the parent person.
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('complete → undo reverts status from done back to planned', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let interactionId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `Complete ${stamp}`,
        displayName: `Undo Complete ${stamp}`,
      })
      const createRes = await apiRequest(request, 'POST', INTERACTIONS, {
        token,
        data: { entityId: personId, interactionType: 'task', title: `Complete me ${stamp}`, status: 'planned' },
      })
      expect(createRes.status(), `interaction create status ${createRes.status()}`).toBe(201)
      interactionId = expectOperation(createRes, 'interactions.create').resourceId
      expect(await readInteractionStatus(request, token, personId, interactionId as string), 'starts planned').toBe('planned')

      const completeRes = await apiRequest(request, 'POST', `${INTERACTIONS}/complete`, { token, data: { id: interactionId } })
      expect(completeRes.ok(), `complete status ${completeRes.status()}`).toBeTruthy()
      const completeOp = expectOperation(completeRes, 'interactions.complete')
      expect(await readInteractionStatus(request, token, personId, interactionId as string), 'done after complete').toBe('done')

      await undoOk(request, token, completeOp.undoToken, 'undo interaction complete')
      expect(await readInteractionStatus(request, token, personId, interactionId as string), 'status reverted to planned (I1)').toBe('planned')
    } finally {
      await deleteEntityIfExists(request, token, INTERACTIONS, interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('cancel → undo reverts status from canceled back to planned', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let interactionId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `Cancel ${stamp}`,
        displayName: `Undo Cancel ${stamp}`,
      })
      const createRes = await apiRequest(request, 'POST', INTERACTIONS, {
        token,
        data: { entityId: personId, interactionType: 'task', title: `Cancel me ${stamp}`, status: 'planned' },
      })
      expect(createRes.status(), `interaction create status ${createRes.status()}`).toBe(201)
      interactionId = expectOperation(createRes, 'interactions.create').resourceId
      expect(await readInteractionStatus(request, token, personId, interactionId as string), 'starts planned').toBe('planned')

      const cancelRes = await apiRequest(request, 'POST', `${INTERACTIONS}/cancel`, { token, data: { id: interactionId } })
      expect(cancelRes.ok(), `cancel status ${cancelRes.status()}`).toBeTruthy()
      const cancelOp = expectOperation(cancelRes, 'interactions.cancel')
      expect(await readInteractionStatus(request, token, personId, interactionId as string), 'canceled after cancel').toBe('canceled')

      await undoOk(request, token, cancelOp.undoToken, 'undo interaction cancel')
      expect(await readInteractionStatus(request, token, personId, interactionId as string), 'status reverted to planned (I1)').toBe('planned')
    } finally {
      await deleteEntityIfExists(request, token, INTERACTIONS, interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
