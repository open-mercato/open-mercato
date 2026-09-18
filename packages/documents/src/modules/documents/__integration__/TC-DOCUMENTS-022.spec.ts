import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['documents', 'notifications'],
}

type Mutation = { id?: string; updatedAt?: string }
type NotificationItem = { id?: string; type?: string }
type NotificationList = { items?: NotificationItem[] }

const RUN_TAG = `tc022-${Date.now()}`

function policyPassword(label: string): string {
  return `Tc022!${label}Pass1`
}

async function deleteDocumentBestEffort(request: APIRequestContext, token: string, documentId: string): Promise<void> {
  const detailResponse = await apiRequest(request, 'GET', `/api/documents/${documentId}`, { token })
  const detail = await readJsonSafe<{ updatedAt?: string; archivedAt?: string | null }>(detailResponse)
  if (detailResponse.status() !== 200 || !detail?.updatedAt) return
  await request.fetch(`/api/documents/${documentId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      [OPTIMISTIC_LOCK_HEADER_NAME]: detail.updatedAt,
    },
  }).catch(() => undefined)
}

async function createDocument(request: APIRequestContext, token: string, title: string) {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<Mutation>(response)
  expect(response.status(), 'document create should return 201').toBe(201)
  return { id: expectId(body?.id, 'document id'), updatedAt: expectId(body?.updatedAt, 'document updatedAt') }
}

async function createComment(request: APIRequestContext, token: string, documentId: string, body: string) {
  const response = await apiRequest(request, 'POST', `/api/documents/${documentId}/comments`, {
    token,
    data: { body, anchor: null, parentCommentId: null },
  })
  const payload = await readJsonSafe<Mutation>(response)
  expect(response.status(), 'comment create should return 201').toBe(201)
  return {
    id: expectId(payload?.id, 'comment id'),
    updatedAt: expectId(payload?.updatedAt, 'comment updatedAt'),
  }
}

async function listNotificationsBySource(
  request: APIRequestContext,
  token: string,
  sourceEntityId: string,
): Promise<NotificationItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/notifications?sourceEntityId=${encodeURIComponent(sourceEntityId)}`,
    { token },
  )
  const body = await readJsonSafe<NotificationList>(response)
  expect(response.status(), 'notification list should return 200').toBe(200)
  return Array.isArray(body?.items) ? body.items : []
}

function countByType(items: NotificationItem[], type: string): number {
  return items.filter((item) => item.type === type).length
}

test.describe('TC-DOCUMENTS-022 document watch subscriptions', () => {
  test('delivers watch notifications with mention dedup and fail-closed revocation', async ({ request }) => {
    const adminToken = await getAuthToken(request)
    const scope = getTokenScope(adminToken)
    const cleanup: Array<() => Promise<void>> = []
    try {
      const watchedDocument = await createDocument(request, adminToken, `${RUN_TAG} watched runbook`)
      cleanup.push(async () => { await deleteDocumentBestEffort(request, adminToken, watchedDocument.id) })

      const roleId = await createRoleFixture(request, adminToken, {
        name: `TC-DOCUMENTS-022 watcher ${RUN_TAG}`,
        tenantId: scope.tenantId,
      })
      cleanup.push(async () => { await deleteRoleIfExists(request, adminToken, roleId) })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['documents.view'] })
      const watcherEmail = `${RUN_TAG}.watcher@example.com`
      const watcherPassword = policyPassword('Watcher')
      const watcherId = await createUserFixture(request, adminToken, {
        email: watcherEmail,
        password: watcherPassword,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: `TC Documents 022 watcher ${RUN_TAG}`,
      })
      cleanup.push(async () => { await deleteUserIfExists(request, adminToken, watcherId) })
      const watcherToken = await getAuthToken(request, watcherEmail, watcherPassword)

      const shareResponse = await apiRequest(request, 'POST', `/api/documents/${watchedDocument.id}/shares`, {
        token: adminToken,
        data: { principalType: 'user', principalId: watcherId, permission: 'viewer' },
      })
      expect(shareResponse.status(), 'viewer share should return 201').toBe(201)

      const watchOn = await apiRequest(request, 'POST', `/api/documents/${watchedDocument.id}/watch`, { token: watcherToken })
      expect(watchOn.status(), 'watch POST should succeed').toBe(200)
      const watchAgain = await apiRequest(request, 'POST', `/api/documents/${watchedDocument.id}/watch`, { token: watcherToken })
      expect(watchAgain.status(), 'watch POST must be idempotent').toBe(200)

      const plainComment = await createComment(request, adminToken, watchedDocument.id, `${RUN_TAG} plain update`)
      const plainCommentId = plainComment.id
      const plainNotifications = await listNotificationsBySource(request, watcherToken, plainCommentId)
      expect(
        countByType(plainNotifications, 'documents.watch.commented'),
        'a watcher must receive exactly one watch notification for a comment by someone else',
      ).toBe(1)

      const mentionComment = await createComment(
        request,
        adminToken,
        watchedDocument.id,
        `${RUN_TAG} ping @[${watcherId}]`,
      )
      const mentionCommentId = mentionComment.id
      const mentionNotifications = await listNotificationsBySource(request, watcherToken, mentionCommentId)
      expect(
        countByType(mentionNotifications, 'documents.comment.mentioned'),
        'the mentioned watcher must receive the mention notification',
      ).toBe(1)
      expect(
        countByType(mentionNotifications, 'documents.watch.commented'),
        'a mention must suppress the duplicate watch notification for the same comment',
      ).toBe(0)


      const resolveResponse = await request.fetch(`/api/documents/${encodeURIComponent(watchedDocument.id)}/comments`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: plainComment.updatedAt,
        },
        data: { id: plainCommentId, resolved: true },
      })
      expect(resolveResponse.status(), 'comment resolve should succeed').toBe(200)
      const afterResolveNotifications = await listNotificationsBySource(request, watcherToken, plainCommentId)
      expect(
        countByType(afterResolveNotifications, 'documents.watch.commented'),
        'resolving a comment must deliver a second watch notification for the same comment source',
      ).toBe(2)

      const preArchiveDetailResponse = await apiRequest(request, 'GET', `/api/documents/${watchedDocument.id}`, { token: adminToken })
      const preArchiveDetail = await readJsonSafe<Mutation>(preArchiveDetailResponse)
      const archiveResponse = await request.fetch(`/api/documents/${encodeURIComponent(watchedDocument.id)}/archive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          [OPTIMISTIC_LOCK_HEADER_NAME]: expectId(preArchiveDetail?.updatedAt, 'document updatedAt'),
        },
      })
      expect(archiveResponse.status(), 'archive should succeed').toBe(200)
      const archiveNotifications = await listNotificationsBySource(request, watcherToken, watchedDocument.id)
      expect(
        countByType(archiveNotifications, 'documents.watch.changed'),
        'archiving must deliver a watch state-change notification',
      ).toBeGreaterThanOrEqual(1)
      const postArchiveDetailResponse = await apiRequest(request, 'GET', `/api/documents/${watchedDocument.id}`, { token: adminToken })
      const postArchiveDetail = await readJsonSafe<Mutation>(postArchiveDetailResponse)
      const unarchiveResponse = await request.fetch(`/api/documents/${encodeURIComponent(watchedDocument.id)}/unarchive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          [OPTIMISTIC_LOCK_HEADER_NAME]: expectId(postArchiveDetail?.updatedAt, 'archived document updatedAt'),
        },
      })
      expect(unarchiveResponse.status(), 'unarchive should succeed').toBe(200)

      const watchOff = await apiRequest(request, 'DELETE', `/api/documents/${watchedDocument.id}/watch`, { token: watcherToken })
      expect(watchOff.status(), 'unwatch should succeed').toBe(200)
      const afterUnwatchCommentId = (await createComment(request, adminToken, watchedDocument.id, `${RUN_TAG} post-unwatch update`)).id
      const afterUnwatchNotifications = await listNotificationsBySource(request, watcherToken, afterUnwatchCommentId)
      expect(
        countByType(afterUnwatchNotifications, 'documents.watch.commented'),
        'unwatching must stop delivery',
      ).toBe(0)

      const rewatch = await apiRequest(request, 'POST', `/api/documents/${watchedDocument.id}/watch`, { token: watcherToken })
      expect(rewatch.status()).toBe(200)

      const sharesResponse = await apiRequest(request, 'GET', `/api/documents/${watchedDocument.id}/shares`, { token: adminToken })
      const sharesBody = await readJsonSafe<{ items?: Array<{ id?: string; principalId?: string; updatedAt?: string }> }>(sharesResponse)
      const watcherShare = (sharesBody?.items ?? []).find((item) => item.principalId === watcherId)
      expect(watcherShare?.id, 'the watcher share should be listed for revocation').toBeTruthy()
      const revokeResponse = await request.fetch(`/api/documents/${encodeURIComponent(watchedDocument.id)}/shares`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: watcherShare?.updatedAt ?? '',
        },
        data: { id: watcherShare?.id },
      })
      expect([200, 204]).toContain(revokeResponse.status())

      const afterRevokeCommentId = (await createComment(request, adminToken, watchedDocument.id, `${RUN_TAG} post-revoke update`)).id
      const afterRevokeNotifications = await listNotificationsBySource(request, watcherToken, afterRevokeCommentId)
      expect(
        countByType(afterRevokeNotifications, 'documents.watch.commented'),
        'a watcher who lost access must receive nothing (fail-closed)',
      ).toBe(0)

      const lostAccessUnwatch = await apiRequest(request, 'DELETE', `/api/documents/${watchedDocument.id}/watch`, { token: watcherToken })
      expect(
        lostAccessUnwatch.status(),
        'a watcher who lost view access must still be able to remove their own subscription',
      ).toBe(200)
    } finally {
      for (const step of cleanup.reverse()) {
        try { await step() } catch { /* best-effort cleanup */ }
      }
    }
  })
})
