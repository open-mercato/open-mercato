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

type ContentBody = {
  contentHtml?: string
  contentText?: string
  updatedAt?: string | null
  restoredVersionId?: string
  preRestoreVersionId?: string
}

type CommentNode = {
  id?: string
  updatedAt?: string
  resolvedAt?: string | null
  replies?: CommentNode[]
}

type CommentListBody = {
  items?: CommentNode[]
}

type NotificationItem = {
  type?: string
  sourceEntityId?: string | null
  linkHref?: string | null
}

type NotificationListBody = {
  items?: NotificationItem[]
}

type AccessCheckBody = {
  withoutAccess?: string[]
}

type VersionItem = {
  id?: string
  label?: string | null
}

type VersionListBody = {
  items?: VersionItem[]
}

type DocumentsTestUser = {
  id: string
  roleId: string
  email: string
  password: string
  token: string
}

const DOCUMENTS_USER_FEATURES = ['documents.view', 'documents.edit', 'documents.share']
const DOCUMENTS_VIEW_FEATURES = ['documents.view']
const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function uniqueEmail(label: string): string {
  return `tc-documents-005-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`
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
  features: string[] = DOCUMENTS_USER_FEATURES,
): Promise<DocumentsTestUser> {
  const scope = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOCUMENTS-005 ${label} ${Date.now()}`,
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
    name: `TC Documents 005 ${label}`,
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

function findComment(items: CommentNode[] | undefined, commentId: string): CommentNode | null {
  for (const item of items ?? []) {
    if (item.id === commentId) return item
    const child = findComment(item.replies, commentId)
    if (child) return child
  }
  return null
}

async function listComments(
  request: APIRequestContext,
  token: string,
  documentId: string,
): Promise<CommentNode[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/documents/${encodeURIComponent(documentId)}/comments`,
    { token },
  )
  const body = await readJsonSafe<CommentListBody>(response)
  expect(response.status(), 'GET /api/documents/[id]/comments should return 200').toBe(200)
  return Array.isArray(body?.items) ? body.items : []
}

async function checkMentionAccess(
  request: APIRequestContext,
  token: string,
  documentId: string,
  userIds: string[],
): Promise<string[]> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/documents/${encodeURIComponent(documentId)}/comments/access-check`,
    { token, data: { userIds } },
  )
  const body = await readJsonSafe<AccessCheckBody>(response)
  expect(response.status(), 'POST /api/documents/[id]/comments/access-check should return 200').toBe(200)
  return Array.isArray(body?.withoutAccess) ? body.withoutAccess : []
}

async function resolveComment(
  request: APIRequestContext,
  token: string,
  documentId: string,
  commentId: string,
  updatedAt: string,
) {
  let expectedUpdatedAt = updatedAt
  for (const attempt of [0, 1]) {
    const response = await request.fetch(resolveUrl(`/api/documents/${encodeURIComponent(documentId)}/comments`), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        [OPTIMISTIC_LOCK_HEADER_NAME]: expectedUpdatedAt,
      },
      data: { id: commentId, resolved: true },
    })
    if (response.status() !== 409 || attempt === 1) return response
    const comments = await listComments(request, token, documentId)
    const comment = findComment(comments, commentId)
    expectedUpdatedAt = expectUpdatedAt(comment?.updatedAt, 'fresh comment should include updatedAt')
  }
  throw new Error('[internal] comment resolve retry loop exhausted')
}

test.describe('TC-DOCUMENTS-005: comments, mentions, versions', () => {
  test('covers threaded comments, mention notifications, version snapshots, and reversible restore', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let commenter: DocumentsTestUser | null = null
    let viewer: DocumentsTestUser | null = null
    let mentionTarget: DocumentsTestUser | null = null
    let managerWithoutShare: DocumentsTestUser | null = null
    let managerMentionTarget: DocumentsTestUser | null = null
    let documentId: string | null = null
    let documentUpdatedAt: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const document = await createDocument(request, adminToken, `TC-DOCUMENTS-005 ${stamp}`)
      documentId = document.id
      documentUpdatedAt = document.updatedAt
      await putContent(request, adminToken, documentId, '<p>v1 body</p>', 'v1 body')

      commenter = await createDocumentsUser(request, adminToken, 'commenter', DOCUMENTS_USER_FEATURES)
      viewer = await createDocumentsUser(request, adminToken, 'viewer', DOCUMENTS_VIEW_FEATURES)
      mentionTarget = await createDocumentsUser(request, adminToken, 'mention-target', DOCUMENTS_VIEW_FEATURES)
      managerWithoutShare = await createDocumentsUser(
        request,
        adminToken,
        'manager-without-share',
        ['documents.view', 'documents.edit', 'documents.manage'],
      )
      managerMentionTarget = await createDocumentsUser(
        request,
        adminToken,
        'manager-mention-target',
        DOCUMENTS_VIEW_FEATURES,
      )

      await shareWithUser(request, adminToken, documentId, commenter.id, 'commenter')
      await shareWithUser(request, adminToken, documentId, viewer.id, 'viewer')

      const createCommentResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments`,
        {
          token: commenter.token,
          data: { body: 'hello', anchor: { from: 1, to: 3 }, parentCommentId: null },
        },
      )
      const createCommentBody = await readJsonSafe<MutationBody>(createCommentResponse)
      expect(createCommentResponse.status(), 'commenter should create a comment').toBe(201)
      const commentId = expectId(createCommentBody?.id, 'comment create response should include id')
      const commentUpdatedAt = expectUpdatedAt(
        createCommentBody?.updatedAt,
        'comment create response should include updatedAt',
      )

      const viewerCommentResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments`,
        {
          token: viewer.token,
          data: { body: 'viewer denied', anchor: null, parentCommentId: null },
        },
      )
      expect(viewerCommentResponse.status(), 'viewer comment POST should be tier-denied').toBe(403)
      const viewerAccessCheckResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments/access-check`,
        { token: viewer.token, data: { userIds: [mentionTarget.id] } },
      )
      expect(
        viewerAccessCheckResponse.status(),
        'viewer should not enumerate mentioned-user document access',
      ).toBe(403)

      const comments = await listComments(request, commenter.token, documentId)
      expect(findComment(comments, commentId), 'created comment should appear in threaded list').not.toBeNull()

      const resolveCommentResponse = await resolveComment(
        request,
        commenter.token,
        documentId,
        commentId,
        commentUpdatedAt,
      )
      const resolveCommentBody = await readJsonSafe<MutationBody & { resolvedAt?: string | null }>(resolveCommentResponse)
      expect(resolveCommentResponse.status(), 'commenter should resolve a comment').toBe(200)
      expect(typeof resolveCommentBody?.resolvedAt === 'string' && resolveCommentBody.resolvedAt.length > 0).toBe(true)

      const withoutAccessBeforeGrant = await checkMentionAccess(
        request,
        commenter.token,
        documentId,
        [mentionTarget.id],
      )
      expect(withoutAccessBeforeGrant).toContain(mentionTarget.id)

      const commenterGrantAttempt = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments`,
        {
          token: commenter.token,
          data: {
            body: `ping @[${mentionTarget.id}]`,
            anchor: null,
            parentCommentId: null,
            grantAccessTo: [mentionTarget.id],
          },
        },
      )
      expect(
        commenterGrantAttempt.status(),
        'commenter-tier documents.share must not grant mention access',
      ).toBe(403)

      const mentionCommentResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments`,
        {
          token: commenter.token,
          data: {
            body: `ping @[${mentionTarget.id}]`,
            anchor: null,
            parentCommentId: null,
          },
        },
      )
      const mentionCommentBody = await readJsonSafe<MutationBody>(mentionCommentResponse)
      expect(mentionCommentResponse.status(), 'notify-only mention comment POST should return 201').toBe(201)
      const mentionCommentId = expectId(mentionCommentBody?.id, 'mention comment response should include id')
      const notificationPath = `/api/notifications?sourceEntityId=${encodeURIComponent(mentionCommentId)}`

      const skippedMentionNotificationsResponse = await apiRequest(request, 'GET', notificationPath, {
        token: mentionTarget.token,
      })
      const skippedMentionNotificationsBody = await readJsonSafe<NotificationListBody>(skippedMentionNotificationsResponse)
      expect(skippedMentionNotificationsResponse.status(), 'mentioned user should read notifications').toBe(200)
      const skippedMentionItems = Array.isArray(skippedMentionNotificationsBody?.items)
        ? skippedMentionNotificationsBody.items
        : []
      expect(
        skippedMentionItems.length,
        'a commenter with documents.share but without owner tier must not grant access',
      ).toBe(0)
      expect(
        await checkMentionAccess(request, adminToken, documentId, [mentionTarget.id]),
        'lower-tier documents.share must not satisfy the owner-tier side of canShare',
      ).toContain(mentionTarget.id)

      const managerGrantAttempt = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments`,
        {
          token: managerWithoutShare.token,
          data: {
            body: `manager ping @[${managerMentionTarget.id}]`,
            anchor: null,
            parentCommentId: null,
            grantAccessTo: [managerMentionTarget.id],
          },
        },
      )
      expect(
        managerGrantAttempt.status(),
        'manager without documents.share must not grant mention access',
      ).toBe(403)
      expect(
        await checkMentionAccess(request, adminToken, documentId, [managerMentionTarget.id]),
        'documents.manage must not substitute for the documents.share action feature',
      ).toContain(managerMentionTarget.id)

      const grantMentionCommentResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments`,
        {
          token: adminToken,
          data: {
            body: `grant @[${mentionTarget.id}]`,
            anchor: null,
            parentCommentId: null,
            grantAccessTo: [mentionTarget.id],
          },
        },
      )
      const grantMentionCommentBody = await readJsonSafe<MutationBody>(grantMentionCommentResponse)
      expect(grantMentionCommentResponse.status(), 'owner grant mention POST should return 201').toBe(201)
      const grantMentionCommentId = expectId(
        grantMentionCommentBody?.id,
        'grant mention comment response should include id',
      )

      const withoutAccessAfterGrant = await checkMentionAccess(
        request,
        adminToken,
        documentId,
        [mentionTarget.id],
      )
      expect(withoutAccessAfterGrant, 'grant mention should give the target commenter access').not.toContain(mentionTarget.id)

      const grantedTargetDocumentResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}`,
        { token: mentionTarget.token },
      )
      expect(grantedTargetDocumentResponse.status(), 'grant mention target should now open the document').toBe(200)

      const grantedNotificationPath = `/api/notifications?sourceEntityId=${encodeURIComponent(grantMentionCommentId)}`
      const mentionedNotificationsResponse = await apiRequest(request, 'GET', grantedNotificationPath, {
        token: mentionTarget.token,
      })
      const mentionedNotificationsBody = await readJsonSafe<NotificationListBody>(mentionedNotificationsResponse)
      expect(mentionedNotificationsResponse.status(), 'granted mentioned user should read notifications').toBe(200)
      const mentionedItems = Array.isArray(mentionedNotificationsBody?.items)
        ? mentionedNotificationsBody.items
        : []
      expect(mentionedItems.length, 'granted mentioned user should receive a notification').toBeGreaterThanOrEqual(1)
      expect(
        mentionedItems.some((item) =>
          item.type === 'documents.comment.mentioned'
          && item.sourceEntityId === grantMentionCommentId
          && typeof item.linkHref === 'string'
          && item.linkHref.includes(`commentId=${grantMentionCommentId}`),
        ),
        'mention notification should link to the source comment',
      ).toBe(true)

      const viewerNotificationsResponse = await apiRequest(request, 'GET', notificationPath, {
        token: viewer.token,
      })
      const viewerNotificationsBody = await readJsonSafe<NotificationListBody>(viewerNotificationsResponse)
      expect(viewerNotificationsResponse.status(), 'non-mentioned viewer should read notifications').toBe(200)
      const viewerItems = Array.isArray(viewerNotificationsBody?.items) ? viewerNotificationsBody.items : []
      expect(viewerItems.length, 'non-mentioned viewer should not receive the mention notification').toBe(0)

      await shareWithUser(request, adminToken, documentId, commenter.id, 'editor')

      const createVersionResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/versions`,
        { token: commenter.token, data: { label: 'snap-1' } },
      )
      const createVersionBody = await readJsonSafe<VersionItem>(createVersionResponse)
      expect(createVersionResponse.status(), 'editor should create a version').toBe(201)
      const versionId = expectId(createVersionBody?.id, 'version create response should include id')

      const viewerVersionResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/versions`,
        { token: viewer.token, data: { label: 'viewer denied' } },
      )
      expect(viewerVersionResponse.status(), 'viewer version POST should be denied').toBe(403)

      await putContent(request, commenter.token, documentId, '<p>v2 body</p>', 'v2 body')

      const versionsBeforeRestoreResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/versions`,
        { token: commenter.token },
      )
      const versionsBeforeRestoreBody = await readJsonSafe<VersionListBody>(versionsBeforeRestoreResponse)
      expect(versionsBeforeRestoreResponse.status(), 'GET /api/documents/[id]/versions should return 200').toBe(200)
      const versionsBeforeRestore = Array.isArray(versionsBeforeRestoreBody?.items)
        ? versionsBeforeRestoreBody.items
        : []
      expect(versionsBeforeRestore.some((item) => item.id === versionId), 'created snapshot should be listed').toBe(true)

      const restoreResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/restore`,
        { token: commenter.token },
      )
      const restoreBody = await readJsonSafe<ContentBody>(restoreResponse)
      expect(restoreResponse.status(), 'editor should restore a version').toBe(200)
      expect(restoreBody?.restoredVersionId).toBe(versionId)
      const preRestoreVersionId = expectId(
        restoreBody?.preRestoreVersionId,
        'restore response should include preRestoreVersionId',
      )

      const versionsAfterRestoreResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/versions`,
        { token: commenter.token },
      )
      const versionsAfterRestoreBody = await readJsonSafe<VersionListBody>(versionsAfterRestoreResponse)
      expect(versionsAfterRestoreResponse.status(), 'GET versions after restore should return 200').toBe(200)
      const versionsAfterRestore = Array.isArray(versionsAfterRestoreBody?.items)
        ? versionsAfterRestoreBody.items
        : []
      expect(versionsAfterRestore.length, 'restore should add a reversible pre-restore snapshot')
        .toBeGreaterThan(versionsBeforeRestore.length)
      expect(
        versionsAfterRestore.some((item) => item.id === preRestoreVersionId),
        'version list should include the pre-restore snapshot',
      ).toBe(true)

      const restoredContentResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        { token: commenter.token },
      )
      const restoredContentBody = await readJsonSafe<ContentBody>(restoredContentResponse)
      expect(restoredContentResponse.status(), 'GET content after restore should return 200').toBe(200)
      expect(restoredContentBody?.contentHtml).toContain('v1 body')
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId, documentUpdatedAt)
      await deleteUserIfExists(request, adminToken, commenter?.id ?? null)
      await deleteRoleIfExists(request, adminToken, commenter?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, viewer?.id ?? null)
      await deleteRoleIfExists(request, adminToken, viewer?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, mentionTarget?.id ?? null)
      await deleteRoleIfExists(request, adminToken, mentionTarget?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, managerWithoutShare?.id ?? null)
      await deleteRoleIfExists(request, adminToken, managerWithoutShare?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, managerMentionTarget?.id ?? null)
      await deleteRoleIfExists(request, adminToken, managerMentionTarget?.roleId ?? null)
    }
  })
})
