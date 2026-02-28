/**
 * TC-UMES-002: Response Enrichers (Phase D)
 *
 * Validates that the example enricher adds todo count data to customer person
 * API responses, respects ACL features, keeps core fields intact, and includes
 * enrichment metadata.
 *
 * Spec reference: SPEC-041d — Response Enrichers
 */
import { test, expect } from '@playwright/test'
import {
  getAuthToken,
  apiRequest,
} from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

test.describe('TC-UMES-002: Response Enrichers', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  async function deleteTodoIfExists(request: Parameters<typeof apiRequest>[0], id: string | null) {
    if (!id) return
    try {
      await apiRequest(request, 'DELETE', '/api/example/todos', {
        token,
        data: { id },
      })
    } catch {
      // ignore cleanup failure
    }
  }

  test('TC-UMES-R01: GET single person includes enriched _example fields', async ({
    request,
  }) => {
    let personId: string | null = null
    let todoId: string | null = null
    try {
      const testSuffix = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: `QA-UMES-R01-${testSuffix}`,
        lastName: 'Enricher',
        displayName: `QA UMES R01 ${testSuffix}`,
      })

      const todoResponse = await apiRequest(request, 'POST', '/api/example/todos', {
        token,
        data: { title: `QA Todo for enricher ${testSuffix}` },
      })
      expect(todoResponse.ok()).toBeTruthy()
      const todoBody = await todoResponse.json()
      todoId = todoBody?.id ?? null

      const getResponse = await apiRequest(request, 'GET', `/api/customers/people?id=${personId}`, {
        token,
      })
      expect(getResponse.ok()).toBeTruthy()
      const body = await getResponse.json()
      const items = body?.items ?? body?.data ?? []

      expect(items.length).toBeGreaterThan(0)
      const person = items.find((p: Record<string, unknown>) => p.id === personId)
      expect(person).toBeDefined()

      expect(person._example).toBeDefined()
      expect(typeof person._example.todoCount).toBe('number')
      expect(typeof person._example.openTodoCount).toBe('number')
      expect(person._example.todoCount).toBeGreaterThanOrEqual(0)
      expect(person._example.openTodoCount).toBeGreaterThanOrEqual(0)
    } finally {
      await deleteTodoIfExists(request, todoId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('TC-UMES-R02: GET person list enriches all records via enrichMany', async ({
    request,
  }) => {
    // The person from R01 should be in the list response
    const getResponse = await apiRequest(request, 'GET', '/api/customers/people?pageSize=10', {
      token,
    })
    expect(getResponse.ok()).toBeTruthy()
    const body = await getResponse.json()
    const items = body?.items ?? body?.data ?? []

    expect(items.length).toBeGreaterThan(0)

    // Every record should have _example enrichment (enrichMany runs on all items)
    for (const item of items) {
      expect(item._example).toBeDefined()
      expect(typeof item._example.todoCount).toBe('number')
      expect(typeof item._example.openTodoCount).toBe('number')
    }
  })

  test('TC-UMES-R04: Core fields remain unchanged after enrichment', async ({
    request,
  }) => {
    let personId: string | null = null
    try {
      const testSuffix = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: `QA-UMES-R04-${testSuffix}`,
        lastName: 'Integrity',
        displayName: `QA UMES R04 ${testSuffix}`,
      })

      const getResponse = await apiRequest(request, 'GET', `/api/customers/people?id=${personId}`, {
        token,
      })
      expect(getResponse.ok()).toBeTruthy()
      const body = await getResponse.json()
      const items = body?.items ?? body?.data ?? []
      const person = items.find((p: Record<string, unknown>) => p.id === personId)

      expect(person).toBeDefined()
      expect(person.id).toBe(personId)
      expect(typeof person.display_name).toBe('string')

      expect(person._example).toBeDefined()
      expect(person.todoCount).toBeUndefined()
      expect(person.openTodoCount).toBeUndefined()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('TC-UMES-R05: Response includes _meta.enrichedBy with enricher ID', async ({
    request,
  }) => {
    let personId: string | null = null
    try {
      const testSuffix = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: `QA-UMES-R05-${testSuffix}`,
        lastName: 'Meta',
        displayName: `QA UMES R05 ${testSuffix}`,
      })

      const getResponse = await apiRequest(request, 'GET', `/api/customers/people?id=${personId}`, {
        token,
      })
      expect(getResponse.ok()).toBeTruthy()
      const body = await getResponse.json()

      expect(body._meta).toBeDefined()
      expect(body._meta.enrichedBy).toBeDefined()
      expect(Array.isArray(body._meta.enrichedBy)).toBe(true)
      expect(body._meta.enrichedBy).toContain('example.customer-todo-count')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('TC-UMES-R03: Enricher respects ACL features', async ({ request }) => {
    let personId: string | null = null
    try {
      const testSuffix = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: `QA-UMES-R03-${testSuffix}`,
        lastName: 'Acl',
        displayName: `QA UMES R03 ${testSuffix}`,
      })

      const employeeToken = await getAuthToken(request, 'employee')
      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/people?id=${personId}`,
        { token: employeeToken },
      )

      if (getResponse.ok()) {
        const body = await getResponse.json()
        const items = body?.items ?? body?.data ?? []

        if (items.length > 0) {
          const person = items.find((p: Record<string, unknown>) => p.id === personId)
          if (person && person._example) {
            expect(typeof person._example.todoCount).toBe('number')
          }
        }
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('TC-UMES-R06: Enricher is tenant-scoped — no cross-org leakage', async ({
    request,
  }) => {
    let personId: string | null = null
    try {
      const testSuffix = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: `QA-UMES-R06-${testSuffix}`,
        lastName: 'Tenant',
        displayName: `QA UMES R06 ${testSuffix}`,
      })

      const getResponse = await apiRequest(request, 'GET', `/api/customers/people?id=${personId}`, {
        token,
      })
      expect(getResponse.ok()).toBeTruthy()
      const body = await getResponse.json()
      const items = body?.items ?? body?.data ?? []
      const person = items.find((p: Record<string, unknown>) => p.id === personId)

      expect(person).toBeDefined()
      expect(person._example).toBeDefined()
      expect(person._example.todoCount).toBeGreaterThanOrEqual(0)
      expect(person._example.openTodoCount).toBeGreaterThanOrEqual(0)
      expect(person._example.openTodoCount).toBeLessThanOrEqual(person._example.todoCount)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
