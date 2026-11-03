import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteAttachmentIfExists } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['documents', 'audit_logs'],
}

type MutationBody = {
  id?: string
  updatedAt?: string
}

type UploadBody = {
  id?: string
  attachmentId?: string
  url?: string
}

type AuditListBody = {
  items?: Array<{
    commandId?: string | null
    snapshotAfter?: {
      attachmentId?: string | null
    } | null
  }>
}

type DocumentsViewer = {
  id: string
  roleId: string
  token: string
}

const VIEW_FEATURES = ['documents.view']
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
)

function uniqueEmail(label: string): string {
  return `tc-documents-003-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`
}

async function createViewer(
  request: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<DocumentsViewer> {
  const scope = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOCUMENTS-003 ${label} ${Date.now()}`,
    tenantId: scope.tenantId,
  })
  await setRoleAclFeatures(request, adminToken, { roleId, features: VIEW_FEATURES })
  const email = uniqueEmail(label)
  const password = `DocsViewer1!${Date.now()}`
  const id = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId: scope.organizationId,
    roles: [roleId],
    name: `TC Documents 003 ${label}`,
  })
  const token = await getAuthToken(request, email, password)
  return { id, roleId, token }
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

test.describe('TC-DOCUMENTS-003: doc-scoped image proxy', () => {
  test('allows a shared viewer to read an uploaded image and denies a non-shared user', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let viewer: DocumentsViewer | null = null
    let nonShared: DocumentsViewer | null = null
    let documentId: string | null = null
    let shareId: string | null = null
    let attachmentId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      viewer = await createViewer(request, adminToken, 'viewer')
      nonShared = await createViewer(request, adminToken, 'nonshared')

      const createDocumentResponse = await apiRequest(request, 'POST', '/api/documents', {
        token: adminToken,
        data: { title: `TC-DOCUMENTS-003 ${stamp}`, folderId: null },
      })
      const createDocumentBody = await readJsonSafe<MutationBody>(createDocumentResponse)
      expect(createDocumentResponse.status(), 'owner should create a document').toBe(201)
      documentId = expectId(createDocumentBody?.id, 'document create response should include id')

      const uploadResponse = await request.fetch(
        `/api/documents/${encodeURIComponent(documentId)}/attachments`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
          multipart: {
            file: {
              name: `tc-documents-003-${stamp}.png`,
              mimeType: 'image/png',
              buffer: PNG_1X1,
            },
          },
        },
      )
      const uploadBody = await readJsonSafe<UploadBody>(uploadResponse)
      expect(uploadResponse.status(), 'POST /api/documents/[id]/attachments should return 201').toBe(201)
      attachmentId = expectId(uploadBody?.attachmentId, 'upload response should include attachmentId')
      const url = typeof uploadBody?.url === 'string' ? uploadBody.url : ''
      expect(url).toBe(`/api/documents/${documentId}/attachments/${attachmentId}`)

      const auditResponse = await apiRequest(
        request,
        'GET',
        `/api/audit_logs/audit-logs/actions?resourceKind=${encodeURIComponent('documents:document_attachment')}&pageSize=100`,
        { token: adminToken },
      )
      const auditBody = await readJsonSafe<AuditListBody>(auditResponse)
      expect(auditResponse.status(), 'attachment upload audit list should return 200').toBe(200)
      expect(
        auditBody?.items?.some((entry) => (
          entry.commandId === 'documents.attachment.create'
          && entry.snapshotAfter?.attachmentId === attachmentId
        )),
        'attachment upload should persist a redacted command audit entry',
      ).toBe(true)

      const shareResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/shares`,
        {
          token: adminToken,
          data: { principalType: 'user', principalId: viewer.id, permission: 'viewer' },
        },
      )
      const shareBody = await readJsonSafe<MutationBody>(shareResponse)
      expect(shareResponse.status(), 'viewer share should return 201').toBe(201)
      shareId = expectId(shareBody?.id, 'share response should include id')

      const viewerReadResponse = await request.fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${viewer.token}` },
      })
      expect(viewerReadResponse.status(), 'shared viewer should read the image proxy').toBe(200)
      expect(viewerReadResponse.headers()['content-type']).toContain('image/png')

      const nonSharedReadResponse = await request.fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${nonShared.token}` },
      })
      expect(nonSharedReadResponse.status(), 'non-shared org user should be tier-denied').toBe(403)
    } finally {
      await deleteShareIfExists(request, adminToken, documentId, shareId)
      await deleteDocumentIfExists(request, adminToken, documentId)
      // Document deletion owns document-attachment cleanup. Keep the generic
      // attachment cleanup as a best-effort fallback only when document
      // cleanup could not complete, rather than deleting the provider row
      // before the Documents aggregate can release its link.
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
      await deleteUserIfExists(request, adminToken, viewer?.id ?? null)
      await deleteRoleIfExists(request, adminToken, viewer?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, nonShared?.id ?? null)
      await deleteRoleIfExists(request, adminToken, nonShared?.roleId ?? null)
    }
  })
})
