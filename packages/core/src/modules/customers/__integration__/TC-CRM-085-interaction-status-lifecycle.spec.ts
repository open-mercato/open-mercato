import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-085: Interaction status lifecycle + open-set semantics.
 *
 * Spec: .ai/specs/2026-06-18-configurable-crm-interaction-statuses.md
 *   - POST/PUT /api/customers/interactions accepts and reads back `in_progress`
 *     and an arbitrary custom status (lenient `z.string().max(50)` validator).
 *   - POST /api/customers/interactions/complete -> `done`; /cancel -> `canceled`.
 *   - GET /api/customers/interactions/counts `open` bucket includes a non-terminal
 *     `in_progress` row; `planned` is the BC alias for that open bucket; the
 *     `done` bucket excludes it.
 */
async function createInteraction(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/customers/interactions', { token, data })
  expect(res.ok(), `POST /api/customers/interactions returned ${res.status()}`).toBeTruthy()
  const body = (await res.json().catch(() => null)) as { id?: string } | null
  expect(body?.id, 'interaction create should expose an id').toBeTruthy()
  return body!.id as string
}

async function readStatus(
  request: APIRequestContext,
  token: string,
  entityId: string,
  interactionId: string,
): Promise<string | null> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/customers/interactions?entityId=${entityId}&limit=100`,
    { token },
  )
  expect(res.ok(), `GET /api/customers/interactions returned ${res.status()}`).toBeTruthy()
  const body = (await res.json().catch(() => null)) as { items?: Array<{ id?: string; status?: string | null }> } | null
  const match = (body?.items ?? []).find((item) => item.id === interactionId)
  return match?.status ?? null
}

test.describe('TC-CRM-085: Interaction status lifecycle', () => {
  test('accepts and reads back in_progress and a custom status', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let companyId: string | null = null
    const interactionIds: string[] = []
    const stamp = Date.now()

    try {
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-085a ${stamp}`)

      const inProgressId = await createInteraction(request, token, {
        entityId: companyId,
        interactionType: 'task',
        title: `QA in_progress ${stamp}`,
        status: 'in_progress',
      })
      interactionIds.push(inProgressId)
      expect(await readStatus(request, token, companyId, inProgressId)).toBe('in_progress')

      const customId = await createInteraction(request, token, {
        entityId: companyId,
        interactionType: 'task',
        title: `QA custom ${stamp}`,
        status: 'blocked_by_legal',
      })
      interactionIds.push(customId)
      expect(await readStatus(request, token, companyId, customId)).toBe('blocked_by_legal')
    } finally {
      for (const id of interactionIds) await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('complete -> done and cancel -> canceled', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let companyId: string | null = null
    const interactionIds: string[] = []
    const stamp = Date.now()

    try {
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-085b ${stamp}`)

      const toComplete = await createInteraction(request, token, {
        entityId: companyId,
        interactionType: 'task',
        title: `QA complete ${stamp}`,
        status: 'in_progress',
      })
      interactionIds.push(toComplete)
      const completeRes = await apiRequest(request, 'POST', '/api/customers/interactions/complete', {
        token,
        data: { id: toComplete },
      })
      expect(completeRes.ok(), `complete returned ${completeRes.status()}`).toBeTruthy()
      expect(await readStatus(request, token, companyId, toComplete)).toBe('done')

      const toCancel = await createInteraction(request, token, {
        entityId: companyId,
        interactionType: 'task',
        title: `QA cancel ${stamp}`,
        status: 'waiting',
      })
      interactionIds.push(toCancel)
      const cancelRes = await apiRequest(request, 'POST', '/api/customers/interactions/cancel', {
        token,
        data: { id: toCancel },
      })
      expect(cancelRes.ok(), `cancel returned ${cancelRes.status()}`).toBeTruthy()
      expect(await readStatus(request, token, companyId, toCancel)).toBe('canceled')
    } finally {
      for (const id of interactionIds) await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('counts open bucket includes an in_progress task; done bucket excludes it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()

    try {
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-085c ${stamp}`)
      interactionId = await createInteraction(request, token, {
        entityId: companyId,
        interactionType: 'task',
        title: `QA counts ${stamp}`,
        status: 'in_progress',
      })

      const openRes = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions/counts?entityId=${companyId}&status=open`,
        { token },
      )
      expect(openRes.ok(), `counts?status=open returned ${openRes.status()}`).toBeTruthy()
      const openBody = (await openRes.json().catch(() => null)) as { result?: { task?: number } } | null
      expect(openBody?.result?.task ?? 0, 'open bucket MUST include the in_progress task').toBeGreaterThanOrEqual(1)

      const plannedAliasRes = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions/counts?entityId=${companyId}&status=planned`,
        { token },
      )
      expect(plannedAliasRes.ok(), `counts?status=planned returned ${plannedAliasRes.status()}`).toBeTruthy()
      const plannedAliasBody = (await plannedAliasRes.json().catch(() => null)) as { result?: { task?: number } } | null
      expect(
        plannedAliasBody?.result?.task ?? 0,
        'planned alias MUST include the in_progress task as part of the open bucket',
      ).toBeGreaterThanOrEqual(1)

      const doneRes = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions/counts?entityId=${companyId}&status=done`,
        { token },
      )
      expect(doneRes.ok(), `counts?status=done returned ${doneRes.status()}`).toBeTruthy()
      const doneBody = (await doneRes.json().catch(() => null)) as { result?: { task?: number } } | null
      expect(doneBody?.result?.task ?? 0, 'done bucket MUST exclude the in_progress task').toBe(0)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
