import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = { dependsOnModules: ['customers', 'audit_logs'] }

type Interaction = { id: string; scheduledAt: string | null; timezone: string | null }

const INTERACTIONS_PATH = '/api/customers/interactions'
const SCHEDULED_AT = '2026-10-21T22:30:00.000Z'

async function readInteractions(request: APIRequestContext, token: string, entityId: string): Promise<Interaction[]> {
  const response = await apiRequest(request, 'GET', `${INTERACTIONS_PATH}?entityId=${encodeURIComponent(entityId)}&pageSize=100`, { token })
  expect(response.status(), await response.text()).toBe(200)
  const payload = await readJsonSafe<{ items: Interaction[] }>(response)
  expect(payload?.items).toBeDefined()
  return payload!.items
}

test.describe('TC-CRM-7313: parent delete undo preserves interaction timezones', () => {
  test.beforeAll(() => skipIfUndoTestsDisabled())

  for (const { kind, interactionType } of [
    { kind: 'person', interactionType: 'meeting' },
    { kind: 'company', interactionType: 'call' },
  ] as const) {
    test(`${kind} delete → undo → redo → undo preserves its ${interactionType} timezone`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const parentPath = `/api/customers/${kind === 'person' ? 'people' : 'companies'}`
      const stamp = `${Date.now()}-${test.info().workerIndex}`
      let parentId: string | null = null
      const interactionIds: string[] = []
      try {
        parentId = kind === 'person'
          ? await createPersonFixture(request, token, { firstName: 'Timezone', lastName: stamp, displayName: `Timezone Person ${stamp}` })
          : await createCompanyFixture(request, token, `Timezone Company ${stamp}`)

        for (const timezone of ['Australia/Sydney', null]) {
          const response = await apiRequest(request, 'POST', INTERACTIONS_PATH, {
            token,
            data: {
              entityId: parentId,
              interactionType,
              title: `Timezone ${timezone ?? 'unset'} ${stamp}`,
              status: 'planned',
              scheduledAt: SCHEDULED_AT,
              timezone,
            },
          })
          expect(response.status(), await response.text()).toBe(201)
          const payload = await readJsonSafe<{ id: string }>(response)
          expect(payload?.id).toBeTruthy()
          interactionIds.push(payload!.id)
        }
        const expectedInteractions = [
          { id: interactionIds[0], scheduledAt: SCHEDULED_AT, timezone: 'Australia/Sydney' },
          { id: interactionIds[1], scheduledAt: SCHEDULED_AT, timezone: null },
        ]
        expect(await readInteractions(request, token, parentId)).toEqual(expect.arrayContaining(expectedInteractions.map((interaction) => expect.objectContaining(interaction))))

        const deleteResponse = await apiRequest(request, 'DELETE', `${parentPath}?id=${encodeURIComponent(parentId)}`, { token })
        expect(deleteResponse.status(), await deleteResponse.text()).toBe(200)
        const operation = expectOperation(deleteResponse, `${kind}.delete`)
        await undoOk(request, token, operation.undoToken, `${kind} delete undo`)
        expect(await readInteractions(request, token, parentId)).toEqual(expect.arrayContaining(expectedInteractions.map((interaction) => expect.objectContaining(interaction))))

        const redo = await redoOk(request, token, operation.logId, `${kind} delete redo`)
        expect(redo.undoToken).toBeTruthy()
        await undoOk(request, token, redo.undoToken!, `${kind} redo undo`)
        expect(await readInteractions(request, token, parentId)).toEqual(expect.arrayContaining(expectedInteractions.map((interaction) => expect.objectContaining(interaction))))
      } finally {
        for (const interactionId of interactionIds) await deleteEntityIfExists(request, token, INTERACTIONS_PATH, interactionId)
        await deleteEntityIfExists(request, token, parentPath, parentId)
      }
    })
  }
})
