import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type IdResponse = {
  id?: string | null
}

type PriorityListResponse = {
  items?: Array<{
    id?: string | null
    priority?: string | null
  }>
}

function buildScopeCookie(
  tenantId: string,
  organizationId: string | null,
  options?: { padOrganization?: boolean },
): string {
  const parts = [`om_selected_tenant=${encodeURIComponent(tenantId)}`]
  if (organizationId) {
    const scopedOrganizationId = options?.padOrganization
      ? ` ${organizationId} `
      : organizationId
    parts.push(`om_selected_org=${encodeURIComponent(scopedOrganizationId)}`)
  }
  return parts.join('; ')
}

async function scopedApiRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

async function createOrganizationInScope(
  request: APIRequestContext,
  token: string,
  cookie: string,
  input: { name: string; tenantId: string },
): Promise<string> {
  const response = await scopedApiRequest(request, 'POST', '/api/directory/organizations', {
    token,
    cookie,
    data: input,
  })
  const body = await readJsonSafe<IdResponse>(response)
  expect(response.ok(), `POST /api/directory/organizations failed with ${response.status()}`).toBeTruthy()
  return expectId(body?.id, 'Organization create response should include id')
}

async function createTenant(
  request: APIRequestContext,
  token: string,
  input: { name: string },
): Promise<string> {
  const response = await request.fetch('/api/directory/tenants', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: input,
  })
  const body = await readJsonSafe<IdResponse>(response)
  expect(response.ok(), `POST /api/directory/tenants failed with ${response.status()}`).toBeTruthy()
  return expectId(body?.id, 'Tenant create response should include id')
}

async function createPersonInScope(
  request: APIRequestContext,
  token: string,
  cookie: string,
  input: { firstName: string; lastName: string; displayName: string },
): Promise<string> {
  const response = await scopedApiRequest(request, 'POST', '/api/customers/people', {
    token,
    cookie,
    data: input,
  })
  const body = await readJsonSafe<IdResponse>(response)
  expect(response.ok(), `POST /api/customers/people failed with ${response.status()}`).toBeTruthy()
  return expectId(body?.id, 'Person create response should include id')
}

async function createPriorityInScope(
  request: APIRequestContext,
  token: string,
  cookie: string,
  input: { customerId: string; priority: 'low' | 'normal' | 'high' | 'critical' },
): Promise<string> {
  const response = await scopedApiRequest(request, 'POST', '/api/example/customer-priorities', {
    token,
    cookie,
    data: input,
  })
  const body = await readJsonSafe<IdResponse>(response)
  expect(response.ok(), `POST /api/example/customer-priorities failed with ${response.status()}`).toBeTruthy()
  return expectId(body?.id, 'Priority create response should include id')
}

async function listPrioritiesInScope(
  request: APIRequestContext,
  token: string,
  cookie: string,
  customerId: string,
) {
  const response = await scopedApiRequest(
    request,
    'GET',
    `/api/example/customer-priorities?customerId=${encodeURIComponent(customerId)}&page=1&pageSize=10`,
    { token, cookie },
  )
  expect(response.ok(), `GET /api/example/customer-priorities failed with ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<PriorityListResponse>(response)
  return Array.isArray(body?.items) ? body.items : []
}

async function deleteByQueryIfExists(
  request: APIRequestContext,
  token: string,
  cookie: string,
  path: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await scopedApiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token, cookie }).catch(() => {})
}

async function deleteByBodyIfExists(
  request: APIRequestContext,
  token: string,
  cookie: string,
  path: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await scopedApiRequest(request, 'DELETE', path, { token, cookie, data: { id } }).catch(() => {})
}

/**
 * TC-UMES-021: shared CRUD scope helper trims whitespace-padded organization scope during superadmin tenant override
 */
test.describe('TC-UMES-021: shared CRUD scope helper trims whitespace-padded organization scope during superadmin tenant override', () => {
  test('should normalize whitespace-padded selected organization ids for direct update/delete', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId: actorTenantId, organizationId: actorOrganizationId } = getTokenContext(token)
    expect(actorTenantId, 'Superadmin token should include a tenant id').toBeTruthy()

    const actorScopeCookie = buildScopeCookie(actorTenantId, actorOrganizationId || null)
    const suffix = Date.now()
    let targetTenantId: string | null = null
    let targetOrganizationId: string | null = null
    let targetPersonId: string | null = null
    let targetPriorityId: string | null = null

    try {
      targetTenantId = await createTenant(request, token, {
        name: `QA TC-UMES-021 Tenant ${suffix}`,
      })
      targetOrganizationId = await createOrganizationInScope(request, token, actorScopeCookie, {
        name: `QA TC-UMES-021 Org ${suffix}`,
        tenantId: targetTenantId,
      })

      const exactTargetCookie = buildScopeCookie(targetTenantId, targetOrganizationId)
      const paddedTargetCookie = buildScopeCookie(targetTenantId, targetOrganizationId, {
        padOrganization: true,
      })

      targetPersonId = await createPersonInScope(request, token, exactTargetCookie, {
        firstName: `QA-${suffix}`,
        lastName: 'ScopeTrim',
        displayName: `QA Scope Trim ${suffix}`,
      })

      targetPriorityId = await createPriorityInScope(request, token, exactTargetCookie, {
        customerId: targetPersonId,
        priority: 'normal',
      })

      const trimmedScopeUpdate = await scopedApiRequest(request, 'PUT', '/api/example/customer-priorities', {
        token,
        cookie: paddedTargetCookie,
        data: { id: targetPriorityId, priority: 'critical' },
      })
      expect(
        trimmedScopeUpdate.ok(),
        'Whitespace-padded selected organization should still match the target record during superadmin tenant override update',
      ).toBeTruthy()

      const prioritiesAfterUpdate = await listPrioritiesInScope(
        request,
        token,
        exactTargetCookie,
        targetPersonId,
      )
      expect(prioritiesAfterUpdate).toHaveLength(1)
      expect(prioritiesAfterUpdate[0]?.priority).toBe('critical')

      const trimmedScopeDelete = await scopedApiRequest(request, 'DELETE', '/api/example/customer-priorities', {
        token,
        cookie: paddedTargetCookie,
        data: { id: targetPriorityId },
      })
      expect(
        trimmedScopeDelete.ok(),
        'Whitespace-padded selected organization should still match the target record during superadmin tenant override delete',
      ).toBeTruthy()
      targetPriorityId = null

      const remainingPriorities = await listPrioritiesInScope(
        request,
        token,
        exactTargetCookie,
        targetPersonId,
      )
      expect(remainingPriorities).toHaveLength(0)
    } finally {
      const exactTargetCookie =
        targetTenantId && targetOrganizationId
          ? buildScopeCookie(targetTenantId, targetOrganizationId)
          : actorScopeCookie

      await deleteByBodyIfExists(request, token, exactTargetCookie, '/api/example/customer-priorities', targetPriorityId)
      await deleteByQueryIfExists(request, token, exactTargetCookie, '/api/customers/people', targetPersonId)
      await deleteByQueryIfExists(request, token, actorScopeCookie, '/api/directory/organizations', targetOrganizationId)
      await deleteByQueryIfExists(request, token, actorScopeCookie, '/api/directory/tenants', targetTenantId)
    }
  })
})
