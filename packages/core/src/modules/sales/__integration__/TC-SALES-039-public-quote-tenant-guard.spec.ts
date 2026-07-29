import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'

type CreateResponse = { id?: string }
type AcceptResponse = { error?: string; orderId?: string }

function appBaseUrl(): string {
  const baseUrl = new URL(process.env.BASE_URL || 'http://localhost:3000')
  if (baseUrl.hostname === '127.0.0.1') baseUrl.hostname = 'localhost'
  return baseUrl.origin
}

function scopeCookie(tenantId: string | null, organizationId: string | null): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId ?? '')}`,
    `om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`,
  ].join('; ')
}

async function scopedRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(`${appBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Cookie: options.cookie,
      'Content-Type': 'application/json',
      Origin: appBaseUrl(),
    },
    data: options.data,
  })
}

/**
 * TC-SALES-039: A superadmin whose selected tenant is "all tenants" must still be treated as
 * an actor from their home tenant when opening or accepting another tenant's public quote.
 *
 * Covers:
 * - GET /api/sales/quotes/public/[token]
 * - POST /api/sales/quotes/accept
 */
test.describe('TC-SALES-039: Public quote tenant guard', () => {
  test('rejects cross-tenant view and acceptance for an all-tenants superadmin session', async ({
    request,
  }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const actorScope = getTokenContext(superadminToken)
    const stamp = Date.now()
    const publicToken = crypto.randomUUID()
    const allTenantsCookie = scopeCookie(null, null)

    let foreignTenantId: string | null = null
    let foreignOrganizationId: string | null = null
    let quoteId: string | null = null
    let unexpectedOrderId: string | null = null

    try {
      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `QA SALES 039 Tenant ${stamp}` },
      })
      expect(tenantResponse.status(), 'tenant fixture should be created').toBe(201)
      foreignTenantId = expectId(
        (await readJsonSafe<CreateResponse>(tenantResponse))?.id,
        'tenant create response should contain an id',
      )
      expect(foreignTenantId).not.toBe(actorScope.tenantId)

      const organizationResponse = await apiRequest(
        request,
        'POST',
        '/api/directory/organizations',
        {
          token: superadminToken,
          data: {
            tenantId: foreignTenantId,
            name: `QA SALES 039 Organization ${stamp}`,
          },
        },
      )
      expect(organizationResponse.status(), 'organization fixture should be created').toBe(201)
      foreignOrganizationId = expectId(
        (await readJsonSafe<CreateResponse>(organizationResponse))?.id,
        'organization create response should contain an id',
      )

      const foreignScopeCookie = scopeCookie(foreignTenantId, foreignOrganizationId)
      const quoteResponse = await scopedRequest(request, 'POST', '/api/sales/quotes', {
        token: superadminToken,
        cookie: foreignScopeCookie,
        data: { currencyCode: 'USD' },
      })
      expect(quoteResponse.ok(), 'foreign-tenant quote fixture should be created').toBeTruthy()
      quoteId = expectId(
        (await readJsonSafe<CreateResponse>(quoteResponse))?.id,
        'quote create response should contain an id',
      )

      await withClient(async (client) => {
        const result = await client.query(
          `update sales_quotes
             set acceptance_token = $2, status = 'sent', updated_at = now()
           where id = $1`,
          [quoteId, hashAuthToken(publicToken)],
        )
        expect(result.rowCount, 'quote fixture should receive a public token').toBe(1)
      })

      const anonymousView = await request.get(
        `${appBaseUrl()}/api/sales/quotes/public/${encodeURIComponent(publicToken)}`,
      )
      expect(anonymousView.status(), 'the quote link remains intentionally public').toBe(200)

      const foreignView = await scopedRequest(
        request,
        'GET',
        `/api/sales/quotes/public/${encodeURIComponent(publicToken)}`,
        {
          token: superadminToken,
          cookie: allTenantsCookie,
        },
      )
      expect(foreignView.status(), 'cross-tenant signed-in view should be hidden').toBe(404)
      await expect(foreignView.json()).resolves.toMatchObject({ error: 'Quote not found.' })

      const foreignAccept = await scopedRequest(request, 'POST', '/api/sales/quotes/accept', {
        token: superadminToken,
        cookie: allTenantsCookie,
        data: { token: publicToken },
      })
      const acceptBody = await readJsonSafe<AcceptResponse>(foreignAccept)
      unexpectedOrderId = acceptBody?.orderId ?? null
      expect(foreignAccept.status(), 'cross-tenant acceptance should be hidden').toBe(404)
      expect(acceptBody).toMatchObject({ error: 'Quote not found.' })
    } finally {
      if (unexpectedOrderId && foreignTenantId && foreignOrganizationId) {
        await scopedRequest(
          request,
          'DELETE',
          `/api/sales/orders?id=${encodeURIComponent(unexpectedOrderId)}`,
          {
            token: superadminToken,
            cookie: scopeCookie(foreignTenantId, foreignOrganizationId),
          },
        ).catch(() => undefined)
      }
      if (quoteId && foreignTenantId && foreignOrganizationId) {
        await scopedRequest(
          request,
          'DELETE',
          `/api/sales/quotes?id=${encodeURIComponent(quoteId)}`,
          {
            token: superadminToken,
            cookie: scopeCookie(foreignTenantId, foreignOrganizationId),
          },
        ).catch(() => undefined)
      }
      await deleteGeneralEntityIfExists(
        request,
        superadminToken,
        '/api/directory/organizations',
        foreignOrganizationId,
      )
      await deleteGeneralEntityIfExists(
        request,
        superadminToken,
        '/api/directory/tenants',
        foreignTenantId,
      )
    }
  })
})
