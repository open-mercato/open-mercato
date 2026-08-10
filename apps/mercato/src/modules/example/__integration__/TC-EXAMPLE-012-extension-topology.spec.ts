import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

test.describe('TC-EXAMPLE-012: extension facts and runtime topology', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test('uses a stored nonfallback priority while Todo commands remain callable', async ({ request }) => {
    let personId: string | null = null
    let priorityId: string | null = null
    let todoId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: `QA-TC-EXAMPLE-012-${Date.now()}`,
        lastName: 'Topology',
        displayName: 'QA TC EXAMPLE 012 Topology',
      })
      const priorityResponse = await apiRequest(request, 'POST', '/api/example/customer-priorities', {
        token,
        data: { customerId: personId, priority: 'critical' },
      })
      expect(priorityResponse.ok()).toBeTruthy()
      priorityId = (await priorityResponse.json() as { id?: string }).id ?? null

      const enrichedResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/people?id=${encodeURIComponent(personId)}`,
        { token },
      )
      expect(enrichedResponse.ok()).toBeTruthy()
      const enrichedBody = await enrichedResponse.json() as {
        items?: Array<{ id?: string; _example?: { priority?: string } }>
        _meta?: { enrichedBy?: string[] }
      }
      expect(enrichedBody.items?.find((item) => item.id === personId)?._example?.priority).toBe('critical')
      expect(enrichedBody._meta?.enrichedBy).toContain('example.customer-todo-count')

      const todoResponse = await apiRequest(request, 'POST', '/api/example/todos', {
        token,
        data: { title: `TC-EXAMPLE-012 command ${Date.now()}` },
      })
      expect(todoResponse.ok()).toBeTruthy()
      todoId = (await todoResponse.json() as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()
    } finally {
      await deleteEntityIfExists(request, token, '/api/example/todos', todoId)
      await deleteEntityIfExists(request, token, '/api/example/customer-priorities', priorityId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
