import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TC-SEARCH-003: Search API requires authentication and feature gates (401/403)
 * Source: issue #2483 (expand `search` integration coverage)
 *
 * Real routes (the `search` module id prefixes every route under /api/search):
 *   - GET  /api/search/search   requireAuth + requireFeatures ['search.view']
 *   - POST /api/search/reindex  requireAuth + requireFeatures ['search.reindex']
 *
 * The framework route wrapper enforces requireAuth (401) and requireFeatures
 * (403) BEFORE the handler body runs, so these gates hold independently of each
 * route's own inline checks. Seeded role features: admin => search.* ,
 * employee => vector.* only, superadmin => all. A user that holds search.view
 * but NOT search.reindex must therefore be provisioned explicitly to prove the
 * granular reindex gate (employee cannot stand in — it lacks search.view too).
 */
const VALID_PASSWORD = 'Valid1!Pass'

test.describe('TC-SEARCH-003: search API auth & feature gates (401/403)', () => {
  test('gates search.view and search.reindex by authentication and feature', async ({ request }) => {
    test.slow()

    const stamp = Date.now()
    let adminToken: string | null = null
    let superToken: string | null = null
    let roleId: string | null = null
    let viewerUserId: string | null = null
    const roleName = `qa-search-003-viewer-${stamp}`
    const viewerEmail = `qa-search-003-viewer-${stamp}@acme.com`

    try {
      // 1. Unauthenticated search => 401. q is non-empty, so only the auth gate
      //    can produce a 401 here (the handler's empty-query 400 is unreachable
      //    because the framework wrapper denies first).
      const unauthSearch = await request.get('/api/search/search?q=test')
      expect(unauthSearch.status(), 'unauthenticated GET /api/search/search must be 401').toBe(401)

      // 2. Unauthenticated reindex => 401.
      const unauthReindex = await request.post('/api/search/reindex', { data: {} })
      expect(unauthReindex.status(), 'unauthenticated POST /api/search/reindex must be 401').toBe(401)

      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenScope(adminToken)

      // 3. A user with search.view but NOT search.reindex: search is allowed
      //    (never 401/403), reindex is forbidden (403).
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['search.view'] })
      viewerUserId = await createUserFixture(request, adminToken, {
        email: viewerEmail,
        password: VALID_PASSWORD,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Search 003 Viewer',
      })
      const viewerToken = await getAuthToken(request, viewerEmail, VALID_PASSWORD)

      const viewerSearch = await apiRequest(request, 'GET', '/api/search/search?q=qa-search-003', { token: viewerToken })
      expect(viewerSearch.status(), 'viewer with search.view must not be unauthorized on search').not.toBe(401)
      expect(viewerSearch.status(), 'viewer with search.view must not be forbidden on search').not.toBe(403)
      // The search route resolves searchService and returns 200 with results
      // (empty when no strategy returns hits) — it does not 503 here — so a passing
      // gate yields 200.
      expect(viewerSearch.status(), 'search.view passes the gate, so the search succeeds with 200').toBe(200)

      const viewerReindex = await apiRequest(request, 'POST', '/api/search/reindex', { token: viewerToken, data: {} })
      expect(viewerReindex.status(), 'viewer lacking search.reindex must be forbidden on reindex').toBe(403)

      // 4. Superadmin can initiate reindex — never blocked by auth/feature gates.
      //    useQueue:false makes the route clear its own lock in `finally`, so this
      //    leaves no lingering fulltext lock for other tests; scoping to a single
      //    entity keeps the synchronous reindex cheap.
      superToken = await getAuthToken(request, 'superadmin')
      const superReindex = await apiRequest(request, 'POST', '/api/search/reindex', {
        token: superToken,
        data: { entityId: 'customers:customer_company_profile', useQueue: false },
      })
      expect(superReindex.status(), 'superadmin reindex must not be unauthorized').not.toBe(401)
      expect(superReindex.status(), 'superadmin reindex must not be forbidden').not.toBe(403)
      expect([200, 503], 'superadmin reindex returns ok (200) or service-unavailable (503)').toContain(
        superReindex.status(),
      )
    } finally {
      // Best-effort: release any fulltext lock, then tear down fixtures.
      if (superToken) {
        await apiRequest(request, 'POST', '/api/search/reindex/cancel', { token: superToken }).catch(() => undefined)
      }
      await deleteUserIfExists(request, adminToken, viewerUserId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
