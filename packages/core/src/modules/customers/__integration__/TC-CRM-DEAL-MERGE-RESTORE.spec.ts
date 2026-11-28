import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = { dependsOnModules: ['customers', 'audit_logs'] }

test('TC-CRM-DEAL-MERGE-RESTORE: customer undo restores records with only live Deal references', async ({ request }) => {
  skipIfUndoTestsDisabled()
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID()
  const dealsPath = '/api/customers/deals'
  const commentsPath = '/api/customers/comments'
  const interactionsPath = '/api/customers/interactions'
  const mergePath = `${dealsPath}/merge`
  const cleanup: Array<{ path: string; id: string }> = []
  const customers: Array<{ id: string; undoToken: string; detachedComment: string; linkedComment: string; interaction: string }> = []

  const createChild = async (path: string, data: Record<string, unknown>) => {
    const response = await apiRequest(request, 'POST', path, { token, data })
    expect(response.status(), `creating ${path}`).toBe(201)
    const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, path)
    cleanup.push({ path, id })
    return id
  }

  try {
    const survivorId = await createDealFixture(request, token, { title: `Undo survivor ${stamp}`, status: 'open' })
    cleanup.push({ path: dealsPath, id: survivorId })
    const sourceId = await createDealFixture(request, token, { title: `Undo source ${stamp}`, status: 'open' })
    cleanup.push({ path: dealsPath, id: sourceId })

    for (const kind of ['people', 'companies'] as const) {
      const path = `/api/customers/${kind}`
      const id = kind === 'people'
        ? await createPersonFixture(request, token, { firstName: 'Undo', lastName: stamp, displayName: `Undo person ${stamp}` })
        : await createCompanyFixture(request, token, `Undo company ${stamp}`)
      cleanup.push({ path, id })
      const detachedComment = await createChild(commentsPath, { entityId: id, dealId: sourceId, body: 'Source comment' })
      const linkedComment = await createChild(commentsPath, { entityId: id, dealId: survivorId, body: 'Survivor comment' })
      const interaction = await createChild(interactionsPath, {
        entityId: id,
        dealId: sourceId,
        interactionType: 'task',
        title: 'Source task',
        status: 'planned',
        linkedEntities: [
          { type: 'deal', id: sourceId, label: 'Source' },
          { type: 'deal', id: survivorId, label: 'Survivor' },
        ],
      })
      const removed = await apiRequest(request, 'DELETE', `${path}?id=${id}`, { token })
      expect(removed.ok(), `delete ${kind} with attached records`).toBe(true)
      const { undoToken } = expectOperation(removed, `delete ${kind}`)
      customers.push({ id, undoToken, detachedComment, linkedComment, interaction })
    }

    const preview = await apiRequest(request, 'GET', `${mergePath}?left=${survivorId}&right=${sourceId}`, { token })
    expect(preview.status()).toBe(200)
    type PreviewRecord = { updatedAt: string; fields: Record<string, unknown>; customFields: Record<string, unknown> }
    const pair = await readJsonSafe<{ left: PreviewRecord; right: PreviewRecord }>(preview)
    expect(pair?.left.updatedAt).toBeTruthy()
    expect(pair?.right.updatedAt).toBeTruthy()
    const merged = await apiRequest(request, 'POST', mergePath, {
      token,
      data: {
        survivorId,
        sourceId,
        survivorUpdatedAt: pair?.left.updatedAt,
        sourceUpdatedAt: pair?.right.updatedAt,
        values: pair?.left.fields,
        customFields: pair?.left.customFields,
        personIds: [],
        companyIds: [],
        primaryPersonEntityId: null,
      },
    })
    expect(merged.status()).toBe(200)

    for (const customer of customers) {
      await undoOk(request, token, customer.undoToken, `restore customer ${customer.id} after merge`)

      const commentsResponse = await apiRequest(request, 'GET', `${commentsPath}?entityId=${customer.id}&fresh=${randomUUID()}`, { token })
      expect(commentsResponse.status()).toBe(200)
      const comments = await readJsonSafe<{ items: Array<{ id: string; deal_id: string | null }> }>(commentsResponse)
      expect(comments?.items.find((item) => item.id === customer.detachedComment)).toMatchObject({ deal_id: null })
      expect(comments?.items.find((item) => item.id === customer.linkedComment)).toMatchObject({ deal_id: survivorId })

      const interactionsResponse = await apiRequest(request, 'GET', `${interactionsPath}?entityId=${customer.id}&fresh=${randomUUID()}`, { token })
      expect(interactionsResponse.status()).toBe(200)
      const interactions = await readJsonSafe<{ items: Array<{ id: string; dealId: string | null; linkedEntities: unknown }> }>(interactionsResponse)
      expect(interactions?.items.find((item) => item.id === customer.interaction)).toMatchObject({
        dealId: null,
        linkedEntities: [{ type: 'deal', id: survivorId, label: 'Survivor' }],
      })
    }
  } finally {
    for (const { path, id } of cleanup.reverse()) await deleteEntityIfExists(request, token, path, id)
  }
})
