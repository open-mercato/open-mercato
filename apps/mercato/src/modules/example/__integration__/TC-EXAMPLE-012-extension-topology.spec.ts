import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

export const integrationMeta = {
  dependsOnModules: ['example', 'customers', 'customer_accounts', 'events'],
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

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

  test('bridges a scoped Todo write through the real customer portal SSE endpoint', async ({ request, page, context }) => {
    const { tenantId } = getTokenScope(token)
    const customer = await createCustomerUserFixture(request, token)
    let todoId: string | null = null

    try {
      const session = await portalLogin(request, {
        email: customer.email,
        password: customer.password,
        tenantId,
      })
      await context.addCookies([
        { name: 'customer_auth_token', value: session.authToken, url: BASE_URL, sameSite: 'Lax' },
        { name: 'customer_session_token', value: session.sessionToken, url: BASE_URL, sameSite: 'Lax' },
      ])
      await page.goto('/portal/login', { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => {
        const portalWindow = window as unknown as {
          __examplePortalEvents?: Array<Record<string, unknown>>
          __examplePortalSource?: EventSource
          __examplePortalReady?: boolean
        }
        portalWindow.__examplePortalEvents = []
        const source = new EventSource('/api/customer_accounts/portal/events/stream', { withCredentials: true })
        source.onopen = () => { portalWindow.__examplePortalReady = true }
        source.onmessage = (event) => {
          const payload = JSON.parse(event.data) as Record<string, unknown>
          portalWindow.__examplePortalEvents?.push(payload)
        }
        portalWindow.__examplePortalSource = source
      })
      await expect.poll(() => page.evaluate(() => (
        (window as unknown as { __examplePortalReady?: boolean }).__examplePortalReady === true
      )), { timeout: 10_000 }).toBe(true)

      const title = `TC-EXAMPLE-012 portal ${Date.now()}`
      const created = await apiRequest(request, 'POST', '/api/example/todos', {
        token,
        data: { title, notes: 'staff-only portal exclusion proof' },
      })
      expect(created.ok()).toBeTruthy()
      todoId = (await created.json() as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()

      await expect.poll(() => page.evaluate(() => {
        const events = (window as unknown as {
          __examplePortalEvents?: Array<{ id?: unknown; payload?: unknown }>
        }).__examplePortalEvents ?? []
        return events.find((event) => event.id === 'example.todo_announcement.published') ?? null
      }), { timeout: 10_000 }).not.toBeNull()

      const captured = await page.evaluate(() => {
        const events = (window as unknown as {
          __examplePortalEvents?: Array<{ id?: unknown; payload?: unknown }>
        }).__examplePortalEvents ?? []
        return events.find((event) => event.id === 'example.todo_announcement.published') ?? null
      })
      expect(captured).toMatchObject({
        id: 'example.todo_announcement.published',
        payload: { todoId, action: 'created' },
      })
      expect(JSON.stringify(captured)).not.toContain(title)
      expect(JSON.stringify(captured)).not.toContain('staff-only portal exclusion proof')
    } finally {
      await page.evaluate(() => {
        (window as unknown as { __examplePortalSource?: EventSource }).__examplePortalSource?.close()
      }).catch(() => undefined)
      await deleteEntityIfExists(request, token, '/api/example/todos', todoId)
      await deleteCustomerUserFixture(request, token, customer.id)
    }
  })
})
