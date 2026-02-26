import { test, expect } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type PriorityListResponse = {
  items?: Array<{ id: string; priority?: string }>
  data?: Array<{ id: string; priority?: string }>
}

test.describe('TC-UMES-004: Phase E-H completion', () => {
  let adminToken = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
  })

  test('TC-UMES-I01/I02/I03/I04/I05: API interceptors block, augment, timeout, crash, and revalidate query', async ({ request }) => {
    const blocked = await apiRequest(request, 'POST', '/api/example/todos', {
      token: adminToken,
      data: { title: 'BLOCKED todo from interceptor test' },
    })
    expect(blocked.status()).toBe(422)

    const enriched = await apiRequest(request, 'GET', '/api/example/todos?page=1&pageSize=1', {
      token: adminToken,
    })
    expect(enriched.ok()).toBeTruthy()
    const enrichedBody = await enriched.json()
    expect(enrichedBody?._example?.interceptor).toBeDefined()

    const timeout = await apiRequest(request, 'GET', '/api/example/todos?interceptorProbe=timeout', {
      token: adminToken,
    })
    expect(timeout.status()).toBe(504)
    const timeoutBody = await timeout.json()
    expect(timeoutBody.interceptorId).toBe('example.todos-probe-timeout')

    const crash = await apiRequest(request, 'GET', '/api/example/todos?interceptorProbe=crash', {
      token: adminToken,
    })
    expect(crash.status()).toBe(500)
    const crashBody = await crash.json()
    expect(crashBody.interceptorId).toBe('example.todos-probe-crash')

    const badQuery = await apiRequest(request, 'GET', '/api/example/todos?interceptorProbe=bad-query', {
      token: adminToken,
    })
    expect(badQuery.status()).toBe(400)
  })

  test('TC-UMES-I06/I07 + TC-UMES-CF02: customer priority interceptor filter and triad save path via API', async ({ request }) => {
    let personId: string | null = null
    let priorityId: string | null = null
    try {
      personId = await createPersonFixture(request, adminToken, {
        firstName: `QA-UMES-EH-${Date.now()}`,
        lastName: 'Priority',
        displayName: `QA UMES EH ${Date.now()}`,
      })

      const createPriority = await apiRequest(request, 'POST', '/api/example/customer-priorities', {
        token: adminToken,
        data: { customerId: personId, priority: 'high' },
      })
      expect(createPriority.ok()).toBeTruthy()
      priorityId = (await createPriority.json())?.id ?? null

      const filtered = await apiRequest(
        request,
        'GET',
        `/api/customers/people?id=${encodeURIComponent(personId)}&examplePriority=high`,
        { token: adminToken },
      )
      expect(filtered.ok()).toBeTruthy()
      const filteredBody = await filtered.json()
      const filteredItems = filteredBody?.items ?? filteredBody?.data ?? []
      expect(filteredItems.some((item: Record<string, unknown>) => item.id === personId)).toBe(true)
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/example/customer-priorities', priorityId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    }
  })

  test('TC-UMES-D01/D02/D03/D04: DataTable extensions render column, row action, filters, and bulk action button', async ({ page, request }) => {
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, adminToken, {
        firstName: `QA-UMES-D-${Date.now()}`,
        lastName: 'Table',
        displayName: `QA UMES D ${Date.now()}`,
      })

      await login(page, 'admin')
      await page.goto('/backend/customers/people')
      await page.waitForLoadState('domcontentloaded')

      await expect(page.getByText('Example priority')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Set normal priority' })).toBeVisible()

      await page.getByRole('button', { name: 'Filters' }).first().click()
      await expect(page.getByText('Priority')).toBeVisible()

      await page.getByLabel('Open actions').first().click()
      await expect(page.getByRole('menuitem', { name: 'Open customer' })).toBeVisible()
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    }
  })

  test('TC-UMES-CF01/CF03/CF04/CF05: CrudForm injected priority field saves via triad path', async ({ page, request }) => {
    let personId: string | null = null
    let createdPriorityId: string | null = null
    try {
      personId = await createPersonFixture(request, adminToken, {
        firstName: `QA-UMES-CF-${Date.now()}`,
        lastName: 'Form',
        displayName: `QA UMES CF ${Date.now()}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/customers/people/${encodeURIComponent(personId)}`)
      await page.waitForLoadState('domcontentloaded')

      const priorityField = page.locator('[data-crud-field-id="_example.priority"] select').first()
      await expect(priorityField).toBeVisible()
      await priorityField.selectOption('critical')
      await page.getByRole('button', { name: 'Save' }).first().click()

      await expect
        .poll(async () => {
          const response = await apiRequest(
            request,
            'GET',
            `/api/example/customer-priorities?customerId=${encodeURIComponent(personId!)}&page=1&pageSize=1`,
            { token: adminToken },
          )
          if (!response.ok()) return null
          const payload = await response.json() as PriorityListResponse
          const items = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload.data) ? payload.data : [])
          return items[0]?.priority ?? null
        }, { timeout: 8_000 })
        .toBe('critical')

      const priorityList = await apiRequest(
        request,
        'GET',
        `/api/example/customer-priorities?customerId=${encodeURIComponent(personId)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      const priorityPayload = await priorityList.json() as PriorityListResponse
      const priorityItems = Array.isArray(priorityPayload.items) ? priorityPayload.items : (Array.isArray(priorityPayload.data) ? priorityPayload.data : [])
      createdPriorityId = priorityItems[0]?.id ?? null
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/example/customer-priorities', createdPriorityId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    }
  })

  test('TC-UMES-CR01/CR02/CR03: replacement handles and wrapper render', async ({ page, request }) => {
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, adminToken, {
        firstName: `QA-UMES-CR-${Date.now()}`,
        lastName: 'Wrap',
        displayName: `QA UMES CR ${Date.now()}`,
      })

      await login(page, 'admin')
      await page.goto('/backend/umes-extensions')
      await page.waitForLoadState('domcontentloaded')

      await expect(page.locator('[data-component-handle="page:/backend/umes-extensions"]')).toHaveCount(1)
      await expect(page.locator('[data-component-handle="data-table:example.umes.extensions"]')).toHaveCount(1)
      await expect(page.locator('[data-component-handle="crud-form:example.todo"]')).toHaveCount(1)

      await page.goto(`/backend/customers/people/${encodeURIComponent(personId)}`)
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('[data-component-handle="section:ui.detail.NotesSection"]')).toHaveCount(1)
      await expect(page.locator('div.border-dashed').first()).toBeVisible()
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    }
  })
})
