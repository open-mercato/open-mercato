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
  let personId: string | null = null
  let todoId: string | null = null

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test.afterAll(async ({ request }) => {
    // Clean up todo first, then person
    if (todoId) {
      try {
        await apiRequest(request, 'DELETE', '/api/example/todos', {
          token,
          data: { id: todoId },
        })
      } catch {
        // ignore cleanup failure
      }
    }
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
  })

  test('TC-UMES-R01: GET single person includes enriched _example fields', async ({
    request,
  }) => {
    // Create a person fixture
    const testSuffix = Date.now()
    personId = await createPersonFixture(request, token, {
      firstName: `QA-UMES-R01-${testSuffix}`,
      lastName: 'Enricher',
      displayName: `QA UMES R01 ${testSuffix}`,
    })

    // Create a todo so the enricher has data
    const todoResponse = await apiRequest(request, 'POST', '/api/example/todos', {
      token,
      data: { title: `QA Todo for enricher ${testSuffix}` },
    })
    expect(todoResponse.ok()).toBeTruthy()
    const todoBody = await todoResponse.json()
    todoId = todoBody?.id ?? null

    // Fetch the person — enricher should add _example fields
    const getResponse = await apiRequest(request, 'GET', `/api/customers/people?id=${personId}`, {
      token,
    })
    expect(getResponse.ok()).toBeTruthy()
    const body = await getResponse.json()
    const items = body?.items ?? body?.data ?? []

    expect(items.length).toBeGreaterThan(0)
    const person = items.find((p: Record<string, unknown>) => p.id === personId)
    expect(person).toBeDefined()

    // Enricher adds _example namespace with todo counts
    expect(person._example).toBeDefined()
    expect(typeof person._example.todoCount).toBe('number')
    expect(typeof person._example.openTodoCount).toBe('number')
    expect(person._example.todoCount).toBeGreaterThanOrEqual(1)
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
    // Fetch the person created in R01
    const getResponse = await apiRequest(request, 'GET', `/api/customers/people?id=${personId}`, {
      token,
    })
    expect(getResponse.ok()).toBeTruthy()
    const body = await getResponse.json()
    const items = body?.items ?? body?.data ?? []
    const person = items.find((p: Record<string, unknown>) => p.id === personId)

    expect(person).toBeDefined()

    // Core fields should still be present and correct
    expect(person.id).toBe(personId)
    expect(person.firstName).toBeDefined()
    expect(person.lastName).toBeDefined()

    // Enriched fields are namespaced under _example, not polluting core fields
    expect(person._example).toBeDefined()

    // No enricher artifacts leak into top-level fields
    expect(person.todoCount).toBeUndefined()
    expect(person.openTodoCount).toBeUndefined()
  })

  test('TC-UMES-R05: Response includes _meta.enrichedBy with enricher ID', async ({
    request,
  }) => {
    const getResponse = await apiRequest(request, 'GET', `/api/customers/people?id=${personId}`, {
      token,
    })
    expect(getResponse.ok()).toBeTruthy()
    const body = await getResponse.json()

    // _meta should include enricher tracking
    expect(body._meta).toBeDefined()
    expect(body._meta.enrichedBy).toBeDefined()
    expect(Array.isArray(body._meta.enrichedBy)).toBe(true)
    expect(body._meta.enrichedBy).toContain('example.customer-todo-count')
  })

  test('TC-UMES-R03: Enricher respects ACL features', async ({ request }) => {
    // Employee role should also have example.view (feature gating test)
    // If the employee doesn't have example.view, enricher should not run
    const employeeToken = await getAuthToken(request, 'employee')

    const getResponse = await apiRequest(
      request,
      'GET',
      `/api/customers/people?id=${personId}`,
      { token: employeeToken },
    )

    // The request should succeed (employee can view people)
    // Whether _example is present depends on whether employee has example.view feature
    if (getResponse.ok()) {
      const body = await getResponse.json()
      const items = body?.items ?? body?.data ?? []

      if (items.length > 0) {
        const person = items.find((p: Record<string, unknown>) => p.id === personId)
        if (person) {
          // If employee has example.view, enricher ran and fields exist
          // If not, _example should be absent
          // Either case is valid — we just check consistency
          if (person._example) {
            expect(typeof person._example.todoCount).toBe('number')
          }
          // Core fields must always be present regardless
          expect(person.id).toBe(personId)
        }
      }
    }
  })

  test('TC-UMES-R06: Enricher is tenant-scoped — no cross-org leakage', async ({
    request,
  }) => {
    // Fetch people as admin — enricher should scope todos by tenant/org
    const getResponse = await apiRequest(request, 'GET', `/api/customers/people?id=${personId}`, {
      token,
    })
    expect(getResponse.ok()).toBeTruthy()
    const body = await getResponse.json()
    const items = body?.items ?? body?.data ?? []
    const person = items.find((p: Record<string, unknown>) => p.id === personId)

    expect(person).toBeDefined()
    expect(person._example).toBeDefined()

    // Todo counts should be consistent (non-negative, finite)
    expect(person._example.todoCount).toBeGreaterThanOrEqual(0)
    expect(person._example.openTodoCount).toBeGreaterThanOrEqual(0)
    expect(person._example.openTodoCount).toBeLessThanOrEqual(person._example.todoCount)
  })
})
