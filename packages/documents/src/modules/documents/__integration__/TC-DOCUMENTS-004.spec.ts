import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['documents', 'search'],
}

type MutationBody = {
  id?: string
  updatedAt?: string
  ok?: boolean
}

type DocumentListBody = {
  items?: Array<{ id?: string; title?: string }>
}

type SearchResultItem = {
  entityId?: string
  recordId?: string
  presenter?: { title?: string } | null
}

type SearchBody = {
  results?: SearchResultItem[]
}

const DOCUMENT_ENTITY = 'documents:document'
const DOCUMENTS_MANAGE_FEATURES = [
  'documents.view',
  'documents.edit',
  'documents.delete',
  'documents.manage',
]
const DENIED_STATUSES = [403, 404]
const VALID_PASSWORD = 'Valid1!Pass'

function expectUpdatedAt(value: unknown, message: string): string {
  expect(typeof value === 'string' && value.length > 0, message).toBe(true)
  return value as string
}

function uniqueEmail(label: string, stamp: number): string {
  return `tc-documents-004-${label}-${stamp}-${Math.floor(Math.random() * 1_000_000)}@example.com`
}

async function createTenantFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  return expectId(body?.id, 'tenant create response should include id')
}

async function createDocument(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<{ id: string; updatedAt: string }> {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<MutationBody>(response)
  expect(response.status(), 'POST /api/documents should return 201').toBe(201)
  return {
    id: expectId(body?.id, 'document create response should include id'),
    updatedAt: expectUpdatedAt(body?.updatedAt, 'document create response should include updatedAt'),
  }
}

async function deleteDocumentIfExists(
  request: APIRequestContext,
  token: string | null,
  documentId: string | null,
  updatedAt: string | null,
): Promise<void> {
  if (!token || !documentId) return
  await request.fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : {}),
    },
  }).catch(() => undefined)
}

async function createTenantDocumentUser(
  request: APIRequestContext,
  superadminToken: string,
  input: { tenantId: string; organizationId: string; label: string; stamp: number },
): Promise<{ id: string; roleId: string; token: string; email: string }> {
  const roleId = await createRoleFixture(request, superadminToken, {
    name: `TC-DOCUMENTS-004 ${input.label} ${input.stamp}`,
    tenantId: input.tenantId,
  })
  await setRoleAclFeatures(request, superadminToken, {
    roleId,
    features: DOCUMENTS_MANAGE_FEATURES,
    organizations: null,
  })

  const email = uniqueEmail(input.label, input.stamp)
  const id = await createUserFixture(request, superadminToken, {
    email,
    password: VALID_PASSWORD,
    organizationId: input.organizationId,
    roles: [roleId],
    name: `TC Documents 004 ${input.label}`,
  })
  const token = await getAuthToken(request, email, VALID_PASSWORD)
  return { id, roleId, token, email }
}

function searchDocumentsPath(query: string): string {
  const params = new URLSearchParams({
    q: query,
    limit: '20',
    entityTypes: DOCUMENT_ENTITY,
    strategies: 'fulltext,tokens',
  })
  return `/api/search/search?${params.toString()}`
}

async function readSearchResults(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<{ status: number; results: SearchResultItem[] }> {
  const response = await apiRequest(request, 'GET', searchDocumentsPath(query), { token })
  const body = (await readJsonSafe<SearchBody>(response)) ?? {}
  return {
    status: response.status(),
    results: Array.isArray(body.results) ? body.results : [],
  }
}

test.describe('TC-DOCUMENTS-004: tenant isolation and content search', () => {
  test('denies a different tenant from reading or writing another tenant document', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let superadminToken: string | null = null
    let documentId: string | null = null
    let documentUpdatedAt: string | null = null
    let tenantBId: string | null = null
    let organizationBId: string | null = null
    let tenantBUser: { id: string; roleId: string; token: string; email: string } | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      superadminToken = await getAuthToken(request, 'superadmin')
      const tenantAScope = getTokenScope(adminToken)

      const document = await createDocument(request, adminToken, `TC-DOCUMENTS-004 Tenant A ${stamp}`)
      documentId = document.id
      documentUpdatedAt = document.updatedAt

      tenantBId = await createTenantFixture(request, superadminToken, `TC-DOCUMENTS-004 Tenant B ${stamp}`)
      organizationBId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-DOCUMENTS-004 Org B ${stamp}`,
        tenantId: tenantBId,
      })
      tenantBUser = await createTenantDocumentUser(request, superadminToken, {
        tenantId: tenantBId,
        organizationId: organizationBId,
        label: 'tenant-b',
        stamp,
      })

      const tenantBScope = getTokenScope(tenantBUser.token)
      expect(tenantBScope.tenantId, 'tenant B token should use the fixture tenant').toBe(tenantBId)
      expect(tenantBScope.organizationId, 'tenant B token should use the fixture organization').toBe(organizationBId)
      expect(tenantBScope.tenantId, 'tenant B must differ from tenant A').not.toBe(tenantAScope.tenantId)
      expect(tenantBScope.organizationId, 'tenant B org must differ from tenant A org').not.toBe(tenantAScope.organizationId)

      const readResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}`,
        { token: tenantBUser.token },
      )
      expect(DENIED_STATUSES, 'cross-tenant GET should be denied').toContain(readResponse.status())

      const writeResponse = await apiRequest(
        request,
        'PUT',
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        {
          token: tenantBUser.token,
          data: {
            contentHtml: `<p>cross tenant write ${stamp}</p>`,
            contentText: `cross tenant write ${stamp}`,
          },
        },
      )
      expect(DENIED_STATUSES, 'cross-tenant content PUT should be denied').toContain(writeResponse.status())
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId, documentUpdatedAt)
      await deleteUserIfExists(request, superadminToken, tenantBUser?.id ?? null)
      await deleteRoleIfExists(request, superadminToken, tenantBUser?.roleId ?? null)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/organizations', organizationBId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantBId)
    }
  })

  test('finds a document by title via the permission-filtered list search and does not leak it through global search', async ({ request }) => {
    const stamp = Date.now()
    const titleToken = `QADOCS004TITLE${stamp}${Math.floor(Math.random() * 1_000_000)}`
    const contentToken = `QADOCS004CONTENT${stamp}${Math.floor(Math.random() * 1_000_000)}`
    let token: string | null = null
    let documentId: string | null = null
    let documentUpdatedAt: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const document = await createDocument(request, token, `TC-DOCUMENTS-004 ${titleToken}`)
      documentId = document.id
      documentUpdatedAt = document.updatedAt

      const contentResponse = await apiRequest(
        request,
        'PUT',
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        {
          token,
          data: {
            contentHtml: `<p>Document body contains ${contentToken}</p>`,
            contentText: `Document body contains ${contentToken}`,
          },
        },
      )
      const contentBody = await readJsonSafe<MutationBody>(contentResponse)
      expect(contentResponse.status(), 'PUT /api/documents/[id]/content should return 200').toBe(200)
      expect(contentBody?.ok, 'content PUT should report ok=true').toBe(true)
      expectUpdatedAt(contentBody?.updatedAt, 'content PUT should return the content updatedAt token')

      await expect
        .poll(
          async () => {
            const listResponse = await apiRequest(
              request,
              'GET',
              `/api/documents?search=${encodeURIComponent(titleToken)}&page=1&pageSize=100`,
              { token: token! },
            )
            if (listResponse.status() !== 200) return `status:${listResponse.status()}`
            const listBody = (await readJsonSafe<DocumentListBody>(listResponse)) ?? {}
            const items = Array.isArray(listBody.items) ? listBody.items : []
            return items.some((item) => item.id === documentId && item.title?.includes(titleToken))
              ? 'found'
              : 'missing'
          },
          { timeout: 10_000 },
        )
        .toBe('found')

      await expect
        .poll(
          async () => {
            const listResponse = await apiRequest(
              request,
              'GET',
              `/api/documents?search=${encodeURIComponent(contentToken)}&page=1&pageSize=100`,
              { token: token! },
            )
            if (listResponse.status() !== 200) return `status:${listResponse.status()}`
            const listBody = (await readJsonSafe<DocumentListBody>(listResponse)) ?? {}
            const items = Array.isArray(listBody.items) ? listBody.items : []
            return items.some((item) => item.id === documentId) ? 'found' : 'missing'
          },
          { timeout: 10_000 },
        )
        .toBe('missing')

      const searchResponse = await readSearchResults(request, token, contentToken)
      expect([200, 403], 'global search status should keep its 200/403 contract').toContain(searchResponse.status)
      if (searchResponse.status === 200) {
        expect(
          searchResponse.results.some((result) => result.recordId === documentId),
          'global search must not leak the private document by content token',
        ).toBe(false)
      }
    } finally {
      await deleteDocumentIfExists(request, token, documentId, documentUpdatedAt)
    }
  })
})
