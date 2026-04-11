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

function buildScopeCookie(tenantId: string, organizationId: string | null): string {
  const parts = [`om_selected_tenant=${encodeURIComponent(tenantId)}`]
  if (organizationId) {
    parts.push(`om_selected_org=${encodeURIComponent(organizationId)}`)
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
 * TC-UMES-021: shared CRUD scope helper blocks cross-organization direct mutations
 */
test.describe('TC-UMES-021: shared CRUD scope helper blocks cross-organization direct mutations', () => {
  test('should keep direct update/delete scoped to the selected organization', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenContext(token)
    expect(tenantId, 'Superadmin token should include a tenant id').toBeTruthy()

    const rootCookie = buildScopeCookie(tenantId, organizationId || null)
    const suffix = Date.now()
    let organizationAId: string | null = null
    let organizationBId: string | null = null
    let personAId: string | null = null
    let personBId: string | null = null
    let priorityAId: string | null = null
    let priorityBId: string | null = null

    try {
      organizationAId = await createOrganizationInScope(request, token, rootCookie, {
        name: `QA TC-UMES-021 Org A ${suffix}`,
        tenantId,
      })
      organizationBId = await createOrganizationInScope(request, token, rootCookie, {
        name: `QA TC-UMES-021 Org B ${suffix}`,
        tenantId,
      })

      const organizationACookie = buildScopeCookie(tenantId, organizationAId)
      const organizationBCookie = buildScopeCookie(tenantId, organizationBId)

      personAId = await createPersonInScope(request, token, organizationACookie, {
        firstName: `QA-${suffix}`,
        lastName: 'ScopeA',
        displayName: `QA Scope A ${suffix}`,
      })
      personBId = await createPersonInScope(request, token, organizationBCookie, {
        firstName: `QA-${suffix}`,
        lastName: 'ScopeB',
        displayName: `QA Scope B ${suffix}`,
      })

      priorityAId = await createPriorityInScope(request, token, organizationACookie, {
        customerId: personAId,
        priority: 'high',
      })
      priorityBId = await createPriorityInScope(request, token, organizationBCookie, {
        customerId: personBId,
        priority: 'normal',
      })

      const blockedUpdate = await scopedApiRequest(request, 'PUT', '/api/example/customer-priorities', {
        token,
        cookie: organizationBCookie,
        data: { id: priorityAId, priority: 'critical' },
      })
      expect(blockedUpdate.status(), 'Cross-organization update should not find the record').toBe(404)

      const allowedUpdate = await scopedApiRequest(request, 'PUT', '/api/example/customer-priorities', {
        token,
        cookie: organizationBCookie,
        data: { id: priorityBId, priority: 'critical' },
      })
      expect(allowedUpdate.ok(), 'Same-organization update should succeed').toBeTruthy()

      const prioritiesInOrganizationA = await listPrioritiesInScope(request, token, organizationACookie, personAId)
      expect(prioritiesInOrganizationA).toHaveLength(1)
      expect(prioritiesInOrganizationA[0]?.priority).toBe('high')

      const prioritiesInOrganizationB = await listPrioritiesInScope(request, token, organizationBCookie, personBId)
      expect(prioritiesInOrganizationB).toHaveLength(1)
      expect(prioritiesInOrganizationB[0]?.priority).toBe('critical')

      const blockedDelete = await scopedApiRequest(request, 'DELETE', '/api/example/customer-priorities', {
        token,
        cookie: organizationBCookie,
        data: { id: priorityAId },
      })
      expect(blockedDelete.status(), 'Cross-organization delete should not find the record').toBe(404)

      const allowedDelete = await scopedApiRequest(request, 'DELETE', '/api/example/customer-priorities', {
        token,
        cookie: organizationACookie,
        data: { id: priorityAId },
      })
      expect(allowedDelete.ok(), 'Same-organization delete should succeed').toBeTruthy()
      priorityAId = null

      const remainingPrioritiesInOrganizationA = await listPrioritiesInScope(request, token, organizationACookie, personAId)
      expect(remainingPrioritiesInOrganizationA).toHaveLength(0)
    } finally {
      const organizationACookie = organizationAId ? buildScopeCookie(tenantId, organizationAId) : rootCookie
      const organizationBCookie = organizationBId ? buildScopeCookie(tenantId, organizationBId) : rootCookie

      await deleteByBodyIfExists(request, token, organizationBCookie, '/api/example/customer-priorities', priorityBId)
      await deleteByBodyIfExists(request, token, organizationACookie, '/api/example/customer-priorities', priorityAId)
      await deleteByQueryIfExists(request, token, organizationBCookie, '/api/customers/people', personBId)
      await deleteByQueryIfExists(request, token, organizationACookie, '/api/customers/people', personAId)
      await deleteByQueryIfExists(request, token, rootCookie, '/api/directory/organizations', organizationBId)
      await deleteByQueryIfExists(request, token, rootCookie, '/api/directory/organizations', organizationAId)
    }
  })
})
