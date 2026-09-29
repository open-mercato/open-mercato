import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

const SUMMARY_PATH = '/api/example/todos/summary'
const TODOS_API = '/api/example/todos'

type Summary = { total: number; done: number; open: number; cacheHit: boolean }

/**
 * The summary route resolves its scope with `getAuthFromCookies()`, not from a bearer token,
 * so it is reachable only from a browser session. Reading it through the page's own request
 * context is therefore not a convenience — it is the only caller shape the route accepts, and
 * a bearer-token read returns 401.
 */
async function readSummary(page: Page): Promise<Summary> {
  // Issued from the page itself rather than through an API request context, so it is the same
  // same-origin credentialed fetch the backend UI makes. That is what the route's cookie-based
  // scope resolution expects; a detached request context does not reliably carry the session.
  const result = await page.evaluate(async (path) => {
    const response = await fetch(path, { credentials: 'same-origin' })
    return { status: response.status, body: await response.text() }
  }, SUMMARY_PATH)
  expect(result.status, `GET todo summary failed: ${result.status} ${result.body.slice(0, 200)}`).toBe(200)
  return JSON.parse(result.body) as Summary
}

/**
 * Milestone B coverage for the module's cache and scoped-DI surface.
 *
 * `EXAMPLE_TODO_SUMMARY_SERVICE` is registered per request and consumed by the summary route,
 * which reports `cacheHit` so the cache is observable from outside the process rather than only
 * in a unit test. The scope comes from the session, never from the query string, so the
 * isolation assertion below is a real security property: two organizations must never share an
 * entry even though they share a tenant.
 *
 * The summary is tagged with the same collection tag the Todo CRUD route owns, so the
 * platform's own post-commit invalidation drops it. That is why create, update and delete are
 * each exercised: the module did not write three invalidation paths, it reused one, and a
 * regression would show up on whichever mutation stopped emitting the tag.
 */
test.describe('TC-EXAMPLE-007: the todo summary cache misses, hits, invalidates and stays scoped', () => {
  test('serves a hit after a miss and drops the entry on create, update and delete', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let todoId: string | null = null

    try {
      await login(page, 'admin')

      // Warm the entry, then prove a second read is served from it.
      const warmed = await readSummary(page)
      const hit = await readSummary(page)
      expect(hit.cacheHit, 'a second read of an unchanged scope must be a cache hit').toBe(true)
      expect(hit.total).toBe(warmed.total)
      expect(hit.open + hit.done).toBe(hit.total)

      const created = await apiRequest(request, 'POST', TODOS_API, {
        token,
        data: { title: `TC-EXAMPLE-007 ${suffix}`, cf_priority: 1, cf_severity: 'low' },
      })
      expect(created.ok(), `create todo failed: ${created.status()}`).toBeTruthy()
      todoId = (await created.json() as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()

      const afterCreate = await readSummary(page)
      expect(afterCreate.cacheHit, 'creating a todo must invalidate the summary').toBe(false)
      expect(afterCreate.total).toBe(warmed.total + 1)
      expect(afterCreate.open).toBe(warmed.open + 1)
      expect((await readSummary(page)).cacheHit).toBe(true)

      // Completing the todo moves it between the two counters, so the invalidation is visible
      // in the value and not only in the flag. The completion flag is `is_done`: the route's
      // query schema also accepts a camelCase `isDone`, but a write carrying it returns 200 and
      // changes nothing, so the read-back below is asserted before the counters are.
      const updated = await apiRequest(request, 'PUT', TODOS_API, {
        token,
        data: { id: todoId, title: `TC-EXAMPLE-007 ${suffix}`, is_done: true },
      })
      expect(updated.ok(), `update todo failed: ${updated.status()}`).toBeTruthy()
      const completed = await apiRequest(
        request,
        'GET',
        `${TODOS_API}?ids=${encodeURIComponent(todoId!)}&page=1&pageSize=1`,
        { token },
      )
      const completedBody = (await completed.json()) as { items?: Array<{ is_done?: boolean }> }
      expect(completedBody.items?.[0]?.is_done, 'the completion write must actually land').toBe(true)

      const afterUpdate = await readSummary(page)
      expect(afterUpdate.cacheHit, 'updating a todo must invalidate the summary').toBe(false)
      expect(afterUpdate.total).toBe(afterCreate.total)
      expect(afterUpdate.done).toBe(warmed.done + 1)
      expect(afterUpdate.open).toBe(warmed.open)

      await apiRequest(request, 'DELETE', TODOS_API, { token, data: { id: todoId } })
      const afterDelete = await readSummary(page)
      expect(afterDelete.cacheHit, 'deleting a todo must invalidate the summary').toBe(false)
      expect(afterDelete.total).toBe(warmed.total)
      todoId = null
    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, todoId)
    }
  })

  test('keeps two organizations of one tenant on independent cache entries', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let otherOrgId: string | null = null
    let otherTodoId: string | null = null

    try {
      otherOrgId = await createOrganizationFixture(request, token, {
        name: `TC-EXAMPLE-007 org ${suffix}`,
        tenantId,
      })

      await login(page, 'admin')
      const homeBefore = await readSummary(page)

      // The write goes to the other organization. Note what is NOT asserted: this test does not
      // read that organization's own summary. The route derives its scope from the session's
      // `auth.orgId`, not from the `om_selected_org` cookie, so reading another organization's
      // summary needs a session that belongs to it — a user fixture, not a cookie. Reading it
      // through this session would silently return the home organization's numbers and the
      // assertion would prove nothing.
      const created = await apiRequestWithSelectedOrg(request, 'POST', TODOS_API, {
        token,
        selectedOrgId: otherOrgId,
        data: { title: `TC-EXAMPLE-007 other ${suffix}`, cf_priority: 1, cf_severity: 'low' },
      })
      expect(created.ok(), `create other-org todo failed: ${created.status()}`).toBeTruthy()
      otherTodoId = (await created.json() as { id?: string }).id ?? null
      expect(otherTodoId).toBeTruthy()

      // It landed in the other organization, so this session cannot list it...
      const homeList = await apiRequest(
        request,
        'GET',
        `${TODOS_API}?ids=${encodeURIComponent(otherTodoId!)}&page=1&pageSize=1`,
        { token },
      )
      expect(((await homeList.json()) as { items?: unknown[] }).items ?? []).toHaveLength(0)

      // ...and the home summary is unchanged: one organization's write must never be readable
      // as another organization's cached counts, even though both share a tenant.
      const homeAfter = await readSummary(page)
      expect(homeAfter.total).toBe(homeBefore.total)
      expect(homeAfter.done).toBe(homeBefore.done)
      expect(homeAfter.open).toBe(homeBefore.open)
    } finally {
      if (otherTodoId && otherOrgId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', TODOS_API, {
          token,
          selectedOrgId: otherOrgId,
          data: { id: otherTodoId },
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, token, otherOrgId)
    }
  })
})
