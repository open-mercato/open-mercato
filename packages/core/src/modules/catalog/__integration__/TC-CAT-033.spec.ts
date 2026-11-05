import { expect, request as playwrightRequest, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  setRoleAclFeatures,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CAT-033: RBAC enforcement on the price-kinds API.
 * Source: issue #2484 (catalog integration coverage), scenario TC-CAT-026
 *   (renumbered to 033 — TC-CAT-026 is occupied by the tier-pricing tie-break test).
 *
 * All price-kinds methods (GET/POST/PUT/DELETE) are gated by the single feature
 * `catalog.settings.manage`. The issue assumed GET was view-only; in reality a
 * user lacking the feature is forbidden from every method, and an unauthenticated
 * request is rejected with 401. A user granted the feature can read and create.
 */
const PRICE_KINDS_PATH = '/api/catalog/price-kinds'
const NON_EXISTENT_ID = '00000000-0000-0000-0000-000000000000'
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const USER_PASSWORD = 'Valid1!Pass'

test.describe('TC-CAT-033: Price-kinds RBAC enforcement', () => {
  test('forbids every method for a user without catalog.settings.manage', async ({ request, baseURL }) => {
    const suffix = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `qa-cat-033-noaccess-${suffix}`,
      })
      // A real but unrelated catalog feature — authenticated, yet lacking settings.manage.
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['catalog.products.view'],
      })

      const userEmail = `qa-cat-033-noaccess-${suffix}@test.invalid`
      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password: USER_PASSWORD,
        organizationId,
        roles: [roleId],
      })
      const userToken = await getAuthToken(request, userEmail, USER_PASSWORD)

      const getRes = await apiRequest(request, 'GET', PRICE_KINDS_PATH, { token: userToken })
      expect(getRes.status(), 'GET is also gated by catalog.settings.manage').toBe(403)

      const postRes = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
        token: userToken,
        data: { code: `qa_cat_033_denied_${suffix}`, title: `Denied ${suffix}` },
      })
      expect(postRes.status(), 'POST without the feature must be forbidden').toBe(403)

      const putRes = await apiRequest(request, 'PUT', PRICE_KINDS_PATH, {
        token: userToken,
        data: { id: NON_EXISTENT_ID, title: `Denied ${suffix}` },
      })
      expect(putRes.status(), 'PUT without the feature must be forbidden').toBe(403)

      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `${PRICE_KINDS_PATH}?id=${NON_EXISTENT_ID}`,
        { token: userToken },
      )
      expect(deleteRes.status(), 'DELETE without the feature must be forbidden').toBe(403)

      // No bearer token at all → unauthenticated, not merely forbidden.
      const anonymous = await playwrightRequest.newContext({ baseURL: baseURL ?? BASE_URL })
      try {
        const unauthRes = await anonymous.fetch(PRICE_KINDS_PATH, { method: 'GET' })
        expect(unauthRes.status(), 'unauthenticated request must be 401').toBe(401)
      } finally {
        await anonymous.dispose()
      }
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('allows read and create for a user granted catalog.settings.manage', async ({ request }) => {
    const suffix = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let userId: string | null = null
    let priceKindId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `qa-cat-033-manage-${suffix}`,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['catalog.settings.manage'],
      })

      const userEmail = `qa-cat-033-manage-${suffix}@test.invalid`
      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password: USER_PASSWORD,
        organizationId,
        roles: [roleId],
      })
      const userToken = await getAuthToken(request, userEmail, USER_PASSWORD)

      const getRes = await apiRequest(request, 'GET', PRICE_KINDS_PATH, { token: userToken })
      expect(getRes.status(), 'feature grant allows GET').toBe(200)

      const postRes = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
        token: userToken,
        data: {
          code: `qa_cat_033_allowed_${suffix}`,
          title: `Allowed ${suffix}`,
          displayMode: 'excluding-tax',
        },
      })
      expect(postRes.status(), 'feature grant allows POST').toBe(201)
      priceKindId = ((await postRes.json()) as { id?: string }).id ?? null
      expect(priceKindId, 'created price-kind id').toBeTruthy()
    } finally {
      if (priceKindId) {
        await apiRequest(
          request,
          'DELETE',
          `${PRICE_KINDS_PATH}?id=${encodeURIComponent(priceKindId)}`,
          { token: adminToken },
        ).catch(() => undefined)
      }
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
