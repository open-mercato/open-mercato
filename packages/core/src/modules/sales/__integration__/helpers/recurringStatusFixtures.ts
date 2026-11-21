import { randomUUID } from 'node:crypto'
import { expect, test as base, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type OrderStatus = { id: string; value: string; label: string | null }
type StatusPage = { items: OrderStatus[]; totalPages: number }
type RecurringOrderStatuses = { ensure: (value: string) => Promise<{ id: string; label: string }> }

async function findOrderStatus(request: APIRequestContext, token: string, value: string): Promise<OrderStatus | null> {
  let page = 1
  while (true) {
    const response = await apiRequest(request, 'GET', `/api/sales/order-statuses?search=${encodeURIComponent(value)}&pageSize=100&page=${page}`, { token })
    expect(response.status(), 'Read required order status').toBe(200)
    const body = await readJsonSafe<StatusPage>(response)
    expect(body?.items, 'Order statuses response must contain items').toEqual(expect.any(Array))
    expect(body?.totalPages, 'Order statuses response must contain pagination').toEqual(expect.any(Number))
    const status = body?.items.find((item) => item.value === value)
    if (status) return status
    if (page >= (body?.totalPages ?? 0)) return null
    page += 1
  }
}

export const test = base.extend<{ recurringOrderStatuses: RecurringOrderStatuses }>({
  recurringOrderStatuses: [async ({ request }, use) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    const lockKey = `sales.recurring-status-fixtures:${scope.tenantId}:${scope.organizationId}`
    const createdStatusIds: string[] = []
    const ensure: RecurringOrderStatuses['ensure'] = async (value) => {
      const existing = await findOrderStatus(request, token, value)
      if (existing) return { id: existing.id, label: existing.label ?? existing.value }
      const label = `QA recurring ${value} ${randomUUID()}`
      const response = await apiRequest(request, 'POST', '/api/sales/order-statuses', {
        token,
        data: { value, label },
      })
      if (response.status() === 409) {
        const concurrent = await findOrderStatus(request, token, value)
        expect(concurrent, 'A duplicate status must be readable').not.toBeNull()
        if (!concurrent) throw new Error('[internal] Concurrent order status is unavailable')
        return { id: concurrent.id, label: concurrent.label ?? concurrent.value }
      }
      expect(response.status(), `Create required order status ${value}`).toBe(201)
      const id = expectId((await readJsonSafe<{ id: string }>(response))?.id, 'Created order status ID')
      createdStatusIds.push(id)
      return { id, label }
    }
    await withClient(async (client) => {
      await client.query("set lock_timeout = '240s'")
      await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [lockKey])
      try {
        await use({ ensure })
      } finally {
        try {
          const results = await Promise.allSettled(createdStatusIds.map(async (id) => {
            const response = await apiRequest(request, 'DELETE', `/api/sales/order-statuses?id=${encodeURIComponent(id)}`, { token })
            return response.status()
          }))
          for (const result of results) {
            expect.soft(result.status, 'Created status cleanup request must complete').toBe('fulfilled')
            if (result.status === 'fulfilled') {
              expect.soft([200, 404], 'Delete only the status created by this test').toContain(result.value)
            }
          }
        } finally {
          await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [lockKey])
        }
      }
    })
  }, { timeout: 300_000 }],
})
