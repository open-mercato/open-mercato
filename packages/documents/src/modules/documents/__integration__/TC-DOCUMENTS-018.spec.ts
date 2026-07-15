import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['documents', 'api_keys'],
}

const BASE_URL = process.env.BASE_URL?.trim() || null
const PASSWORD = 'DocsApiKey1!Valid'
const DOCUMENT_OWNER_FEATURES = [
  'documents.view',
  'documents.create',
  'documents.edit',
  'documents.delete',
  'documents.share',
]

type CreatedDocument = { id: string; updatedAt: string }
type CreatedApiKey = { id: string; secret: string }

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
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
  expect(response.status(), 'tenant fixture should be created').toBe(201)
  return expectId(body?.id, 'tenant fixture response should include id')
}

async function createDocumentsUser(
  request: APIRequestContext,
  adminToken: string,
  input: { label: string; tenantId: string; organizationId: string },
): Promise<{ id: string; roleId: string; token: string }> {
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOCUMENTS-018 ${input.label} ${Date.now()}`,
    tenantId: input.tenantId,
  })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features: DOCUMENT_OWNER_FEATURES,
    organizations: [input.organizationId],
  })
  const email = `tc-documents-018-${input.label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId: input.organizationId,
    roles: [roleId],
    name: `TC Documents 018 ${input.label}`,
  })
  return { id, roleId, token: await getAuthToken(request, email, PASSWORD) }
}

async function createDocument(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<CreatedDocument> {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<{ id?: string; updatedAt?: string }>(response)
  expect(response.status(), 'document fixture should be created').toBe(201)
  expect(typeof body?.updatedAt).toBe('string')
  return {
    id: expectId(body?.id, 'document fixture response should include id'),
    updatedAt: body?.updatedAt as string,
  }
}

async function deleteDocumentIfExists(
  request: APIRequestContext,
  token: string | null,
  document: CreatedDocument | null,
): Promise<void> {
  if (!token || !document) return
  await request.fetch(resolveUrl(`/api/documents/${encodeURIComponent(document.id)}`), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      [OPTIMISTIC_LOCK_HEADER_NAME]: document.updatedAt,
    },
  }).catch(() => undefined)
}

async function createApiKey(
  request: APIRequestContext,
  adminToken: string,
  input: {
    name: string
    tenantId: string
    organizationId: string
    roleId: string
    expiresAt?: string
  },
): Promise<CreatedApiKey> {
  const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
    token: adminToken,
    data: {
      name: input.name,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      roles: [input.roleId],
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    },
  })
  const body = await readJsonSafe<{ id?: string; secret?: string }>(response)
  expect(response.status(), 'API key fixture should be created').toBe(201)
  expect(typeof body?.secret === 'string' && body.secret.startsWith('omk_')).toBe(true)
  return {
    id: expectId(body?.id, 'API key response should include id'),
    secret: body?.secret as string,
  }
}

async function deleteApiKeyIfExists(
  request: APIRequestContext,
  adminToken: string | null,
  keyId: string | null,
): Promise<void> {
  if (!adminToken || !keyId) return
  await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(keyId)}`, {
    token: adminToken,
  }).catch(() => undefined)
}

async function getDocumentWithApiKey(
  request: APIRequestContext,
  secret: string,
  documentId: string,
) {
  return request.fetch(resolveUrl(`/api/documents/${encodeURIComponent(documentId)}`), {
    headers: { Authorization: `ApiKey ${secret}` },
  })
}

test.describe('TC-DOCUMENTS-018: real API-key role-share authorization', () => {
  test('honors live key roles and fails closed after expiry, revocation, deletion, or scope mismatch', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let superadminToken: string | null = null
    let owner: { id: string; roleId: string; token: string } | null = null
    let otherOrgOwner: { id: string; roleId: string; token: string } | null = null
    let otherTenantOwner: { id: string; roleId: string; token: string } | null = null
    let keyRoleId: string | null = null
    let activeKey: CreatedApiKey | null = null
    let expiringKey: CreatedApiKey | null = null
    let homeDocument: CreatedDocument | null = null
    let otherOrgDocument: CreatedDocument | null = null
    let otherTenantDocument: CreatedDocument | null = null
    let otherOrganizationId: string | null = null
    let otherTenantId: string | null = null
    let otherTenantOrganizationId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      superadminToken = await getAuthToken(request, 'superadmin')
      const homeScope = getTokenContext(adminToken)

      owner = await createDocumentsUser(request, adminToken, {
        label: 'owner',
        tenantId: homeScope.tenantId,
        organizationId: homeScope.organizationId,
      })
      homeDocument = await createDocument(request, owner.token, `TC-DOCUMENTS-018 home ${stamp}`)

      keyRoleId = await createRoleFixture(request, adminToken, {
        name: `TC-DOCUMENTS-018 API key ${stamp}`,
        tenantId: homeScope.tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId: keyRoleId,
        features: ['documents.view'],
        organizations: [homeScope.organizationId],
      })
      const shareResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(homeDocument.id)}/shares`,
        {
          token: owner.token,
          data: { principalType: 'role', principalId: keyRoleId, permission: 'viewer' },
        },
      )
      expect(shareResponse.status(), 'owner should share the document with the API-key role').toBe(201)

      activeKey = await createApiKey(request, adminToken, {
        name: `TC-DOCUMENTS-018 active ${stamp}`,
        tenantId: homeScope.tenantId,
        organizationId: homeScope.organizationId,
        roleId: keyRoleId,
      })
      expect((await getDocumentWithApiKey(request, activeKey.secret, homeDocument.id)).status()).toBe(200)

      otherOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-DOCUMENTS-018 other org ${stamp}`,
        tenantId: homeScope.tenantId,
      })
      otherOrgOwner = await createDocumentsUser(request, superadminToken, {
        label: 'other-org',
        tenantId: homeScope.tenantId,
        organizationId: otherOrganizationId,
      })
      otherOrgDocument = await createDocument(request, otherOrgOwner.token, `TC-DOCUMENTS-018 other org ${stamp}`)
      expect([403, 404]).toContain(
        (await getDocumentWithApiKey(request, activeKey.secret, otherOrgDocument.id)).status(),
      )

      otherTenantId = await createTenantFixture(request, superadminToken, `TC-DOCUMENTS-018 tenant ${stamp}`)
      otherTenantOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-DOCUMENTS-018 tenant org ${stamp}`,
        tenantId: otherTenantId,
      })
      otherTenantOwner = await createDocumentsUser(request, superadminToken, {
        label: 'other-tenant',
        tenantId: otherTenantId,
        organizationId: otherTenantOrganizationId,
      })
      otherTenantDocument = await createDocument(
        request,
        otherTenantOwner.token,
        `TC-DOCUMENTS-018 other tenant ${stamp}`,
      )
      expect([403, 404]).toContain(
        (await getDocumentWithApiKey(request, activeKey.secret, otherTenantDocument.id)).status(),
      )

      await setRoleAclFeatures(request, adminToken, {
        roleId: keyRoleId,
        features: [],
        organizations: [homeScope.organizationId],
      })
      expect([401, 403]).toContain(
        (await getDocumentWithApiKey(request, activeKey.secret, homeDocument.id)).status(),
      )
      await setRoleAclFeatures(request, adminToken, {
        roleId: keyRoleId,
        features: ['documents.view'],
        organizations: [homeScope.organizationId],
      })

      expiringKey = await createApiKey(request, adminToken, {
        name: `TC-DOCUMENTS-018 expiring ${stamp}`,
        tenantId: homeScope.tenantId,
        organizationId: homeScope.organizationId,
        roleId: keyRoleId,
        expiresAt: new Date(Date.now() + 1_500).toISOString(),
      })
      expect((await getDocumentWithApiKey(request, expiringKey.secret, homeDocument.id)).status()).toBe(200)
      await new Promise((resolve) => setTimeout(resolve, 1_700))
      expect([401, 403]).toContain(
        (await getDocumentWithApiKey(request, expiringKey.secret, homeDocument.id)).status(),
      )

      await deleteApiKeyIfExists(request, adminToken, activeKey.id)
      const deletedSecret = activeKey.secret
      activeKey = null
      expect([401, 403]).toContain(
        (await getDocumentWithApiKey(request, deletedSecret, homeDocument.id)).status(),
      )
    } finally {
      await deleteApiKeyIfExists(request, adminToken, activeKey?.id ?? null)
      await deleteApiKeyIfExists(request, adminToken, expiringKey?.id ?? null)
      await deleteDocumentIfExists(request, owner?.token ?? null, homeDocument)
      await deleteDocumentIfExists(request, otherOrgOwner?.token ?? null, otherOrgDocument)
      await deleteDocumentIfExists(request, otherTenantOwner?.token ?? null, otherTenantDocument)
      await deleteUserIfExists(request, superadminToken, otherTenantOwner?.id ?? null)
      await deleteRoleIfExists(request, superadminToken, otherTenantOwner?.roleId ?? null)
      await deleteUserIfExists(request, superadminToken, otherOrgOwner?.id ?? null)
      await deleteRoleIfExists(request, superadminToken, otherOrgOwner?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, owner?.id ?? null)
      await deleteRoleIfExists(request, adminToken, owner?.roleId ?? null)
      await deleteRoleIfExists(request, adminToken, keyRoleId)
      await deleteOrganizationIfExists(request, superadminToken, otherTenantOrganizationId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', otherTenantId)
      await deleteOrganizationIfExists(request, superadminToken, otherOrganizationId)
    }
  })
})
