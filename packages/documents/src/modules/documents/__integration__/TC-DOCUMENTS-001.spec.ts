import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

type MutationBody = {
  id?: string
  updatedAt?: string
}

type DocumentDetailBody = {
  id?: string
  title?: string
  folderId?: string | null
  updatedAt?: string
}

type DocumentListBody = {
  items?: DocumentDetailBody[]
}

type ContentBody = {
  contentHtml?: string
  contentText?: string
  updatedAt?: string | null
}

async function createFolder(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<{ id: string; updatedAt: string }> {
  const response = await apiRequest(request, 'POST', '/api/documents/folders', {
    token,
    data: { name, parentFolderId: null },
  })
  const body = await readJsonSafe<MutationBody>(response)
  expect(response.status(), 'POST /api/documents/folders should return 201').toBe(201)
  return {
    id: expectId(body?.id, 'folder create response should include id'),
    updatedAt: expectUpdatedAt(body?.updatedAt, 'folder create response should include updatedAt'),
  }
}

async function deleteFolderIfExists(
  request: APIRequestContext,
  token: string | null,
  folderId: string | null,
): Promise<void> {
  if (!token || !folderId) return
  await apiRequest(request, 'DELETE', '/api/documents/folders', {
    token,
    data: { id: folderId },
  }).catch(() => undefined)
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

function expectUpdatedAt(value: unknown, message: string): string {
  expect(typeof value === 'string' && value.length > 0, message).toBe(true)
  return value as string
}

function staleTokenFrom(updatedAt: string): string {
  const parsed = Date.parse(updatedAt)
  if (!Number.isFinite(parsed)) return '1970-01-01T00:00:00.000Z'
  return new Date(parsed - 1000).toISOString()
}

test.describe('TC-DOCUMENTS-001: CRUD, folders, content, and optimistic lock', () => {
  test('creates, reads, updates, writes content, rejects stale metadata, and soft-deletes a document', async ({ request }) => {
    const stamp = Date.now()
    const title = `TC-DOCUMENTS-001 ${stamp}`
    let token: string | null = null
    let folderId: string | null = null
    let movedFolderId: string | null = null
    let documentId: string | null = null
    let documentUpdatedAt: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const folder = await createFolder(request, token, `TC-DOCUMENTS-001 Folder ${stamp}`)
      folderId = folder.id
      const movedFolder = await createFolder(request, token, `TC-DOCUMENTS-001 Moved ${stamp}`)
      movedFolderId = movedFolder.id

      const createDocumentResponse = await apiRequest(request, 'POST', '/api/documents', {
        token,
        data: { title, folderId },
      })
      const createDocumentBody = await readJsonSafe<MutationBody>(createDocumentResponse)
      expect(createDocumentResponse.status(), 'POST /api/documents should return 201').toBe(201)
      documentId = expectId(createDocumentBody?.id, 'document create response should include id')
      documentUpdatedAt = expectUpdatedAt(
        createDocumentBody?.updatedAt,
        'document create response should include updatedAt',
      )

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/documents?search=${encodeURIComponent(title)}&page=1&pageSize=100`,
        { token },
      )
      const listBody = await readJsonSafe<DocumentListBody>(listResponse)
      expect(listResponse.status(), 'GET /api/documents should return 200').toBe(200)
      expect(listBody?.items?.some((item) => item.id === documentId)).toBe(true)

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}`,
        { token },
      )
      const detailBody = await readJsonSafe<DocumentDetailBody>(detailResponse)
      expect(detailResponse.status(), 'GET /api/documents/[id] should return 200').toBe(200)
      expect(detailBody?.title).toBe(title)
      expect(detailBody?.folderId).toBe(folderId)
      documentUpdatedAt = expectUpdatedAt(detailBody?.updatedAt, 'detail response should include updatedAt')

      const updatedTitle = `${title} updated`
      const updateResponse = await request.fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: documentUpdatedAt,
        },
        data: { title: updatedTitle, folderId: movedFolderId },
      })
      const updateBody = await readJsonSafe<MutationBody>(updateResponse)
      expect(updateResponse.status(), 'PUT /api/documents/[id] should return 200').toBe(200)
      documentUpdatedAt = expectUpdatedAt(updateBody?.updatedAt, 'metadata PUT should return updatedAt')

      const movedDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}`,
        { token },
      )
      const movedDetailBody = await readJsonSafe<DocumentDetailBody>(movedDetailResponse)
      expect(movedDetailBody?.title).toBe(updatedTitle)
      expect(movedDetailBody?.folderId).toBe(movedFolderId)

      const staleResponse = await request.fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: staleTokenFrom(documentUpdatedAt),
        },
        data: { title: `${title} stale`, folderId: movedFolderId },
      })
      expect(staleResponse.status(), 'stale metadata PUT should return 409').toBe(409)

      const contentHtml = `<p>${title} body</p>`
      const contentText = `${title} body`
      const initialContentResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        { token },
      )
      const initialContentBody = await readJsonSafe<ContentBody>(initialContentResponse)
      const initialContentUpdatedAt = expectUpdatedAt(
        initialContentBody?.updatedAt,
        'initial content response should include updatedAt',
      )
      const putContentResponse = await request.fetch(
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            [OPTIMISTIC_LOCK_HEADER_NAME]: initialContentUpdatedAt,
          },
          data: { contentHtml, contentText },
        },
      )
      const putContentBody = await readJsonSafe<ContentBody & { ok?: boolean }>(putContentResponse)
      expect(putContentResponse.status(), 'PUT /api/documents/[id]/content should return 200').toBe(200)
      expect(putContentBody?.ok).toBe(true)
      const persistedContentUpdatedAt = expectUpdatedAt(
        putContentBody?.updatedAt,
        'content PUT should return updatedAt',
      )

      const staleContentResponse = await request.fetch(
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            [OPTIMISTIC_LOCK_HEADER_NAME]: initialContentUpdatedAt,
          },
          data: { contentHtml: '<p>Stale content overwrite</p>', contentText: 'Stale content overwrite' },
        },
      )
      expect(staleContentResponse.status(), 'stale content PUT should return 409').toBe(409)

      const getContentResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        { token },
      )
      const getContentBody = await readJsonSafe<ContentBody>(getContentResponse)
      expect(getContentResponse.status(), 'GET /api/documents/[id]/content should return 200').toBe(200)
      expect(getContentBody?.contentHtml).toBe(contentHtml)
      expect(getContentBody?.contentText).toBe(contentText)

      const adversarialContentResponse = await request.fetch(
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            [OPTIMISTIC_LOCK_HEADER_NAME]: persistedContentUpdatedAt,
          },
          data: {
            contentHtml: `<meta http-equiv="refresh" content="0;url=https://attacker.example"><iframe src="https://attacker.example/frame"></iframe><p onclick="location='https://attacker.example/click'">${title} canonical<img src="https://attacker.example/tracker.png" onerror="alert(1)"></p><script>location='https://attacker.example/script'</script>`,
            contentText: 'forged caller-controlled export text',
          },
        },
      )
      expect(adversarialContentResponse.status(), 'adversarial content PUT should be canonicalized').toBe(200)

      const canonicalContentResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${encodeURIComponent(documentId)}/content`,
        { token },
      )
      const canonicalContentBody = await readJsonSafe<ContentBody>(canonicalContentResponse)
      expect(canonicalContentResponse.status(), 'canonical content GET should return 200').toBe(200)
      expect(canonicalContentBody?.contentHtml).not.toMatch(/<(?:script|iframe|meta)\b/i)
      expect(canonicalContentBody?.contentHtml).not.toMatch(/\bon(?:click|error)\s*=/i)
      expect(canonicalContentBody?.contentText).toContain(`${title} canonical`)
      expect(canonicalContentBody?.contentText).not.toBe('forged caller-controlled export text')

      const deleteResponse = await request.fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          [OPTIMISTIC_LOCK_HEADER_NAME]: documentUpdatedAt,
        },
      })
      expect(deleteResponse.status(), 'DELETE /api/documents/[id] should return 200').toBe(200)
      documentId = null
    } finally {
      await deleteDocumentIfExists(request, token, documentId, documentUpdatedAt)
      await deleteFolderIfExists(request, token, movedFolderId)
      await deleteFolderIfExists(request, token, folderId)
    }
  })
})
