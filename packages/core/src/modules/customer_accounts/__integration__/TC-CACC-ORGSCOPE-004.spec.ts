import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  customerTestPassword,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CACC-ORGSCOPE-004 [P1]: admin customer-user detail and actions never cross tenants (#5577).
 *
 * The detail routes now follow the organization switcher, including "All organizations". A
 * customer user of another tenant must stay invisible and untouched for a tenant admin, both under
 * "All organizations" and when the request forges the other tenant and organization selection.
 * Covers: GET/PUT/DELETE /api/customer_accounts/admin/users/[id],
 * POST /api/customer_accounts/admin/users/[id]/verify-email.
 */
const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function scopeCookie(tenantId: string, organizationId: string): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent(organizationId)}`,
  ].join('; ')
}

async function scopedRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(resolveUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

type CustomerUserDetail = {
  displayName?: string
  emailVerified?: boolean
  updatedAt?: string | null
}

test.describe('TC-CACC-ORGSCOPE-004: customer user detail never crosses tenants (#5577)', () => {
  test('hides and protects a customer user of another tenant', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(adminToken)
    expectId(tenantId, 'admin token should carry a tenant')

    const suffix = uniqueSuffix()
    let foreignTenantId: string | null = null
    let foreignOrgId: string | null = null
    let foreignUserId: string | null = null

    try {
      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `QA CACC ORGSCOPE4 foreign tenant ${suffix}` },
      })
      expect(tenantResponse.status(), 'Foreign tenant fixture should be created').toBe(201)
      const tenantBody = await readJsonSafe<{ id?: string }>(tenantResponse)
      foreignTenantId = expectId(tenantBody?.id, 'Tenant creation response should include id')
      foreignOrgId = await createOrganizationFixture(request, superadminToken, {
        name: `QA CACC ORGSCOPE4 foreign org ${suffix}`,
        tenantId: foreignTenantId,
      })
      const foreignScope = scopeCookie(foreignTenantId, foreignOrgId)

      const created = await scopedRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: superadminToken,
        cookie: foreignScope,
        data: {
          email: `qa-cacc-orgscope4-${suffix}@test.local`,
          password: customerTestPassword(),
          displayName: `QA CACC ORGSCOPE4 ${suffix}`,
        },
      })
      expect(created.status(), 'POST /admin/users in the foreign tenant should return 201').toBe(201)
      const createdBody = await readJsonSafe<{ user?: { id?: string } }>(created)
      foreignUserId = expectId(createdBody?.user?.id, 'User creation response should include user.id')
      const path = `/api/customer_accounts/admin/users/${foreignUserId}`

      const readAsOwner = async () => {
        const res = await scopedRequest(request, 'GET', path, { token: superadminToken, cookie: foreignScope })
        expect(res.status(), 'the owning tenant still reads its user').toBe(200)
        return (await readJsonSafe<CustomerUserDetail>(res)) ?? {}
      }
      const before = await readAsOwner()

      const attempts: Array<{ label: string; cookie: string }> = [
        { label: 'All organizations of the admin tenant', cookie: scopeCookie(tenantId, '__all__') },
        { label: 'forged foreign tenant and organization selection', cookie: foreignScope },
      ]
      for (const attempt of attempts) {
        const read = await scopedRequest(request, 'GET', path, { token: adminToken, cookie: attempt.cookie })
        expect(read.status(), `GET (${attempt.label})`).toBe(404)

        const update = await scopedRequest(request, 'PUT', path, {
          token: adminToken,
          cookie: attempt.cookie,
          data: { displayName: `Cross-tenant overwrite ${suffix}` },
        })
        expect([403, 404], `PUT (${attempt.label})`).toContain(update.status())

        const verify = await scopedRequest(request, 'POST', `${path}/verify-email`, { token: adminToken, cookie: attempt.cookie })
        expect([403, 404], `verify-email (${attempt.label})`).toContain(verify.status())

        const removal = await scopedRequest(request, 'DELETE', path, { token: adminToken, cookie: attempt.cookie })
        expect([403, 404], `DELETE (${attempt.label})`).toContain(removal.status())
      }

      const after = await readAsOwner()
      expect(after.displayName, 'display name unchanged').toBe(before.displayName)
      expect(after.emailVerified, 'email verification unchanged').toBe(before.emailVerified)
      expect(after.updatedAt, 'record version unchanged').toBe(before.updatedAt)
    } finally {
      if (foreignUserId && foreignTenantId && foreignOrgId) {
        await scopedRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${foreignUserId}`, {
          token: superadminToken,
          cookie: scopeCookie(foreignTenantId, foreignOrgId),
        }).catch(() => undefined)
      }
      if (foreignOrgId) {
        await apiRequest(request, 'DELETE', '/api/directory/organizations', {
          token: superadminToken,
          data: { id: foreignOrgId },
        }).catch(() => undefined)
      }
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })
})
