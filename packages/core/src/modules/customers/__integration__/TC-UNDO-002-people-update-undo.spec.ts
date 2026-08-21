import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { skipIfUndoTestsDisabled } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-002 — Regression for issue #2498: `customers.people.update` undo silently did nothing.
 *
 * With tenant encryption ON, the update command mutated the entity scalars and then loaded the
 * related encrypted person profile before flushing. The profile's deep-decrypt traversed back into
 * the still-dirty entity and re-baselined its change tracking, so the final flush issued no UPDATE —
 * undo returned `{ok:true}` but restored nothing. This drives the real command bus + undo endpoint
 * and asserts the prior scalars (displayName, primaryEmail) are actually restored.
 *
 * Self-contained: creates its own person and deletes it in teardown; depends on no seeded data.
 */

const PEOPLE = '/api/customers/people'
const UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo'
const HEADER_PREFIX = 'omop:'

type Operation = { logId: string; undoToken: string; commandId: string; resourceId: string | null }

function expectOperation(response: APIResponse, context: string): Operation {
  const header = response.headers()['x-om-operation']
  expect(header, `Expected an undo token (x-om-operation header) for ${context}, got none`).toBeTruthy()
  const raw = String(header)
  const trimmed = raw.startsWith(HEADER_PREFIX) ? raw.slice(HEADER_PREFIX.length) : raw
  const parsed = JSON.parse(decodeURIComponent(trimmed)) as Record<string, unknown>
  expect(typeof parsed.undoToken === 'string' && parsed.undoToken, `undoToken missing for ${context}`).toBeTruthy()
  return {
    logId: String(parsed.id),
    undoToken: String(parsed.undoToken),
    commandId: String(parsed.commandId),
    resourceId: (parsed.resourceId as string) ?? null,
  }
}

async function getPerson(request: APIRequestContext, token: string, id: string) {
  const res = await apiRequest(request, 'GET', `${PEOPLE}/${id}`, { token })
  return { status: res.status(), body: (await readJsonSafe(res)) as any }
}

async function undoOk(request: APIRequestContext, token: string, undoToken: string, context: string) {
  const res = await apiRequest(request, 'POST', UNDO_PATH, { token, data: { undoToken } })
  const body = (await readJsonSafe(res)) as { ok?: boolean } | null
  expect(res.ok(), `Undo request failed for ${context}: status ${res.status()} body ${JSON.stringify(body)}`).toBeTruthy()
  expect(body?.ok, `Undo not ok for ${context}: ${JSON.stringify(body)}`).toBeTruthy()
}

test.describe('TC-UNDO-002 customers.people.update undo restores scalars (#2498)', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('update → undo restores displayName and primaryEmail', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      const beforeEmail = `before-${stamp}@example.com`
      const beforeDisplay = `Undo Update ${stamp}`
      const createRes = await apiRequest(request, 'POST', PEOPLE, {
        token,
        data: { firstName: 'Undo', lastName: `Update ${stamp}`, displayName: beforeDisplay, primaryEmail: beforeEmail },
      })
      expect(createRes.ok(), `create status ${createRes.status()}`).toBeTruthy()
      personId = expectOperation(createRes, 'customers.people.create').resourceId
      expect(personId, 'create should yield a resource id').toBeTruthy()

      const beforeState = await getPerson(request, token, personId as string)
      expect(beforeState.status, 'person exists after create').toBe(200)
      expect(beforeState.body?.person?.displayName).toBe(beforeDisplay)
      expect(beforeState.body?.person?.primaryEmail).toBe(beforeEmail)

      const afterEmail = `after-${stamp}@example.com`
      const afterDisplay = `Undo Update CHANGED ${stamp}`
      const updateRes = await apiRequest(request, 'PUT', PEOPLE, {
        token,
        data: { id: personId, displayName: afterDisplay, primaryEmail: afterEmail },
      })
      expect(updateRes.ok(), `update status ${updateRes.status()}`).toBeTruthy()
      const updateOp = expectOperation(updateRes, 'customers.people.update')

      const changed = await getPerson(request, token, personId as string)
      expect(changed.body?.person?.displayName, 'displayName changed before undo').toBe(afterDisplay)
      expect(changed.body?.person?.primaryEmail, 'primaryEmail changed before undo').toBe(afterEmail)

      await undoOk(request, token, updateOp.undoToken, 'undo people.update')

      const afterUndo = await getPerson(request, token, personId as string)
      expect(afterUndo.status, 'person still present after undo').toBe(200)
      // Core assertion for #2498: the undo must actually restore the prior scalar values.
      expect(afterUndo.body?.person?.displayName, 'displayName restored after undo (#2498)').toBe(beforeDisplay)
      expect(afterUndo.body?.person?.primaryEmail, 'primaryEmail restored after undo (#2498)').toBe(beforeEmail)
    } finally {
      if (personId) await apiRequest(request, 'DELETE', `${PEOPLE}?id=${personId}`, { token }).catch(() => {})
    }
  })
})
