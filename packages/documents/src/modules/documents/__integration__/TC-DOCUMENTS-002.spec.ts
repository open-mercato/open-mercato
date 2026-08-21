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

const DOCUMENTS_USER_FEATURES = ['documents.view', 'documents.edit']

function uniqueEmail(label: string): string {
  return `tc-documents-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`
}

function policyPassword(label: string): string {
  return `Docs${label}1!${Date.now()}`
}

async function createDocumentsUser(
  request: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<DocumentsTestUser> {
  const scope = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOCUMENTS-002 ${label} ${Date.now()}`,
    tenantId: scope.tenantId,
  })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features: DOCUMENTS_USER_FEATURES,
  })

  const email = uniqueEmail(label)
  const password = policyPassword(label)
  const id = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId: scope.organizationId,
    roles: [roleId],
    name: `TC Documents ${label}`,
  })
  const token = await getAuthToken(request, email, password)
  return { id, roleId, email, password, token }
}

async function deleteDocumentIfExists(
  request: APIRequestContext,
  token: string | null,
  documentId: string | null,
): Promise<void> {
  if (!token || !documentId) return
  await apiRequest(request, 'DELETE', `/api/documents/${encodeURIComponent(documentId)}`, { token })
    .catch(() => undefined)
}

async function deleteShareIfExists(
  request: APIRequestContext,
  token: string | null,
  documentId: string | null,
  shareId: string | null,
): Promise<void> {
  if (!token || !documentId || !shareId) return
  await apiRequest(request, 'DELETE', `/api/documents/${encodeURIComponent(documentId)}/shares`, {
    token,
    data: { id: shareId },
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
  expect(typeof body?.updatedAt).toBe('string')
  return {
    id: expectId(body?.id, `share ${permission} response should include id`),
    updatedAt: body?.updatedAt as string,
  }
}

test.describe('TC-DOCUMENTS-002: sharing tiers', () => {
  test('enforces viewer, commenter, editor, non-shared, and re-share behavior', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let sharedUser: DocumentsTestUser | null = null
    let nonSharedUser: DocumentsTestUser | null = null
    let documentId: string | null = null
    let shareId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      sharedUser = await createDocumentsUser(request, adminToken, 'shared')
      nonSharedUser = await createDocumentsUser(request, adminToken, 'nonshared')

      const createDocumentResponse = await apiRequest(request, 'POST', '/api/documents', {
        token: adminToken,
        data: { title: `TC-DOCUMENTS-002 ${stamp}`, folderId: null },
      })
      const createDocumentBody = await readJsonSafe<MutationBody>(createDocumentResponse)
      expect(createDocumentResponse.status(), 'owner should create a document').toBe(201)
      documentId = expectId(createDocumentBody?.id, 'document create response should include id')

      const viewerShare = await shareWithUser(request, adminToken, documentId, sharedUser.id, 'viewer')
      shareId = viewerShare.id
      const viewerGetResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}`,
        { token: sharedUser.token },
      )
      expect(viewerGetResponse.status(), 'viewer should read the document').toBe(200)
      const viewerContentPutResponse = await apiRequest(
        request,
        'PUT',
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        {
          token: sharedUser.token,
          data: { contentHtml: '<p>viewer write</p>', contentText: 'viewer write' },
        },
      )
      expect(viewerContentPutResponse.status(), 'viewer content write should be tier-denied').toBe(403)

      const commenterShare = await shareWithUser(request, adminToken, documentId, sharedUser.id, 'commenter')
      shareId = commenterShare.id
      const commenterCommentResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments`,
        {
          token: sharedUser.token,
          data: { body: `TC-DOCUMENTS-002 comment ${stamp}`, anchor: null, parentCommentId: null },
        },
      )
      expect(commenterCommentResponse.status(), 'commenter should create a comment').toBe(201)
      const commenterContentPutResponse = await apiRequest(
        request,
        'PUT',
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        {
          token: sharedUser.token,
          data: { contentHtml: '<p>commenter write</p>', contentText: 'commenter write' },
        },
      )
      expect(commenterContentPutResponse.status(), 'commenter content write should be tier-denied').toBe(403)

      const editorShare = await shareWithUser(request, adminToken, documentId, sharedUser.id, 'editor')
      shareId = editorShare.id
      const editorContentPutResponse = await apiRequest(
        request,
        'PUT',
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        {
          token: sharedUser.token,
          data: { contentHtml: '<p>editor write</p>', contentText: 'editor write' },
        },
      )
      expect(editorContentPutResponse.status(), 'editor should write content').toBe(200)

      const nonSharedGetResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}`,
        { token: nonSharedUser.token },
      )
      expect(nonSharedGetResponse.status(), 'non-shared user should be tier-denied').toBe(403)

      const deletedShareId = shareId
      await deleteShareIfExists(request, adminToken, documentId, shareId)
      shareId = null

      const reShare = await shareWithUser(request, adminToken, documentId, sharedUser.id, 'viewer')
      shareId = reShare.id
      // Re-share is a guarded resurrection of the same soft-deleted row. This
      // keeps one durable principal identity and lets the new command's undo
      // restore the exact deleted snapshot without accumulating stale rows.
      expect(reShare.id).toBe(deletedShareId)
    } finally {
      await deleteShareIfExists(request, adminToken, documentId, shareId)
      await deleteDocumentIfExists(request, adminToken, documentId)
      await deleteUserIfExists(request, adminToken, sharedUser?.id ?? null)
      await deleteRoleIfExists(request, adminToken, sharedUser?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, nonSharedUser?.id ?? null)
      await deleteRoleIfExists(request, adminToken, nonSharedUser?.roleId ?? null)
    }
  })
})
