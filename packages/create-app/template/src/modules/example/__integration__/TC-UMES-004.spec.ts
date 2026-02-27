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
  let interceptorsEnabled = false

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    const probe = await apiRequest(request, 'GET', '/api/example/todos?interceptorProbe=wildcard&page=1&pageSize=1', {
      token: adminToken,
    })
    if (!probe.ok()) return
    const body = await probe.json()
    interceptorsEnabled = Boolean(body?._example?.wildcardProbe)
  })

  test('TC-UMES-I01: interceptor before rejects blocked POST with 422', async ({ request }) => {
    test.skip(!interceptorsEnabled, 'Example interceptors are not active in this runtime')
    const blocked = await apiRequest(request, 'POST', '/api/example/todos', {
      token: adminToken,
      data: { title: 'BLOCKED todo from interceptor test' },
    })
    expect(blocked.status()).toBe(422)
  })

  test('TC-UMES-I02: interceptor before allows valid POST', async ({ request }) => {
    let todoId: string | null = null
    try {
      const created = await apiRequest(request, 'POST', '/api/example/todos', {
        token: adminToken,
        data: { title: `VALID-${Date.now()}` },
      })
      expect(created.ok()).toBeTruthy()
      todoId = (await created.json())?.id ?? null
      expect(typeof todoId).toBe('string')
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/example/todos', todoId)
    }
  })

  test('TC-UMES-I03/I06: interceptor after merges metadata payload in GET response', async ({ request }) => {
    test.skip(!interceptorsEnabled, 'Example interceptors are not active in this runtime')
    const enriched = await apiRequest(request, 'GET', '/api/example/todos?page=1&pageSize=1', {
      token: adminToken,
    })
    expect(enriched.ok()).toBeTruthy()
    const enrichedBody = await enriched.json()
    expect(enrichedBody?._example?.interceptor).toBeDefined()
    expect(typeof enrichedBody?._example?.interceptor?.processingTimeMs).toBe('number')
  })

  test('TC-UMES-I04: wildcard interceptor matches both /example/todos and /example/tags', async ({ request }) => {
    test.skip(!interceptorsEnabled, 'Example interceptors are not active in this runtime')
    const todosResponse = await apiRequest(
      request,
      'GET',
      '/api/example/todos?page=1&pageSize=1&interceptorProbe=wildcard',
      { token: adminToken },
    )
    expect(todosResponse.ok()).toBeTruthy()
    const todosPayload = await todosResponse.json()
    expect(todosPayload?._example?.wildcardProbe).toBe(true)

    const tagsResponse = await apiRequest(
      request,
      'GET',
      '/api/example/tags?interceptorProbe=wildcard',
      { token: adminToken },
    )
    expect(tagsResponse.ok()).toBeTruthy()
    const tagsPayload = await tagsResponse.json()
    expect(tagsPayload?._example?.wildcardProbe).toBe(true)
  })

  test('TC-UMES-I05: interceptor query rewrite is revalidated by route schema', async ({ request }) => {
    test.skip(!interceptorsEnabled, 'Example interceptors are not active in this runtime')
    const badQuery = await apiRequest(request, 'GET', '/api/example/todos?interceptorProbe=bad-query', {
      token: adminToken,
    })
    expect(badQuery.status()).toBe(400)
  })

  test('TC-UMES-I08/I09: interceptor timeout and crash fail closed', async ({ request }) => {
    test.skip(!interceptorsEnabled, 'Example interceptors are not active in this runtime')
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
  })

  test('TC-UMES-I07: interceptor query rewrites remain tenant-safe for customer priority filter', async ({ request }) => {
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
    const displayName = `QA UMES D ${Date.now()}`
    try {
      personId = await createPersonFixture(request, adminToken, {
        firstName: `QA-UMES-D-${Date.now()}`,
        lastName: 'Table',
        displayName,
      })

      await login(page, 'admin')
      await page.goto('/backend/customers/people')
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByText('Example priority')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('button', { name: 'Set normal priority' })).toBeVisible()

      await page.getByPlaceholder(/search/i).first().fill(displayName)
      await expect(page.locator('tbody tr', { hasText: displayName }).first()).toBeVisible({ timeout: 10_000 })

      await page.getByRole('button', { name: 'Filters' }).first().click()
      await expect(page.getByText('Priority')).toBeVisible()

      const targetRow = page.locator('tbody tr', { hasText: displayName }).first()
      await targetRow.getByLabel('Open actions').click()
      await expect(page.getByRole('menuitem', { name: 'Open customer' })).toBeVisible()
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    }
  })

  test('TC-UMES-D06: injected bulk action executes against selected rows', async ({ page, request }) => {
    let personId: string | null = null
    let priorityId: string | null = null
    const displayName = `QA UMES BULK ${Date.now()}`
    try {
      personId = await createPersonFixture(request, adminToken, {
        firstName: `QA-UMES-BULK-${Date.now()}`,
        lastName: 'Bulk',
        displayName,
      })
      const priorityResponse = await apiRequest(
        request,
        'POST',
        '/api/example/customer-priorities',
        { token: adminToken, data: { customerId: personId, priority: 'critical' } },
      )
      expect(priorityResponse.ok()).toBeTruthy()
      priorityId = (await priorityResponse.json())?.id ?? null

      await login(page, 'admin')
      await page.goto('/backend/customers/people')
      await page.waitForLoadState('domcontentloaded')

      await expect(page.getByRole('button', { name: 'Set normal priority' })).toBeVisible({ timeout: 10_000 })
      await page.getByPlaceholder(/search/i).first().fill(displayName)
      const targetRow = page.locator('tbody tr', { hasText: displayName }).first()
      await expect(targetRow).toBeVisible({ timeout: 10_000 })
      await targetRow.getByRole('checkbox', { name: 'Select row' }).check()
      await page.getByRole('button', { name: 'Set normal priority' }).click()

      await expect
        .poll(async () => {
          const response = await apiRequest(
            request,
            'GET',
            `/api/example/customer-priorities?customerId=${encodeURIComponent(personId!)}&page=1&pageSize=1`,
            { token: adminToken },
          )
          const payload = await response.json() as PriorityListResponse
          const items = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload.data) ? payload.data : [])
          return items[0]?.priority ?? null
        }, { timeout: 8_000 })
        .toBe('normal')
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/example/customer-priorities', priorityId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    }
  })

  test('TC-UMES-D05: injected DataTable extensions are available for authorized employee role', async ({ page }) => {
    await login(page, 'employee')
    await page.goto('/backend/customers/people')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByText('Example priority')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Set normal priority' })).toBeVisible()
  })

  test('TC-UMES-CF01/CF02/CF03/CF04/CF05: CrudForm injected priority field save path and payload boundaries', async ({ page, request }) => {
    let personId: string | null = null
    let createdPriorityId: string | null = null
    try {
      personId = await createPersonFixture(request, adminToken, {
        firstName: `QA-UMES-CF-${Date.now()}`,
        lastName: 'Form',
        displayName: `QA UMES CF ${Date.now()}`,
      })
      const seededPriority = await apiRequest(request, 'POST', '/api/example/customer-priorities', {
        token: adminToken,
        data: { customerId: personId, priority: 'high' },
      })
      expect(seededPriority.ok()).toBeTruthy()
      createdPriorityId = (await seededPriority.json())?.id ?? null

      await login(page, 'admin')
      await page.goto(`/backend/customers/people/${encodeURIComponent(personId)}`)
      await page.waitForLoadState('domcontentloaded')

      const priorityField = page.locator('[data-crud-field-id="_example.priority"] select').first()
      await expect(priorityField).toBeVisible({ timeout: 10_000 })
      await expect(priorityField).toHaveValue('high')
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

      const personResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/people?id=${encodeURIComponent(personId)}`,
        { token: adminToken },
      )
      expect(personResponse.ok()).toBeTruthy()
      const personPayload = await personResponse.json()
      const personItems = personPayload?.items ?? personPayload?.data ?? []
      const person = personItems.find((entry: Record<string, unknown>) => entry.id === personId) as Record<string, unknown> | undefined
      expect(person).toBeDefined()
      expect(person?.priority).toBeUndefined()
      expect(person?.['_example.priority']).toBeUndefined()
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
      const interceptorHint = page.getByText(
        'Note: red network entries for probes 3-5 are expected and indicate correct fail-closed behavior.',
      )
      await expect(interceptorHint).toBeVisible()
      await expect(interceptorHint.locator('xpath=ancestor::div[1]')).toHaveClass(/border-amber-400\/40/)

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
