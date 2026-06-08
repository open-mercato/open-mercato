import { expect, test, type APIRequestContext } from '@playwright/test'
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
 * TC-PGWY-020: Transaction list pagination boundaries
 *
 * Verifies offset/limit math and empty-result handling in an isolated organization that
 * holds exactly 25 transactions (so totals are deterministic), plus a second, freshly
 * created organization with zero transactions:
 *   - page=1&pageSize=5  → 5 items, total=25, totalPages=5
 *   - page=5&pageSize=5  → final 5 items
 *   - page=6&pageSize=5  → 0 items, total/totalPages unchanged
 *   - page=1&pageSize=100 → all 25 items, totalPages=1
 *   - zero-transaction org → items=[], total=0, totalPages=1
 */
const PASSWORD = 'Qa!2026Pgwy'
const TRANSACTION_COUNT = 25
const PAYMENT_FEATURES = [
  'payment_gateways.view',
  'payment_gateways.manage',
  'payment_gateways.capture',
  'payment_gateways.refund',
]
const unique = () => `${Date.now()}-${randomUUID().slice(0, 12)}`

type ListResponse = {
  items: Array<{ id: string }>
  total: number
  page: number
  pageSize: number
  totalPages: number
}

async function listTransactionsPaged(
  request: APIRequestContext,
  token: string,
  page: number,
  pageSize: number,
): Promise<ListResponse | null> {
  const response = await apiRequest(request, 'GET', `/api/payment_gateways/transactions?page=${page}&pageSize=${pageSize}`, { token })
  expect(response.status(), `list page=${page} pageSize=${pageSize} succeeds`).toBe(200)
  return readJsonSafe<ListResponse>(response)
}

test.describe('TC-PGWY-020: Transaction list pagination boundaries', () => {
  let superToken: string
  let filledOrgId: string | null = null
  let emptyOrgId: string | null = null
  let roleId: string | null = null
  let filledUserId: string | null = null
  let emptyUserId: string | null = null
  let filledUserToken: string
  let emptyUserToken: string

  test.beforeAll(async ({ request }) => {
    superToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    expect(tenantId, 'admin token must carry a concrete tenant').toBeTruthy()

    filledOrgId = await createOrganizationFixture(request, superToken, { name: `QA PGWY Page Full ${unique()}`, tenantId })
    emptyOrgId = await createOrganizationFixture(request, superToken, { name: `QA PGWY Page Empty ${unique()}`, tenantId })

    roleId = await createRoleFixture(request, superToken, { name: `qa-pgwy-page-${unique()}`, tenantId })
    await setRoleAclFeatures(request, superToken, { roleId, features: PAYMENT_FEATURES })

    const filledEmail = `qa-pgwy-page-full-${unique()}@acme.com`
    filledUserId = await createUserFixture(request, superToken, {
      email: filledEmail,
      password: PASSWORD,
      organizationId: filledOrgId,
      roles: [roleId],
      name: 'QA PGWY Page Full',
    })
    const emptyEmail = `qa-pgwy-page-empty-${unique()}@acme.com`
    emptyUserId = await createUserFixture(request, superToken, {
      email: emptyEmail,
      password: PASSWORD,
      organizationId: emptyOrgId,
      roles: [roleId],
      name: 'QA PGWY Page Empty',
    })

    filledUserToken = await getAuthToken(request, filledEmail, PASSWORD)
    emptyUserToken = await getAuthToken(request, emptyEmail, PASSWORD)

    for (let index = 0; index < TRANSACTION_COUNT; index += 1) {
      await createPaymentSession(request, filledUserToken, { providerKey: 'mock', amount: 10, currencyCode: 'USD', captureMethod: 'manual' })
    }
  })

  test.afterAll(async ({ request }) => {
    await deleteUserIfExists(request, superToken, filledUserId)
    await deleteUserIfExists(request, superToken, emptyUserId)
    await deleteRoleIfExists(request, superToken, roleId)
    await deleteOrganizationIfExists(request, superToken, filledOrgId)
    await deleteOrganizationIfExists(request, superToken, emptyOrgId)
  })

  test('returns the first full page with a correct total', async ({ request }) => {
    const body = await listTransactionsPaged(request, filledUserToken, 1, 5)
    expect(body?.items.length, 'first page holds pageSize items').toBe(5)
    expect(body?.total, 'total reflects every transaction in the org').toBe(TRANSACTION_COUNT)
    expect(body?.totalPages, '25 items at pageSize 5 spans 5 pages').toBe(5)
  })

  test('returns the final page', async ({ request }) => {
    const body = await listTransactionsPaged(request, filledUserToken, 5, 5)
    expect(body?.items.length, 'last page holds the remaining items').toBe(5)
    expect(body?.total, 'total is stable across pages').toBe(TRANSACTION_COUNT)
  })

  test('returns no items beyond the last page', async ({ request }) => {
    const body = await listTransactionsPaged(request, filledUserToken, 6, 5)
    expect(body?.items.length, 'a page past the end is empty').toBe(0)
    expect(body?.total, 'total still reflects every transaction').toBe(TRANSACTION_COUNT)
    expect(body?.totalPages, 'totalPages is unchanged past the end').toBe(5)
  })

  test('returns all items on a single large page', async ({ request }) => {
    const body = await listTransactionsPaged(request, filledUserToken, 1, 100)
    expect(body?.items.length, 'a 100-row page holds all 25 items').toBe(TRANSACTION_COUNT)
    expect(body?.totalPages, 'all items fit on one page').toBe(1)
  })

  test('returns an empty result for an org with no transactions', async ({ request }) => {
    const body = await listTransactionsPaged(request, emptyUserToken, 1, 20)
    expect(body?.items.length, 'a zero-transaction org returns no items').toBe(0)
    expect(body?.total, 'total is zero').toBe(0)
    expect(body?.totalPages, 'totalPages floors at 1').toBe(1)
  })
})
