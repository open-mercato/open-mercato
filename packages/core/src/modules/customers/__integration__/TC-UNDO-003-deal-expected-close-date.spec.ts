import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-003 — Regression for deal update undo with JSON-serialized Date snapshots.
 *
 * Action log payloads are persisted as JSON, so CustomerDeal.expectedCloseAt is read back
 * as an ISO string during undo. Undo must coerce that string to Date before assigning it
 * to MikroORM's Date property, otherwise the undo endpoint returns "Undo failed".
 */

const DEALS = '/api/customers/deals'

function findStringByKeys(value: unknown, keys: readonly string[]): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) continue
    const found = findStringByKeys(nested, keys)
    if (found) return found
  }
  return null
}

async function getDeal(request: APIRequestContext, token: string, id: string): Promise<Record<string, unknown>> {
  const res = await apiRequest(request, 'GET', `${DEALS}/${id}`, { token })
  const body = (await readJsonSafe(res)) as Record<string, unknown> | null
  expect(res.ok(), `GET deal ${id} failed: status ${res.status()} body ${JSON.stringify(body)}`).toBeTruthy()
  const deal = body?.deal ?? body
  expect(deal && typeof deal === 'object', `GET deal ${id} should return a deal object`).toBeTruthy()
  return deal as Record<string, unknown>
}

test.describe('TC-UNDO-003 customers.deals.update undo restores expectedCloseAt', () => {
  test('update expectedCloseAt → undo restores the prior date from the audit-log snapshot', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const beforeCloseAt = '2026-07-20T12:00:00.000Z'
    const afterCloseAt = '2026-08-15T09:30:00.000Z'
    let dealId: string | null = null

    try {
      const createRes = await apiRequest(request, 'POST', DEALS, {
        token,
        data: {
          title: `Undo Date Deal ${stamp}`,
          expectedCloseAt: beforeCloseAt,
          valueAmount: 1250,
          valueCurrency: 'USD',
        },
      })
      const createBody = await readJsonSafe(createRes)
      expect(createRes.ok(), `create deal failed: status ${createRes.status()} body ${JSON.stringify(createBody)}`).toBeTruthy()
      const createOp = expectOperation(createRes, 'customers.deals.create')
      dealId = createOp.resourceId ?? findStringByKeys(createBody, ['dealId', 'id', 'entityId'])
      expect(dealId, 'create should yield a deal resource id').toBeTruthy()

      const beforeState = await getDeal(request, token, dealId as string)
      expect(beforeState.expectedCloseAt, 'deal expectedCloseAt after create').toBe(beforeCloseAt)

      const updateRes = await apiRequest(request, 'PUT', DEALS, {
        token,
        data: {
          id: dealId,
          expectedCloseAt: afterCloseAt,
        },
      })
      const updateBody = await readJsonSafe(updateRes)
      expect(updateRes.ok(), `update deal failed: status ${updateRes.status()} body ${JSON.stringify(updateBody)}`).toBeTruthy()
      const updateOp = expectOperation(updateRes, 'customers.deals.update')

      const changedState = await getDeal(request, token, dealId as string)
      expect(changedState.expectedCloseAt, 'deal expectedCloseAt changed before undo').toBe(afterCloseAt)

      await undoOk(request, token, updateOp.undoToken, 'undo customers.deals.update expectedCloseAt')

      const afterUndo = await getDeal(request, token, dealId as string)
      expect(afterUndo.expectedCloseAt, 'deal expectedCloseAt restored after undo').toBe(beforeCloseAt)
    } finally {
      if (dealId) {
        await apiRequest(request, 'DELETE', `${DEALS}?id=${encodeURIComponent(dealId)}`, { token }).catch(() => {})
      }
    }
  })
})
