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

const SELF_LINK_FORBIDDEN_MESSAGE = 'A document cannot link to itself.'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

type Mutation = { id?: string; updatedAt?: string }
type LinkItem = { id?: string; entityType?: string; entityId?: string | null; label?: string; href?: string | null; archivedAt?: string | null }
type LinkList = { items?: LinkItem[] }
type DocumentList = { items?: Array<{ id?: string; title?: string }> }
type ErrorBody = { error?: string }

const RUN_TAG = `tc020-${Date.now()}`

function policyPassword(label: string): string {
  return `Tc020!${label}Pass1`
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

async function createDocumentLink(
  request: APIRequestContext,
  token: string,
  documentId: string,
  target: { id: string; title: string },
) {
  return apiRequest(request, 'POST', `/api/documents/${documentId}/links`, {
    token,
    data: {
      entityType: 'document',
      entityId: target.id,
      label: target.title,
      href: `/backend/documents/${target.id}`,
      source: 'related-panel',
    },
  })
}

async function listBacklinks(request: APIRequestContext, token: string, targetDocumentId: string) {
  const response = await apiRequest(
    request,
    'GET',
    `/api/documents?entityType=document&entityId=${encodeURIComponent(targetDocumentId)}&pageSize=50`,
    { token },
  )
  const body = await readJsonSafe<DocumentList>(response)
  return { response, items: Array.isArray(body?.items) ? body.items : [] }
}

test.describe('TC-DOCUMENTS-020 document-to-document links and backlinks', () => {
  test('links documents both ways with visibility-scoped backlinks and safe labels', async ({ request }) => {
    const adminToken = await getAuthToken(request)
    const scope = getTokenScope(adminToken)
    const cleanup: Array<() => Promise<void>> = []
    try {
      const sourceDocument = await createDocument(request, adminToken, `${RUN_TAG} source runbook`)
      cleanup.push(async () => { await deleteDocumentBestEffort(request, adminToken, sourceDocument.id) })
      const targetDocument = await createDocument(request, adminToken, `${RUN_TAG} target SOP`)
      cleanup.push(async () => { await deleteDocumentBestEffort(request, adminToken, targetDocument.id) })

      const selfLink = await createDocumentLink(request, adminToken, sourceDocument.id, {
        id: sourceDocument.id,
        title: `${RUN_TAG} source runbook`,
      })
      const selfLinkBody = await readJsonSafe<ErrorBody>(selfLink)
      expect(selfLink.status(), 'self-link must be rejected').toBe(400)
      expect(selfLinkBody?.error).toBe(SELF_LINK_FORBIDDEN_MESSAGE)

      const linkResponse = await createDocumentLink(request, adminToken, sourceDocument.id, {
        id: targetDocument.id,
        title: `${RUN_TAG} target SOP`,
      })
      expect(linkResponse.status(), 'document link create should return 201').toBe(201)

      const linksResponse = await apiRequest(request, 'GET', `/api/documents/${sourceDocument.id}/links`, { token: adminToken })
      const linksBody = await readJsonSafe<LinkList>(linksResponse)
      expect(linksResponse.status()).toBe(200)
      const documentLink = (linksBody?.items ?? []).find((item) => item.entityType === 'document')
      expect(documentLink, 'outgoing rail should contain the document link').toBeTruthy()
      expect(documentLink?.entityId).toBe(targetDocument.id)
      expect(documentLink?.label).toBe(`${RUN_TAG} target SOP`)
      expect(documentLink?.href).toBe(`/backend/documents/${targetDocument.id}`)
      expect(documentLink?.archivedAt ?? null).toBeNull()

      const ownerBacklinks = await listBacklinks(request, adminToken, targetDocument.id)
      expect(ownerBacklinks.response.status()).toBe(200)
      expect(
        ownerBacklinks.items.some((item) => item.id === sourceDocument.id),
        'the owner must see the referencing document in backlinks',
      ).toBe(true)

      const roleId = await createRoleFixture(request, adminToken, {
        name: `TC-DOCUMENTS-020 outsider ${RUN_TAG}`,
        tenantId: scope.tenantId,
      })
      cleanup.push(async () => { await deleteRoleIfExists(request, adminToken, roleId) })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['documents.view'] })
      const outsiderEmail = `${RUN_TAG}.outsider@example.com`
      const outsiderPassword = policyPassword('Outsider')
      const outsiderId = await createUserFixture(request, adminToken, {
        email: outsiderEmail,
        password: outsiderPassword,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: `TC Documents 020 outsider ${RUN_TAG}`,
      })
      cleanup.push(async () => { await deleteUserIfExists(request, adminToken, outsiderId) })
      const outsiderToken = await getAuthToken(request, outsiderEmail, outsiderPassword)

      const outsiderBacklinks = await listBacklinks(request, outsiderToken, targetDocument.id)
      expect(
        outsiderBacklinks.response.status(),
        'an unshared target must not resolve for the outsider (no existence oracle)',
      ).toBe(403)

      await apiRequest(request, 'POST', `/api/documents/${targetDocument.id}/shares`, {
        token: adminToken,
        data: { principalType: 'user', principalId: outsiderId, permission: 'viewer' },
      })
      const sharedTargetBacklinks = await listBacklinks(request, outsiderToken, targetDocument.id)
      expect(sharedTargetBacklinks.response.status()).toBe(200)
      expect(
        sharedTargetBacklinks.items.some((item) => item.id === sourceDocument.id),
        'a viewer of the target without access to the referencing document must not see it in backlinks',
      ).toBe(false)
    } finally {
      for (const step of cleanup.reverse()) {
        try { await step() } catch { /* best-effort cleanup */ }
      }
    }
  })
})
