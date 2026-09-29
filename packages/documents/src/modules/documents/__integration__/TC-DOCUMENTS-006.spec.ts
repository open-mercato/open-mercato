import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

type MutationBody = {
  id?: string
  updatedAt?: string
  ok?: boolean
}

type DocumentsTestUser = {
  id: string
  roleId: string
  email: string
  password: string
  token: string
}

const DOCUMENTS_VIEW_FEATURES = ['documents.view']
const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function uniqueEmail(label: string): string {
  return `tc-documents-006-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`
}

function policyPassword(label: string): string {
  return `Docs${label}1!${Date.now()}`
}

function expectUpdatedAt(value: unknown, message: string): string {
  expect(typeof value === 'string' && value.length > 0, message).toBe(true)
  return value as string
}

async function createDocumentsUser(
  request: APIRequestContext,
  adminToken: string,
  label: string,
  features: string[] = DOCUMENTS_VIEW_FEATURES,
): Promise<DocumentsTestUser> {
  const scope = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOCUMENTS-006 ${label} ${Date.now()}`,
    tenantId: scope.tenantId,
  })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features,
  })

  const email = uniqueEmail(label)
  const password = policyPassword(label)
  const id = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId: scope.organizationId,
    roles: [roleId],
    name: `TC Documents 006 ${label}`,
  })
  const token = await getAuthToken(request, email, password)
  return { id, roleId, email, password, token }
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
  await request.fetch(resolveUrl(`/api/documents/${encodeURIComponent(documentId)}`), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : {}),
    },
  }).catch(() => undefined)
}

async function shareWithUser(
  request: APIRequestContext,
  token: string,
  documentId: string,
  userId: string,
  permission: 'viewer' | 'commenter' | 'editor',
): Promise<{ id: string; updatedAt: string }> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/documents/${encodeURIComponent(documentId)}/shares`,
    {
      token,
      data: { principalType: 'user', principalId: userId, permission },
    },
  )
  const body = await readJsonSafe<MutationBody>(response)
  expect(response.status(), `share ${permission} should return 201`).toBe(201)
  return {
    id: expectId(body?.id, `share ${permission} response should include id`),
    updatedAt: expectUpdatedAt(body?.updatedAt, `share ${permission} response should include updatedAt`),
  }
}

async function putContent(
  request: APIRequestContext,
  token: string,
  documentId: string,
  contentHtml: string,
  contentText: string,
): Promise<void> {
  const response = await apiRequest(
    request,
    'PUT',
    `/api/documents/${encodeURIComponent(documentId)}/content`,
    { token, data: { contentHtml, contentText } },
  )
  const body = await readJsonSafe<MutationBody>(response)
  expect(response.status(), 'PUT /api/documents/[id]/content should return 200').toBe(200)
  expect(body?.ok, 'content PUT should report ok=true').toBe(true)
}

test.describe('TC-DOCUMENTS-006: export', () => {
  test('returns valid docx and pdf artifacts for a shared viewer and denies a non-shared user', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let viewer: DocumentsTestUser | null = null
    let nonShared: DocumentsTestUser | null = null
    let documentId: string | null = null
    let documentUpdatedAt: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const document = await createDocument(request, adminToken, `TC-DOCUMENTS-006 ${stamp}`)
      documentId = document.id
      documentUpdatedAt = document.updatedAt
      await putContent(request, adminToken, documentId, '<h1>Title</h1><p>Body text</p>', 'Title Body text')

      viewer = await createDocumentsUser(request, adminToken, 'viewer', DOCUMENTS_VIEW_FEATURES)
      nonShared = await createDocumentsUser(request, adminToken, 'nonshared', DOCUMENTS_VIEW_FEATURES)
      await shareWithUser(request, adminToken, documentId, viewer.id, 'viewer')

      const docxResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/export?format=docx`,
        { token: viewer.token },
      )
      expect(docxResponse.status(), 'shared viewer docx export should return 200').toBe(200)
      expect(docxResponse.headers()['content-type'] ?? '').toContain('wordprocessingml')
      const docxBuffer = await docxResponse.body()
      expect(docxBuffer.length, 'docx export should include a non-empty zip payload').toBeGreaterThan(100)
      expect(docxBuffer.subarray(0, 2).toString('latin1')).toBe('PK')

      const pdfResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/export?format=pdf`,
        { token: viewer.token },
      )
      const pdfStatus = pdfResponse.status()
      expect([200, 503], 'shared viewer pdf export should succeed or be environment-gated').toContain(pdfStatus)
      if (pdfStatus === 200) {
        expect(pdfResponse.headers()['content-type'] ?? '').toContain('application/pdf')
        const pdfBuffer = await pdfResponse.body()
        expect(pdfBuffer.length, 'pdf export should include a non-empty payload').toBeGreaterThan(100)
        expect(pdfBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      } else {
        test.info().annotations.push({
          type: 'skip-reason',
          description: 'PDF export requires Chromium (503)',
        })
      }

      const nonSharedDocxResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/export?format=docx`,
        { token: nonShared.token },
      )
      expect(nonSharedDocxResponse.status(), 'non-shared viewer should be tier-denied from export').toBe(403)
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId, documentUpdatedAt)
      await deleteUserIfExists(request, adminToken, viewer?.id ?? null)
      await deleteRoleIfExists(request, adminToken, viewer?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, nonShared?.id ?? null)
      await deleteRoleIfExists(request, adminToken, nonShared?.roleId ?? null)
    }
  })
})
