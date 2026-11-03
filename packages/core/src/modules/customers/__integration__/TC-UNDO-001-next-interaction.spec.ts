import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  undoOk,
  redoOk,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 (customers.people / customers.companies) — undo and redo of a customer whose
 * next-interaction projection is set (#6336).
 *
 * A planned interaction with `scheduledAt` fills `customer_entities.next_interaction_at`. The undo
 * snapshot round-trips through jsonb, so the date comes back as an ISO string; assigning it to the
 * entity used to fail the undo with 400, which made deleting such a customer irreversible.
 */

type Kind = 'person' | 'company'

const PATHS: Record<Kind, string> = {
  person: '/api/customers/people',
  company: '/api/customers/companies',
}

const INTERACTIONS = '/api/customers/interactions'

function createPayload(kind: Kind, label: string, extra: Record<string, unknown> = {}) {
  return kind === 'person'
    ? { firstName: 'Undo', lastName: label, displayName: `Undo ${label}`, ...extra }
    : { displayName: `Undo ${label}`, ...extra }
}

async function getRecord(request: APIRequestContext, token: string, kind: Kind, id: string) {
  const res = await apiRequest(request, 'GET', `${PATHS[kind]}/${id}`, { token })
  const body = (await readJsonSafe(res)) as Record<string, Record<string, unknown> | undefined> | null
  return { status: res.status(), record: body?.[kind] }
}

async function createRecord(request: APIRequestContext, token: string, kind: Kind, label: string) {
  const res = await apiRequest(request, 'POST', PATHS[kind], { token, data: createPayload(kind, label) })
  expect(res.status(), `create ${kind}`).toBe(201)
  return expectOperation(res, `${kind}.create`).resourceId as string
}

async function schedulePlannedCall(request: APIRequestContext, token: string, entityId: string, stamp: number) {
  const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
  const res = await apiRequest(request, 'POST', INTERACTIONS, {
    token,
    data: { entityId, interactionType: 'call', title: `Follow-up ${stamp}`, status: 'planned', scheduledAt },
  })
  expect(res.status(), 'create planned call').toBe(201)
  const body = (await readJsonSafe(res)) as { id?: string } | null
  expect(body?.id, 'planned call id').toBeTruthy()
  return body!.id as string
}

async function listInteractionIds(request: APIRequestContext, token: string, entityId: string) {
  const res = await apiRequest(request, 'GET', `${INTERACTIONS}?entityId=${entityId}&pageSize=50`, { token })
  expect(res.ok(), 'list interactions').toBeTruthy()
  const body = (await readJsonSafe(res)) as { items?: Array<{ id?: string }> } | null
  return (body?.items ?? []).map((item) => item.id)
}

test.describe('TC-UNDO-001 customers next-interaction projection undo/redo (#6336)', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  for (const kind of ['person', 'company'] as const) {
    test(`${kind}: delete → undo restores the record and its upcoming interaction`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      let recordId: string | null = null
      try {
        recordId = await createRecord(request, token, kind, `NextDelete ${stamp}`)
        const interactionId = await schedulePlannedCall(request, token, recordId, stamp)
        const before = await getRecord(request, token, kind, recordId)
        expect(before.record?.nextInteractionAt, 'projection set by the planned call').toBeTruthy()

        const deleteRes = await apiRequest(request, 'DELETE', `${PATHS[kind]}?id=${recordId}`, { token })
        expect(deleteRes.ok(), `delete status ${deleteRes.status()}`).toBeTruthy()
        const deleteOp = expectOperation(deleteRes, `${kind}.delete`)
        expect((await getRecord(request, token, kind, recordId)).status, 'gone after delete').not.toBe(200)

        await undoOk(request, token, deleteOp.undoToken, `undo delete ${kind}`)
        const after = await getRecord(request, token, kind, recordId)
        expect(after.status, 're-materialized after undo').toBe(200)
        expect(after.record?.displayName).toBe(before.record?.displayName)
        expect(after.record?.nextInteractionAt, 'projection restored to the same instant').toBe(before.record?.nextInteractionAt)
        expect(after.record?.nextInteractionRefId).toBe(interactionId)
        expect(await listInteractionIds(request, token, recordId), 'planned call restored').toContain(interactionId)
      } finally {
        if (recordId) await apiRequest(request, 'DELETE', `${PATHS[kind]}?id=${recordId}`, { token }).catch(() => {})
      }
    })

    test(`${kind}: update → undo reverts the edit when an interaction is scheduled`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      let recordId: string | null = null
      try {
        recordId = await createRecord(request, token, kind, `NextUpdate ${stamp}`)
        await schedulePlannedCall(request, token, recordId, stamp)
        const before = await getRecord(request, token, kind, recordId)
        expect(before.record?.nextInteractionAt, 'projection set by the planned call').toBeTruthy()

        const updateRes = await apiRequest(request, 'PUT', PATHS[kind], {
          token,
          data: { id: recordId, displayName: `Undo NextUpdate CHANGED ${stamp}` },
        })
        expect(updateRes.ok(), `update status ${updateRes.status()}`).toBeTruthy()
        const updateOp = expectOperation(updateRes, `${kind}.update`)

        await undoOk(request, token, updateOp.undoToken, `undo update ${kind}`)
        const after = await getRecord(request, token, kind, recordId)
        expect(after.record?.displayName, 'displayName restored').toBe(before.record?.displayName)
        expect(after.record?.nextInteractionAt, 'projection unchanged').toBe(before.record?.nextInteractionAt)
      } finally {
        if (recordId) await apiRequest(request, 'DELETE', `${PATHS[kind]}?id=${recordId}`, { token }).catch(() => {})
      }
    })
  }

  test('company: create with a next interaction → undo → redo restores the next interaction', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const nextAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    nextAt.setUTCMilliseconds(0)
    let recordId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', PATHS.company, {
        token,
        data: createPayload('company', `NextRedo ${stamp}`, { nextInteraction: { at: nextAt.toISOString(), name: 'Kick-off call' } }),
      })
      expect(createRes.status(), 'create company').toBe(201)
      const createOp = expectOperation(createRes, 'company.create')
      recordId = createOp.resourceId as string
      expect((await getRecord(request, token, 'company', recordId)).record?.nextInteractionAt).toBe(nextAt.toISOString())

      await undoOk(request, token, createOp.undoToken, 'undo create company')
      expect((await getRecord(request, token, 'company', recordId)).status, 'gone after undo create').not.toBe(200)

      await redoOk(request, token, createOp.logId, 'redo create company')
      const after = await getRecord(request, token, 'company', recordId)
      expect(after.status, 're-created by redo').toBe(200)
      expect(after.record?.nextInteractionAt, 'next interaction restored by redo').toBe(nextAt.toISOString())
      expect(after.record?.nextInteractionName).toBe('Kick-off call')
    } finally {
      if (recordId) await apiRequest(request, 'DELETE', `${PATHS.company}?id=${recordId}`, { token }).catch(() => {})
    }
  })
})
