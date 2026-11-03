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
  dependsOnModules: ['documents'],
}

type Mutation = { id?: string; updatedAt?: string }
type DocumentList = { items?: Array<{ id?: string; title?: string; isFavorite?: boolean }> }
type DocumentDetail = {
  id?: string
  title?: string
  ownerUserId?: string
  archivedAt?: string | null
  isFavorite?: boolean
  capabilities?: { canShare?: boolean }
}
type DuplicateResult = {
  id?: string
  updatedAt?: string
  copiedAttachments?: number
  copiedLinks?: number
  droppedLinks?: number
}
type ContentBody = { contentHtml?: string }
type ShareList = { items?: Array<{ id?: string }> }

const RUN_TAG = `tc021-${Date.now()}`

function policyPassword(label: string): string {
  return `Tc021!${label}Pass1`
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

async function listDocuments(request: APIRequestContext, token: string, query: string) {
  const response = await apiRequest(request, 'GET', `/api/documents?${query}`, { token })
  const body = await readJsonSafe<DocumentList>(response)
  expect(response.status()).toBe(200)
  return Array.isArray(body?.items) ? body.items : []
}

test.describe('TC-DOCUMENTS-021 favorites and duplicate', () => {
  test('stars filter per user and duplicate copies content while re-verifying links', async ({ request }) => {
    const adminToken = await getAuthToken(request)
    const scope = getTokenScope(adminToken)
    const cleanup: Array<() => Promise<void>> = []
    try {
      const sourceDocument = await createDocument(request, adminToken, `${RUN_TAG} living quote`)
      cleanup.push(async () => { await deleteDocumentBestEffort(request, adminToken, sourceDocument.id) })

      const favoriteOn = await apiRequest(request, 'POST', `/api/documents/${sourceDocument.id}/favorite`, { token: adminToken })
      expect(favoriteOn.status(), 'favorite POST should succeed').toBe(200)
      const favoriteAgain = await apiRequest(request, 'POST', `/api/documents/${sourceDocument.id}/favorite`, { token: adminToken })
      expect(favoriteAgain.status(), 'favorite POST must be idempotent').toBe(200)

      const starredItems = await listDocuments(request, adminToken, 'favorite=true&pageSize=100')
      expect(starredItems.some((item) => item.id === sourceDocument.id)).toBe(true)

      const unfilteredWithFalse = await listDocuments(request, adminToken, 'favorite=false&pageSize=100')
      expect(
        unfilteredWithFalse.some((item) => item.id === sourceDocument.id),
        'favorite=false must behave as no filter, not as an inverted filter',
      ).toBe(true)

      const favoriteOff = await apiRequest(request, 'DELETE', `/api/documents/${sourceDocument.id}/favorite`, { token: adminToken })
      expect(favoriteOff.status()).toBe(200)
      const unstarredItems = await listDocuments(request, adminToken, 'favorite=true&pageSize=100')
      expect(unstarredItems.some((item) => item.id === sourceDocument.id)).toBe(false)

      const contentPut = await apiRequest(request, 'PUT', `/api/documents/${sourceDocument.id}/content`, {
        token: adminToken,
        data: {
          contentHtml: `<p>${RUN_TAG} negotiated terms</p>`,
          contentText: `${RUN_TAG} negotiated terms`,
        },
      })
      expect(contentPut.status(), 'content PUT should succeed').toBe(200)

      const hiddenTarget = await createDocument(request, adminToken, `${RUN_TAG} private annex`)
      cleanup.push(async () => { await deleteDocumentBestEffort(request, adminToken, hiddenTarget.id) })
      const linkResponse = await apiRequest(request, 'POST', `/api/documents/${sourceDocument.id}/links`, {
        token: adminToken,
        data: {
          entityType: 'document',
          entityId: hiddenTarget.id,
          label: `${RUN_TAG} private annex`,
          href: `/backend/documents/${hiddenTarget.id}`,
          source: 'related-panel',
        },
      })
      expect(linkResponse.status(), 'link create should return 201').toBe(201)

      const roleId = await createRoleFixture(request, adminToken, {
        name: `TC-DOCUMENTS-021 duplicator ${RUN_TAG}`,
        tenantId: scope.tenantId,
      })
      cleanup.push(async () => { await deleteRoleIfExists(request, adminToken, roleId) })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['documents.view', 'documents.create', 'documents.edit'],
      })
      const duplicatorEmail = `${RUN_TAG}.duplicator@example.com`
      const duplicatorPassword = policyPassword('Duplicator')
      const duplicatorId = await createUserFixture(request, adminToken, {
        email: duplicatorEmail,
        password: duplicatorPassword,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: `TC Documents 021 duplicator ${RUN_TAG}`,
      })
      cleanup.push(async () => { await deleteUserIfExists(request, adminToken, duplicatorId) })
      const duplicatorToken = await getAuthToken(request, duplicatorEmail, duplicatorPassword)

      await apiRequest(request, 'POST', `/api/documents/${sourceDocument.id}/shares`, {
        token: adminToken,
        data: { principalType: 'user', principalId: duplicatorId, permission: 'viewer' },
      })

      const duplicateResponse = await apiRequest(request, 'POST', `/api/documents/${sourceDocument.id}/duplicate`, {
        token: duplicatorToken,
        data: {},
      })
      const duplicateBody = await readJsonSafe<DuplicateResult>(duplicateResponse)
      expect(duplicateResponse.status(), 'duplicate should return 201').toBe(201)
      const copyId = expectId(duplicateBody?.id, 'duplicate response should include the copy id')
      cleanup.push(async () => { await deleteDocumentBestEffort(request, duplicatorToken, copyId) })
      expect(duplicateBody?.copiedLinks ?? -1, 'the unshared link target must be dropped').toBe(0)
      expect(duplicateBody?.droppedLinks ?? 0).toBeGreaterThanOrEqual(1)

      const copyDetailResponse = await apiRequest(request, 'GET', `/api/documents/${copyId}`, { token: duplicatorToken })
      const copyDetail = await readJsonSafe<DocumentDetail>(copyDetailResponse)
      expect(copyDetailResponse.status()).toBe(200)
      expect(copyDetail?.ownerUserId).toBe(duplicatorId)
      expect(copyDetail?.archivedAt ?? null).toBeNull()
      expect(copyDetail?.title ?? '').toContain(`${RUN_TAG} living quote`)
      expect(copyDetail?.title ?? '').not.toBe(`${RUN_TAG} living quote`)
      expect(copyDetail?.isFavorite, 'favorites are never copied').toBe(false)

      const copyContentResponse = await apiRequest(request, 'GET', `/api/documents/${copyId}/content`, { token: duplicatorToken })
      const copyContent = await readJsonSafe<ContentBody>(copyContentResponse)
      expect(copyContentResponse.status()).toBe(200)
      expect(copyContent?.contentHtml ?? '').toContain(`${RUN_TAG} negotiated terms`)

      const copySharesResponse = await apiRequest(request, 'GET', `/api/documents/${copyId}/shares`, { token: duplicatorToken })
      if (copySharesResponse.status() === 200) {
        const copyShares = await readJsonSafe<ShareList>(copySharesResponse)
        expect((copyShares?.items ?? []).length, 'shares are never copied').toBe(0)
      } else {
        expect(copySharesResponse.status(), 'a copy without shares may also deny share listing to a non-sharing owner feature set').toBe(403)
      }
    } finally {
      for (const step of cleanup.reverse()) {
        try { await step() } catch { /* best-effort cleanup */ }
      }
    }
  })
})
