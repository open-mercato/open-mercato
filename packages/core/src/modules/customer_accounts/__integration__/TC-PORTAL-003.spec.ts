import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-003 [P1]: Portal users list is scoped to the caller's company
 * (`customerEntityId`), paginated, clamped, and gated by `portal.users.view`.
 *
 * Surface: GET /api/customer_accounts/portal/users
 * Source: issue #2463.
 *
 * Scoping is by `customerEntityId` (an owned CRM company id) AND `tenantId` —
 * NOT by organization. Default pageSize is 25.
 */

type PortalUser = {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
  isActive: boolean
  createdAt: string
  lastLoginAt: string | null
  roles: Array<{ id: string; name: string; slug: string }>
}

type UsersListResponse = {
  ok: boolean
  users?: PortalUser[]
  total?: number
  totalPages?: number
  page?: number
  pageSize?: number
  error?: string
}

const COMPANY_A_SIZE = 3
const COMPANY_B_SIZE = 2

test.describe('TC-PORTAL-003: portal users list scoping and pagination', () => {
  test('lists only same-company users, paginates, clamps, and isolates other companies', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    const createdUserIds: string[] = []
    const createdCompanyIds: string[] = []
    let roleId: string | null = null

    try {
      const companyA = await createCustomerCompanyFixture(request, adminToken)
      const companyB = await createCustomerCompanyFixture(request, adminToken)
      createdCompanyIds.push(companyA, companyB)

      const role = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.users.view'],
      })
      roleId = role.id

      const companyAUsers: string[] = []
      let companyALogin: { email: string; password: string } | null = null
      for (let i = 0; i < COMPANY_A_SIZE; i += 1) {
        const user = await createCustomerUserFixture(request, adminToken, {
          roleIds: [role.id],
          customerEntityId: companyA,
        })
        companyAUsers.push(user.id)
        createdUserIds.push(user.id)
        if (!companyALogin) companyALogin = { email: user.email, password: user.password }
      }

      let companyBLogin: { email: string; password: string } | null = null
      for (let i = 0; i < COMPANY_B_SIZE; i += 1) {
        const user = await createCustomerUserFixture(request, adminToken, {
          roleIds: [role.id],
          customerEntityId: companyB,
        })
        createdUserIds.push(user.id)
        if (!companyBLogin) companyBLogin = { email: user.email, password: user.password }
      }

      const sessionA = await portalLogin(request, {
        email: companyALogin!.email,
        password: companyALogin!.password,
        tenantId,
      })

      // Company A caller: full list scoped to company A only.
      const listRes = await request.get('/api/customer_accounts/portal/users', {
        headers: portalCookieHeaders(sessionA),
      })
      expect(listRes.status(), 'list should be 200').toBe(200)
      const list = await readJsonSafe<UsersListResponse>(listRes)
      expect(list?.ok).toBe(true)
      expect(list?.total).toBe(COMPANY_A_SIZE)
      expect(list?.page).toBe(1)
      expect(list?.pageSize, 'default pageSize is 25').toBe(25)
      expect(list?.totalPages).toBe(1)
      expect(list?.users?.length).toBe(COMPANY_A_SIZE)

      const listedIds = new Set((list?.users ?? []).map((u) => u.id))
      for (const id of companyAUsers) expect(listedIds.has(id), `company A user ${id} should be listed`).toBe(true)

      // Shape + ordering (createdAt DESC: non-increasing across the page).
      for (const entry of list!.users!) {
        expect(typeof entry.id).toBe('string')
        expect(typeof entry.email).toBe('string')
        expect(typeof entry.displayName).toBe('string')
        expect(typeof entry.emailVerified).toBe('boolean')
        expect(typeof entry.isActive).toBe('boolean')
        expect(typeof entry.createdAt).toBe('string')
        expect(Array.isArray(entry.roles)).toBe(true)
      }
      const timestamps = list!.users!.map((u) => Date.parse(u.createdAt))
      for (let i = 1; i < timestamps.length; i += 1) {
        expect(timestamps[i - 1] >= timestamps[i], 'users ordered by createdAt DESC').toBe(true)
      }

      // Pagination: pageSize 2 splits 3 company-A users into 2 + 1 with no overlap.
      const page1Res = await request.get('/api/customer_accounts/portal/users?page=1&pageSize=2', {
        headers: portalCookieHeaders(sessionA),
      })
      const page1 = await readJsonSafe<UsersListResponse>(page1Res)
      expect(page1?.users?.length).toBe(2)
      expect(page1?.total).toBe(COMPANY_A_SIZE)
      expect(page1?.pageSize).toBe(2)
      expect(page1?.totalPages).toBe(2)
      expect(page1?.page).toBe(1)

      const page2Res = await request.get('/api/customer_accounts/portal/users?page=2&pageSize=2', {
        headers: portalCookieHeaders(sessionA),
      })
      const page2 = await readJsonSafe<UsersListResponse>(page2Res)
      expect(page2?.users?.length).toBe(1)
      expect(page2?.page).toBe(2)

      const pagedIds = new Set([
        ...(page1?.users ?? []).map((u) => u.id),
        ...(page2?.users ?? []).map((u) => u.id),
      ])
      expect(pagedIds.size, 'pages cover all company-A users with no overlap').toBe(COMPANY_A_SIZE)

      // Clamping: pageSize > 100 → 100; page < 1 → 1.
      const clampRes = await request.get('/api/customer_accounts/portal/users?page=0&pageSize=500', {
        headers: portalCookieHeaders(sessionA),
      })
      const clamp = await readJsonSafe<UsersListResponse>(clampRes)
      expect(clamp?.pageSize, 'pageSize clamped to 100').toBe(100)
      expect(clamp?.page, 'page clamped to 1').toBe(1)

      // Cross-company isolation: company B caller never sees company A users.
      expect(companyBLogin, 'company B login should exist').toBeTruthy()
      const sessionB = await portalLogin(request, {
        email: companyBLogin!.email,
        password: companyBLogin!.password,
        tenantId,
      })
      const bListRes = await request.get('/api/customer_accounts/portal/users', {
        headers: portalCookieHeaders(sessionB),
      })
      const bList = await readJsonSafe<UsersListResponse>(bListRes)
      expect(bList?.total).toBe(COMPANY_B_SIZE)
      expect(bList?.users?.length).toBe(COMPANY_B_SIZE)
      const bIds = new Set((bList?.users ?? []).map((u) => u.id))
      for (const id of companyAUsers) expect(bIds.has(id), 'company A user must not leak to company B').toBe(false)
    } finally {
      for (const id of createdUserIds) await deleteCustomerUserFixture(request, adminToken, id)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      for (const id of createdCompanyIds) await deleteCustomerCompanyFixture(request, adminToken, id)
    }
  })

  test('returns 403 when the caller has no company association', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let userId: string | null = null

    try {
      const role = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.users.view'],
      })
      roleId = role.id
      // No customerEntityId → no company association.
      const user = await createCustomerUserFixture(request, adminToken, { roleIds: [role.id] })
      userId = user.id
      const session = await portalLogin(request, {
        email: user.email,
        password: user.password,
        tenantId,
      })

      const res = await request.get('/api/customer_accounts/portal/users', {
        headers: portalCookieHeaders(session),
      })
      expect(res.status(), 'no company association should be 403').toBe(403)
      const body = await readJsonSafe<UsersListResponse>(res)
      expect(body?.ok).toBe(false)
      expect(body?.error).toBe('No company association')
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })
})
