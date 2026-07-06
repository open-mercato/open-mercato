import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createPaymentSession } from './helpers/fixtures'

/**
 * TC-PGWY-016: Cross-organization isolation on detail and mutation routes
 *
 * Two users in two organizations BOTH hold full payment_gateways features, so RBAC does
 * not deny them. Isolation is enforced at the data layer: every transaction lookup is
 * scoped by `organizationId` + `tenantId` (gateway-service `findTransactionOrThrow` /
 * `findTransaction`, and the transactions/[id] route's `findOneWithDecryption`). A user
 * from organization B therefore can never read or mutate organization A's transaction:
 *   - GET /transactions/[id] and GET /status → 404 (scoped lookup returns null)
 *   - POST /capture | /refund | /cancel      → 502 (service throws 'Transaction not found',
 *                                                    which the route maps to a gateway error)
 * The owning user is unaffected and can still read and capture their own transaction.
 */
const PASSWORD = 'Qa!2026Pgwy'
const PAYMENT_FEATURES = [
  'payment_gateways.view',
  'payment_gateways.manage',
  'payment_gateways.capture',
  'payment_gateways.refund',
]
const unique = () => `${Date.now()}-${randomUUID().slice(0, 12)}`

test.describe('TC-PGWY-016: Cross-organization isolation', () => {
  test('denies a different-org user read/mutation access to a transaction', async ({ request }) => {
    const superToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    expect(tenantId, 'admin token must carry a concrete tenant').toBeTruthy()

    let org1Id: string | null = null
    let org2Id: string | null = null
    let roleId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null

    try {
      org1Id = await createOrganizationFixture(request, superToken, { name: `QA PGWY Org A ${unique()}`, tenantId })
      org2Id = await createOrganizationFixture(request, superToken, { name: `QA PGWY Org B ${unique()}`, tenantId })

      roleId = await createRoleFixture(request, superToken, { name: `qa-pgwy-full-${unique()}`, tenantId })
      await setRoleAclFeatures(request, superToken, { roleId, features: PAYMENT_FEATURES })

      const userAEmail = `qa-pgwy-a-${unique()}@acme.com`
      userAId = await createUserFixture(request, superToken, {
        email: userAEmail,
        password: PASSWORD,
        organizationId: org1Id,
        roles: [roleId],
        name: 'QA PGWY User A',
      })
      const userBEmail = `qa-pgwy-b-${unique()}@acme.com`
      userBId = await createUserFixture(request, superToken, {
        email: userBEmail,
        password: PASSWORD,
        organizationId: org2Id,
        roles: [roleId],
        name: 'QA PGWY User B',
      })

      const tokenA = await getAuthToken(request, userAEmail, PASSWORD)
      const tokenB = await getAuthToken(request, userBEmail, PASSWORD)

      const session = await createPaymentSession(request, tokenA, {
        providerKey: 'mock',
        amount: 64.0,
        currencyCode: 'USD',
        captureMethod: 'manual',
      })
      expect(session.transactionId, 'org A user creates a transaction').toBeTruthy()

      const detailAsB = await apiRequest(request, 'GET', `/api/payment_gateways/transactions/${session.transactionId}`, { token: tokenB })
      expect(detailAsB.status(), 'cross-org transaction detail is not found').toBe(404)

      const statusAsB = await apiRequest(request, 'GET', `/api/payment_gateways/status?transactionId=${session.transactionId}`, { token: tokenB })
      expect(statusAsB.status(), 'cross-org status is not found').toBe(404)
      const statusAsBBody = await readJsonSafe<{ error?: string }>(statusAsB)
      expect(statusAsBBody?.error, 'status reports transaction not found').toMatch(/not found/i)

      const captureAsB = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
        token: tokenB,
        data: { transactionId: session.transactionId },
      })
      expect(captureAsB.status(), 'cross-org capture cannot resolve the transaction').toBe(502)
      const captureAsBBody = await readJsonSafe<{ error?: string }>(captureAsB)
      expect(captureAsBBody?.error, 'capture reports transaction not found').toMatch(/not found/i)

      const refundAsB = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
        token: tokenB,
        data: { transactionId: session.transactionId },
      })
      expect(refundAsB.status(), 'cross-org refund cannot resolve the transaction').toBe(502)

      const cancelAsB = await apiRequest(request, 'POST', '/api/payment_gateways/cancel', {
        token: tokenB,
        data: { transactionId: session.transactionId },
      })
      expect(cancelAsB.status(), 'cross-org cancel cannot resolve the transaction').toBe(502)

      const listAsB = await apiRequest(request, 'GET', '/api/payment_gateways/transactions', { token: tokenB })
      expect(listAsB.status(), 'org B can list its own (empty) transactions').toBe(200)
      const listAsBBody = await readJsonSafe<{ items: Array<{ id: string }> }>(listAsB)
      expect((listAsBBody?.items ?? []).some((item) => item.id === session.transactionId), 'org B never sees org A rows').toBe(false)

      const detailAsA = await apiRequest(request, 'GET', `/api/payment_gateways/transactions/${session.transactionId}`, { token: tokenA })
      expect(detailAsA.status(), 'owner can read its own transaction').toBe(200)

      const captureAsA = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
        token: tokenA,
        data: { transactionId: session.transactionId },
      })
      expect(captureAsA.status(), 'owner can capture its own transaction').toBe(200)
    } finally {
      await deleteUserIfExists(request, superToken, userAId)
      await deleteUserIfExists(request, superToken, userBId)
      await deleteRoleIfExists(request, superToken, roleId)
      await deleteOrganizationIfExists(request, superToken, org1Id)
      await deleteOrganizationIfExists(request, superToken, org2Id)
    }
  })
})
