import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { seedPendingActionInDb, deletePendingActionInDb } from './helpers/aiAssistantFixtures'

type CommentList = { items: Array<{ id: string; body: string }> }
type Confirmation = { ok?: boolean; pendingAction?: { status: string }; code?: string }

const actionsPath = '/api/ai_assistant/ai/actions'

test('TC-AI-ACTIONS-CLAIM-011: concurrent confirmation creates exactly one comment', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const { tenantId, organizationId, userId } = getTokenScope(token)
  const marker = `IT exclusive approval ${randomUUID()}`
  const companyId = await createCompanyFixture(request, token, marker)
  let pendingActionId: string | null = null
  try {
    const action = await seedPendingActionInDb({
      tenantId,
      organizationId,
      createdByUserId: userId,
      agentId: 'customers.account_assistant',
      toolName: 'customers.manage_record_comment',
      normalizedInput: { operation: 'create', companyId, body: marker },
    })
    pendingActionId = action.id
    const confirmations = await Promise.all(Array.from({ length: 20 }, () => apiRequest(
      request, 'POST', `${actionsPath}/${action.id}/confirm`, { token, data: {} },
    )))
    const bodies = await Promise.all(confirmations.map((response) => readJsonSafe<Confirmation>(response)))
    for (const [index, response] of confirmations.entries()) {
      expect([200, 409], JSON.stringify(bodies[index])).toContain(response.status())
      if (response.status() === 409) expect(bodies[index]?.code).toBe('invalid_status')
    }
    expect(bodies.some((body) => body?.ok === true)).toBe(true)
    const replay = await apiRequest(request, 'POST', `${actionsPath}/${action.id}/confirm`, { token, data: {} })
    expect(replay.status()).toBe(200)
    expect(await readJsonSafe<Confirmation>(replay)).toMatchObject({ ok: true, pendingAction: { status: 'confirmed' } })
    const comments = await apiRequest(request, 'GET', `/api/customers/comments?entityId=${companyId}`, { token })
    expect(comments.status()).toBe(200)
    const list = await readJsonSafe<CommentList>(comments)
    expect(list?.items.filter((comment) => comment.body === marker)).toHaveLength(1)
  } finally {
    const response = await apiRequest(request, 'GET', `/api/customers/comments?entityId=${companyId}`, { token })
    const comments = await readJsonSafe<CommentList>(response)
    for (const comment of comments?.items ?? []) {
      await deleteEntityIfExists(request, token, '/api/customers/comments', comment.id)
    }
    if (pendingActionId) await deletePendingActionInDb(pendingActionId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
