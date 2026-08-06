import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

const TODOS_LIST_PATH = '/backend/todos'

/**
 * Milestone B coverage for the module's two page-middleware surfaces.
 *
 * `backend/middleware.ts` and `frontend/middleware.ts` are auto-discovered into two different
 * generated registries and executed by two different catch-all pages, so they are one surface
 * only on paper. This test exercises each at its own call site and asserts the property that
 * distinguishes a page middleware from every neighbouring mechanism: it runs on a **page**
 * request, after the route manifest matched and after the guards passed, so it redirects rather
 * than denies — and it never touches an API request, which is what `data/guards.ts` mutation
 * guards own. Without that last assertion a page middleware and a mutation guard would be
 * indistinguishable from outside.
 */
test.describe('TC-EXAMPLE-013: backend and frontend page middleware redirect their own surfaces only', () => {
  test('redirects a structurally impossible todo edit deep link and lets a real one render', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let todoId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', '/api/example/todos', {
        token,
        data: { title: `TC-EXAMPLE-013 ${suffix}`, cf_priority: 1, cf_severity: 'low' },
      })
      expect(created.ok(), `create todo failed: ${created.status()}`).toBeTruthy()
      todoId = (await created.json() as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()

      await login(page, 'admin')

      // Non-match branch: a real id is left alone and the edit shell renders.
      await page.goto(`/backend/todos/${encodeURIComponent(todoId!)}/edit`, { waitUntil: 'commit' })
      await expect(page.locator('[data-crud-field-id="title"] input').first()).toHaveValue(
        `TC-EXAMPLE-013 ${suffix}`,
      )

      // Match branch: an id that cannot be a record is sent back to the list before the edit
      // shell loads, so no detail fetch that is guaranteed to miss is ever issued.
      await page.goto('/backend/todos/not-a-real-todo-id/edit', { waitUntil: 'commit' })
      await expect(page).toHaveURL(new RegExp(`${TODOS_LIST_PATH}(?:\\?.*)?$`))

      // The redirect target itself must not re-enter the middleware: the list is a different
      // path, so a second navigation there stays put rather than looping.
      await page.goto(TODOS_LIST_PATH, { waitUntil: 'commit' })
      await expect(page).toHaveURL(new RegExp(`${TODOS_LIST_PATH}(?:\\?.*)?$`))
    } finally {
      await deleteEntityIfExists(request, token, '/api/example/todos', todoId)
    }
  })

  test('canonicalizes a public blog path for an anonymous visitor and leaves the canonical one alone', async ({ page }) => {
    test.slow()
    // No login: the frontend catch-all resolves no session for a public route, and the
    // middleware's decision must not depend on one.
    await page.goto('/blog/MiXeD-Case-Post', { waitUntil: 'commit' })
    await expect(page).toHaveURL(/\/blog\/mixed-case-post\/?$/)

    await page.goto('/blog/mixed-case-post', { waitUntil: 'commit' })
    await expect(page).toHaveURL(/\/blog\/mixed-case-post\/?$/)
  })

  test('leaves API requests to the mutation guards and never redirects them', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // The backend middleware matches `/backend/todos/:id/edit`. The API path for the same
    // record is not a page, so the middleware never sees it: a bad id comes back as a data
    // answer, not as a redirect to the list.
    const absentId = randomUUID()
    const response = await apiRequest(
      request,
      'GET',
      `/api/example/todos?ids=${absentId}&page=1&pageSize=1`,
      { token },
    )
    expect(response.status(), 'a missing record is a data answer, not a redirect').toBe(200)
    expect(((await response.json()) as { items?: unknown[] }).items ?? []).toHaveLength(0)
    expect(response.url()).toContain('/api/example/todos')
    expect(response.url()).not.toContain(TODOS_LIST_PATH)

    // And the mutation guard owns the write side: `example.todo-limit` rejects a create with no
    // organization scope with its own status, which no redirect could express.
    const created = await apiRequest(request, 'POST', '/api/example/todos', {
      token,
      data: { title: '', cf_priority: 1, cf_severity: 'low' },
    })
    expect(created.ok(), 'an invalid create must be refused by the data layer, not redirected').toBeFalsy()
    expect(created.status()).toBeGreaterThanOrEqual(400)
    expect(created.status()).toBeLessThan(500)
  })
})
