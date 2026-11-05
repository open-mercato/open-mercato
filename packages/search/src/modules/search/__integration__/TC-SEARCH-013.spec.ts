import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'

type CancelBody = { ok?: boolean; jobsRemoved?: number; error?: string }

const VALID_PASSWORD = 'Valid1!Pass'
const FULLTEXT_CANCEL = '/api/search/reindex/cancel'
const VECTOR_CANCEL = '/api/search/embeddings/reindex/cancel'

/**
 * TC-SEARCH-013: search reindex cancellation is tenant/organization scoped.
 * Source: PR #3992 follow-up comment (Fixes #3900).
 *
 * PR #3992 replaced the shared-queue-wiping `queue.clear()` in the fulltext and
 * vector reindex cancel routes with a scoped removal:
 *   queue.removeQueuedJobsByScope({ tenantId, organizationId?, jobTypes: ['batch-index'] })
 * and made both routes **fail closed with 503** when that scoped method is
 * unavailable or throws. The queue strategies (local/async) gained the method.
 * The PR shipped only unit + route tests against a MOCKED queue; this integration
 * spec locks the contract in against the REAL cancel API + REAL queue strategy.
 *
 * What this asserts (deterministic in the backend-less integration env):
 *  1. Scoped-cancel contract is wired on the real queue. An authenticated admin
 *     cancel of BOTH the fulltext and vector paths returns 200 { ok:true,
 *     jobsRemoved:<number> } — NOT the 503 fail-closed body. Under the old code
 *     cancel always returned 200 via clear(); under the new code the route 503s
 *     when the strategy lacks removeQueuedJobsByScope. So a green result proves
 *     the running app's real local queue strategy implements the scoped method —
 *     the queue-strategy half of #3992 the mocked unit tests never exercise.
 *  2. Per-scope isolation. A second organization (orgB) with its own confined user
 *     cancels independently; admin (orgA) and orgB cancels interleave and every
 *     call returns a clean 200 { ok:true }. One scope's cancel neither errors nor
 *     503s another scope's cancel — the observable proxy, without a live search
 *     backend, for "cancel does not disrupt other scopes' queue state".
 *
 * Environment constraints (see TC-SEARCH-007): this env has no Meilisearch and no
 * embedding provider, so a reindex enqueues zero `batch-index` jobs and holds no
 * lock — jobsRemoved is therefore always 0 here, and cross-scope job SURVIVAL with
 * real enqueued jobs plus the 503 fail-closed path (fault injection) are NOT
 * black-box observable; they remain covered by the PR's unit/route tests. Full
 * second-TENANT provisioning is unavailable to integration fixtures, so — like
 * TC-SEARCH-004 — a second ORGANIZATION in the same tenant exercises the scope's
 * organizationId dimension; the test skips the isolation case if orgB cannot be
 * provisioned. Cancel is idempotent without a prior reindex (TC-SEARCH-003/007
 * already rely on this in teardown).
 */
test.describe('TC-SEARCH-013: reindex cancellation is tenant/org scoped', () => {
  test('scoped cancel returns the 200 contract per scope and stays isolated across orgs', async ({ request }) => {
    test.slow()
    test.setTimeout(120_000)

    const stamp = Date.now()
    let adminToken: string | null = null
    let superToken: string | null = null
    let orgBId: string | null = null
    let roleId: string | null = null
    let userBId: string | null = null
    const roleName = `qa-search-013-${stamp}`
    const userBEmail = `qa-search-013-${stamp}@acme.com`

    const expectScopedCancelOk = async (token: string, path: string, label: string): Promise<void> => {
      const res = await apiRequest(request, 'POST', path, { token })
      // The scoped-removal path must be reachable: not 401/403 (gates), and crucially
      // not the 503 fail-closed body that the route returns when the real queue
      // strategy lacks removeQueuedJobsByScope.
      expect(res.status(), `${label}: cancel must pass the auth/feature gates`).not.toBe(401)
      expect(res.status(), `${label}: cancel must pass the auth/feature gates`).not.toBe(403)
      expect(
        res.status(),
        `${label}: scoped cancel must succeed (200), not fail closed (503) — proves removeQueuedJobsByScope is wired`,
      ).toBe(200)
      const body = (await readJsonSafe<CancelBody>(res)) ?? {}
      expect(body.ok, `${label}: cancel reports ok`).toBe(true)
      expect(typeof body.jobsRemoved, `${label}: cancel reports a numeric jobsRemoved`).toBe('number')
      expect(body.jobsRemoved, `${label}: jobsRemoved is a non-negative count`).toBeGreaterThanOrEqual(0)
      expect(body.error, `${label}: a 200 scoped cancel carries no error`).toBeUndefined()
    }

    try {
      adminToken = await getAuthToken(request, 'admin')
      superToken = await getAuthToken(request, 'superadmin')
      const adminScope = getTokenScope(adminToken)

      // 1. Admin (orgA) — the scoped-cancel contract is wired on the real queue for
      //    both the fulltext and the vector paths.
      await expectScopedCancelOk(adminToken, FULLTEXT_CANCEL, 'orgA fulltext')
      await expectScopedCancelOk(adminToken, VECTOR_CANCEL, 'orgA vector')

      // 2. Provision a second organization in the same tenant plus a confined user
      //    that holds the reindex + embeddings-manage features. superadmin bypasses
      //    the directory create command's tenant-selection enforcement.
      const orgResp = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superToken,
        data: { name: `QA Search 013 OrgB ${stamp}`, tenantId: adminScope.tenantId },
      })
      if (orgResp.status() !== 201) {
        test.skip(true, `cannot provision a second organization in this environment (status ${orgResp.status()})`)
        return
      }
      orgBId = expectId((await readJsonSafe<{ id?: string }>(orgResp))?.id, 'organization create returns an id')

      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: adminScope.tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['search.reindex', 'search.embeddings.manage'],
      })
      userBId = await createUserFixture(request, superToken, {
        email: userBEmail,
        password: VALID_PASSWORD,
        organizationId: orgBId,
        roles: [roleName],
        name: 'QA Search 013 OrgB User',
      })
      await setUserAclVisibility(request, superToken, {
        userId: userBId,
        organizations: [orgBId],
        features: ['search.reindex', 'search.embeddings.manage'],
      })
      const userBToken = await getAuthToken(request, userBEmail, VALID_PASSWORD)
      expect(getTokenScope(userBToken).organizationId, 'org-B user is scoped to orgB').toBe(orgBId)

      // 3. Per-scope isolation: interleave orgA and orgB cancels. Each call returns a
      //    clean 200 { ok:true } — one scope's cancel never errors or fails closed
      //    another scope's cancel, i.e. cancel does not wipe/disrupt shared state.
      await expectScopedCancelOk(userBToken, FULLTEXT_CANCEL, 'orgB fulltext')
      await expectScopedCancelOk(adminToken, FULLTEXT_CANCEL, 'orgA fulltext (after orgB)')
      await expectScopedCancelOk(userBToken, VECTOR_CANCEL, 'orgB vector')
      await expectScopedCancelOk(adminToken, VECTOR_CANCEL, 'orgA vector (after orgB)')
    } finally {
      await deleteUserIfExists(request, superToken, userBId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationIfExists(request, superToken, orgBId)
    }
  })
})
