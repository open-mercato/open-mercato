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

type DocumentListItem = {
  id?: string
  title?: string
  ownerLabel?: string | null
  sharedWithCount?: number
}

type DocumentListBody = {
  items?: DocumentListItem[]
}

type CommentMention = {
  userId?: string
}

type CommentNode = {
  id?: string
  authorUserId?: string
  mentions?: CommentMention[]
  updatedAt?: string
  replies?: CommentNode[]
}

type UserLabel = {
  label?: string | null
  secondary?: string | null
}

type CommentListBody = {
  items?: CommentNode[]
  userLabels?: Record<string, UserLabel>
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
  withoutAccessUsers?: Array<{
    userId?: string
    label?: string | null
    secondary?: string | null
  }>
}

type VersionItem = {
  id?: string
  createdByLabel?: string | null
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
  name: string
}

const DOCUMENTS_OWNER_FEATURES = [
  'documents.view',
  'documents.edit',
  'documents.create',
  'documents.share',
]
const DOCUMENTS_VIEW_FEATURES = ['documents.view']
const UUID_PREFIX_PATTERN = /^[0-9a-f]{8}-/i
const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function uniqueEmail(label: string): string {
  return `tc-documents-007-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`
}

function policyPassword(label: string): string {
  return `Docs${label}1!${Date.now()}`
}

function expectUpdatedAt(value: unknown, message: string): string {
  expect(typeof value === 'string' && value.length > 0, message).toBe(true)
  return value as string
}

function expectNonUuidLabel(value: unknown, message: string): string {
  expect(typeof value === 'string' && value.trim().length > 0, message).toBe(true)
  const label = value as string
  expect(label, message).not.toMatch(UUID_PREFIX_PATTERN)
  return label
}

function sameId(left: string | undefined, right: string): boolean {
  return typeof left === 'string' && left.toLowerCase() === right.toLowerCase()
}

function getUserLabel(labels: Record<string, UserLabel> | undefined, userId: string): UserLabel | undefined {
  return labels?.[userId] ?? labels?.[userId.toLowerCase()]
}

async function createDocumentsUser(
  request: APIRequestContext,
  adminToken: string,
  label: string,
  features: string[],
): Promise<DocumentsTestUser> {
  const scope = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOCUMENTS-007 ${label} ${Date.now()}`,
    tenantId: scope.tenantId,
  })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features,
  })

  const email = uniqueEmail(label)
  const password = policyPassword(label)
  const name = `TC Documents 007 ${label}`
  const id = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId: scope.organizationId,
    roles: [roleId],
    name,
  })
  const token = await getAuthToken(request, email, password)
  return { id, roleId, email, password, token, name }
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

async function deleteShare(
  request: APIRequestContext,
  token: string,
  documentId: string,
  shareId: string,
  updatedAt: string,
): Promise<void> {
  const response = await request.fetch(resolveUrl(`/api/documents/${encodeURIComponent(documentId)}/shares`), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt,
    },
    data: { id: shareId },
  })
  expect(response.status(), 'share DELETE should return 200').toBe(200)
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
): Promise<CommentListBody> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/documents/${encodeURIComponent(documentId)}/comments`,
    { token },
  )
  const body = await readJsonSafe<CommentListBody>(response)
  expect(response.status(), 'GET /api/documents/[id]/comments should return 200').toBe(200)
  return body ?? {}
}

async function expectMentionNotification(
  request: APIRequestContext,
  token: string,
  commentId: string,
): Promise<void> {
  const notificationPath = `/api/notifications?sourceEntityId=${encodeURIComponent(commentId)}`
  const response = await apiRequest(request, 'GET', notificationPath, { token })
  const body = await readJsonSafe<NotificationListBody>(response)
  expect(response.status(), 'mentioned user should read notifications').toBe(200)
  const items = Array.isArray(body?.items) ? body.items : []
  expect(items.length, 'mentioned user should receive a notification').toBeGreaterThanOrEqual(1)
  expect(
    items.some((item) =>
      item.type === 'documents.comment.mentioned'
      && item.sourceEntityId === commentId
      && typeof item.linkHref === 'string'
      && item.linkHref.includes(`commentId=${commentId}`),
    ),
    'mention notification should link to the source comment',
  ).toBe(true)
}

async function readDocumentFromList(
  request: APIRequestContext,
  token: string,
  title: string,
  documentId: string,
): Promise<DocumentListItem> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/documents?search=${encodeURIComponent(title)}&page=1&pageSize=100`,
    { token },
  )
  const body = await readJsonSafe<DocumentListBody>(response)
  expect(response.status(), 'GET /api/documents should return 200').toBe(200)
  const items = Array.isArray(body?.items) ? body.items : []
  const item = items.find((candidate) => candidate.id === documentId) ?? null
  expect(item, 'document list should include the created document').not.toBeNull()
  return item as DocumentListItem
}

test.describe('TC-DOCUMENTS-007: labels', () => {
  test('returns human-readable labels for document lists, comments, access checks, versions, and mentions', async ({ request }) => {
    const stamp = Date.now()
    const title = `TC-DOCUMENTS-007 ${stamp}`
    let adminToken: string | null = null
    let owner: DocumentsTestUser | null = null
    let mentionTarget: DocumentsTestUser | null = null
    let unsharedTarget: DocumentsTestUser | null = null
    let documentId: string | null = null
    let documentUpdatedAt: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      owner = await createDocumentsUser(request, adminToken, 'owner', DOCUMENTS_OWNER_FEATURES)
      mentionTarget = await createDocumentsUser(request, adminToken, 'mention-target', DOCUMENTS_VIEW_FEATURES)
      unsharedTarget = await createDocumentsUser(request, adminToken, 'unshared-target', DOCUMENTS_VIEW_FEATURES)
      const ownerUser = owner
      const mentionUser = mentionTarget
      const unsharedUser = unsharedTarget

      const document = await createDocument(request, ownerUser.token, title)
      documentId = document.id
      documentUpdatedAt = document.updatedAt
      await putContent(request, ownerUser.token, documentId, '<p>v1 body</p>', 'v1 body')

      await shareWithUser(request, ownerUser.token, documentId, mentionUser.id, 'viewer')
      const temporaryShare = await shareWithUser(request, ownerUser.token, documentId, unsharedUser.id, 'viewer')

      const listItemWithTwoShares = await readDocumentFromList(request, ownerUser.token, title, documentId)
      expect(listItemWithTwoShares.ownerLabel, 'document list ownerLabel should match the creator display name')
        .toBe(ownerUser.name)
      expectNonUuidLabel(listItemWithTwoShares.ownerLabel, 'document list ownerLabel should not be a UUID')
      expect(listItemWithTwoShares.sharedWithCount, 'document list sharedWithCount should include two shares').toBe(2)

      await deleteShare(request, ownerUser.token, documentId, temporaryShare.id, temporaryShare.updatedAt)
      const listItemWithOneShare = await readDocumentFromList(request, ownerUser.token, title, documentId)
      expect(listItemWithOneShare.sharedWithCount, 'document list sharedWithCount should drop after unsharing').toBe(1)

      const accessCheckResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments/access-check`,
        { token: ownerUser.token, data: { userIds: [unsharedUser.id] } },
      )
      const accessCheckBody = await readJsonSafe<AccessCheckBody>(accessCheckResponse)
      expect(accessCheckResponse.status(), 'POST comments access-check should return 200').toBe(200)
      expect(accessCheckBody?.withoutAccess ?? [], 'unshared user should be reported without access')
        .toContain(unsharedUser.id)
      const withoutAccessUser = accessCheckBody?.withoutAccessUsers?.[0] ?? null
      expect(
        sameId(withoutAccessUser?.userId, unsharedUser.id),
        'access-check should preserve its ID-only compatibility shape',
      ).toBe(true)
      expect(withoutAccessUser?.label, 'access-check should not return a user label').toBeNull()
      expect(withoutAccessUser?.secondary, 'access-check should not return user secondary data').toBeNull()

      const newMentionResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments`,
        {
          token: ownerUser.token,
          data: {
            body: `@${mentionUser.name} hello`,
            anchor: null,
            parentCommentId: null,
            mentions: [{ userId: mentionUser.id }],
          },
        },
      )
      const newMentionBody = await readJsonSafe<MutationBody>(newMentionResponse)
      expect(newMentionResponse.status(), 'out-of-band mention comment POST should return 201').toBe(201)
      const newMentionCommentId = expectId(newMentionBody?.id, 'out-of-band mention response should include id')

      const commentsAfterNewMention = await listComments(request, ownerUser.token, documentId)
      const newMentionComment = findComment(commentsAfterNewMention.items, newMentionCommentId)
      expect(newMentionComment, 'out-of-band mention comment should be listed').not.toBeNull()
      expect(
        newMentionComment?.mentions?.some((mention) => sameId(mention.userId, mentionUser.id)),
        'out-of-band mention should be serialized on the comment',
      ).toBe(true)
      expectNonUuidLabel(
        getUserLabel(commentsAfterNewMention.userLabels, ownerUser.id)?.label,
        'comments userLabels should include the author label',
      )
      expectNonUuidLabel(
        getUserLabel(commentsAfterNewMention.userLabels, mentionUser.id)?.label,
        'comments userLabels should include the mentioned user label',
      )
      await expectMentionNotification(request, mentionUser.token, newMentionCommentId)

      const legacyMentionResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/comments`,
        {
          token: ownerUser.token,
          data: {
            body: `legacy @[${mentionUser.id}] hello`,
            anchor: null,
            parentCommentId: null,
          },
        },
      )
      const legacyMentionBody = await readJsonSafe<MutationBody>(legacyMentionResponse)
      expect(legacyMentionResponse.status(), 'legacy token mention comment POST should return 201').toBe(201)
      const legacyMentionCommentId = expectId(legacyMentionBody?.id, 'legacy mention response should include id')

      const commentsAfterLegacyMention = await listComments(request, ownerUser.token, documentId)
      expectNonUuidLabel(
        getUserLabel(commentsAfterLegacyMention.userLabels, mentionUser.id)?.label,
        'legacy mention token should feed userLabels for the mentioned user',
      )
      await expectMentionNotification(request, mentionUser.token, legacyMentionCommentId)

      const createVersionResponse = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(documentId)}/versions`,
        { token: ownerUser.token, data: { label: 'labels-snapshot' } },
      )
      const createVersionBody = await readJsonSafe<VersionItem>(createVersionResponse)
      expect(createVersionResponse.status(), 'owner editor path should create a version').toBe(201)
      const versionId = expectId(createVersionBody?.id, 'version create response should include id')

      const versionsResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/versions`,
        { token: ownerUser.token },
      )
      const versionsBody = await readJsonSafe<VersionListBody>(versionsResponse)
      expect(versionsResponse.status(), 'GET /api/documents/[id]/versions should return 200').toBe(200)
      const versions = Array.isArray(versionsBody?.items) ? versionsBody.items : []
      const version = versions.find((item) => item.id === versionId) ?? null
      expect(version, 'created version should be listed').not.toBeNull()
      expectNonUuidLabel(version?.createdByLabel, 'version createdByLabel should not be a UUID')
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId, documentUpdatedAt)
      await deleteUserIfExists(request, adminToken, owner?.id ?? null)
      await deleteRoleIfExists(request, adminToken, owner?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, mentionTarget?.id ?? null)
      await deleteRoleIfExists(request, adminToken, mentionTarget?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, unsharedTarget?.id ?? null)
      await deleteRoleIfExists(request, adminToken, unsharedTarget?.roleId ?? null)
    }
  })
})
