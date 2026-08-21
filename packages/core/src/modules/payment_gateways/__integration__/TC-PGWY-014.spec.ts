import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-PGWY-014: RBAC feature gates — 403 when missing required payment_gateways features
 *
 * Every payment_gateways API route declares `requireFeatures` in its metadata and the
 * central API dispatcher (apps/mercato/src/app/api/[...slug]/route.ts) enforces them via
 * `rbacService.userHasAllFeatures`, returning 403 before the handler runs. This proves the
 * gates are wired per-feature, not all-or-nothing:
 *   - /sessions, /cancel                 → payment_gateways.manage
 *   - /capture                           → payment_gateways.capture
 *   - /refund                            → payment_gateways.refund
 *   - /transactions, /status, /providers → payment_gateways.view
 *
 * A user holding only `manage` is rejected from view/capture/refund routes, and a user
 * holding only `view` is rejected from manage/capture/refund routes — while each is still
 * allowed on the route its single feature covers.
 */
const PASSWORD = 'Qa!2026Pgwy'
const unique = () => `${Date.now()}-${randomUUID().slice(0, 12)}`

test.describe('TC-PGWY-014: RBAC feature gates (403)', () => {
  test('enforces per-feature access across payment_gateways routes', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superToken = await getAuthToken(request, 'superadmin')
    const { organizationId, tenantId } = getTokenScope(adminToken)
    expect(organizationId, 'admin token must carry a concrete organization').toBeTruthy()
    expect(tenantId, 'admin token must carry a concrete tenant').toBeTruthy()

    let manageRoleId: string | null = null
    let viewRoleId: string | null = null
    let manageUserId: string | null = null
    let viewUserId: string | null = null

    try {
      manageRoleId = await createRoleFixture(request, superToken, { name: `qa-pgwy-manage-${unique()}`, tenantId })
      await setRoleAclFeatures(request, superToken, { roleId: manageRoleId, features: ['payment_gateways.manage'] })
      const manageEmail = `qa-pgwy-manage-${unique()}@acme.com`
      manageUserId = await createUserFixture(request, superToken, {
        email: manageEmail,
        password: PASSWORD,
        organizationId,
        roles: [manageRoleId],
        name: 'QA PGWY Manage Only',
      })
      const manageToken = await getAuthToken(request, manageEmail, PASSWORD)

      viewRoleId = await createRoleFixture(request, superToken, { name: `qa-pgwy-view-${unique()}`, tenantId })
      await setRoleAclFeatures(request, superToken, { roleId: viewRoleId, features: ['payment_gateways.view'] })
      const viewEmail = `qa-pgwy-view-${unique()}@acme.com`
      viewUserId = await createUserFixture(request, superToken, {
        email: viewEmail,
        password: PASSWORD,
        organizationId,
        roles: [viewRoleId],
        name: 'QA PGWY View Only',
      })
      const viewToken = await getAuthToken(request, viewEmail, PASSWORD)

      const createSessionAsManage = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
        token: manageToken,
        data: { providerKey: 'mock', amount: 10, currencyCode: 'USD', captureMethod: 'manual' },
      })
      expect(createSessionAsManage.status(), 'manage feature permits session creation').toBe(201)

      const listAsManage = await apiRequest(request, 'GET', '/api/payment_gateways/transactions', { token: manageToken })
      expect(listAsManage.status(), 'view feature required for transactions list').toBe(403)

      const statusAsManage = await apiRequest(request, 'GET', `/api/payment_gateways/status?transactionId=${randomUUID()}`, { token: manageToken })
      expect(statusAsManage.status(), 'view feature required for status').toBe(403)

      const captureAsManage = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
        token: manageToken,
        data: { transactionId: randomUUID() },
      })
      expect(captureAsManage.status(), 'capture feature required for capture').toBe(403)

      const refundAsManage = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
        token: manageToken,
        data: { transactionId: randomUUID() },
      })
      expect(refundAsManage.status(), 'refund feature required for refund').toBe(403)

      const listAsView = await apiRequest(request, 'GET', '/api/payment_gateways/transactions', { token: viewToken })
      expect(listAsView.status(), 'view feature permits transactions list').toBe(200)

      const createSessionAsView = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
        token: viewToken,
        data: { providerKey: 'mock', amount: 10, currencyCode: 'USD', captureMethod: 'manual' },
      })
      expect(createSessionAsView.status(), 'manage feature required for session creation').toBe(403)

      const cancelAsView = await apiRequest(request, 'POST', '/api/payment_gateways/cancel', {
        token: viewToken,
        data: { transactionId: randomUUID() },
      })
      expect(cancelAsView.status(), 'manage feature required for cancel').toBe(403)

      const captureAsView = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
        token: viewToken,
        data: { transactionId: randomUUID() },
      })
      expect(captureAsView.status(), 'capture feature required for capture').toBe(403)

      const refundAsView = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
        token: viewToken,
        data: { transactionId: randomUUID() },
      })
      expect(refundAsView.status(), 'refund feature required for refund').toBe(403)
    } finally {
      await deleteUserIfExists(request, superToken, manageUserId)
      await deleteUserIfExists(request, superToken, viewUserId)
      await deleteRoleIfExists(request, superToken, manageRoleId)
      await deleteRoleIfExists(request, superToken, viewRoleId)
    }
  })
})
