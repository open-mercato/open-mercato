import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['documents', 'audit_logs'],
}

type Mutation = { id?: string; updatedAt?: string; ok?: boolean }
type Content = {
  contentHtml?: string
  contentText?: string
  updatedAt?: string | null
  restoredVersionId?: string
  preRestoreVersionId?: string
}
type Version = { id?: string; createdByLabel?: string | null }
type VersionList = { items?: Version[] }
type VersionDetail = { id?: string; creatorLabel?: string; contentHtml?: string }

async function createDocument(request: APIRequestContext, token: string, title: string) {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<Mutation>(response)
  expect(response.status()).toBe(201)
  return { id: expectId(body?.id, 'document id'), updatedAt: expectId(body?.updatedAt, 'document updatedAt') }
}

async function putContent(
  request: APIRequestContext,
  token: string,
  documentId: string,
  html: string,
): Promise<string> {
  const response = await apiRequest(request, 'PUT', `/api/documents/${documentId}/content`, {
    token,
    data: { contentHtml: html },
  })
  const body = await readJsonSafe<Mutation>(response)
  expect(response.status()).toBe(200)
  return expectId(body?.updatedAt, 'content updatedAt')
}

async function getContent(request: APIRequestContext, token: string, documentId: string): Promise<Content> {
  const response = await apiRequest(request, 'GET', `/api/documents/${documentId}/content`, { token })
  const body = await readJsonSafe<Content>(response)
  expect(response.status()).toBe(200)
  return body ?? {}
}

async function createVersion(
  request: APIRequestContext,
  token: string,
  documentId: string,
  label: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `/api/documents/${documentId}/versions`, {
    token,
    data: { label },
  })
  const body = await readJsonSafe<Version>(response)
  expect(response.status()).toBe(201)
  expect(response.headers()['x-om-operation']).toBeUndefined()
  return expectId(body?.id, 'version id')
}

async function listVersions(request: APIRequestContext, token: string, documentId: string): Promise<Version[]> {
  const response = await apiRequest(request, 'GET', `/api/documents/${documentId}/versions`, { token })
  const body = await readJsonSafe<VersionList>(response)
  expect(response.status()).toBe(200)
  return body?.items ?? []
}

async function restoreVersion(
  request: APIRequestContext,
  token: string,
  documentId: string,
  versionId: string,
  expectedUpdatedAt: string,
) {
  return request.fetch(`/api/documents/${documentId}/versions/${versionId}/restore`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      [OPTIMISTIC_LOCK_HEADER_NAME]: expectedUpdatedAt,
    },
  })
}

test.describe('TC-DOCUMENTS-012: safe version preview and materialized restore', () => {
  test('sanitizes previews, locks restore, and reverses through bounded version history', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let documentId: string | null = null
    let documentUpdatedAt: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const document = await createDocument(request, token, `TC-DOCUMENTS-012 ${stamp}`)
      documentId = document.id
      documentUpdatedAt = document.updatedAt

      await putContent(request, token, documentId, '<h1>Version one</h1><p>Restorable body</p>')
      const versionId = await createVersion(request, token, documentId, 'version-one')

      const attachmentId = '22222222-2222-4222-8222-222222222222'
      const safeImage = `/api/documents/${documentId}/attachments/${attachmentId}`
      const maliciousLegacyHtml = [
        '<script>alert(1)</script>',
        '<iframe src="https://evil.example/frame"></iframe>',
        '<p onclick="alert(1)"><a href="javascript:alert(1)">Version one</a></p>',
        `<img src="${safeImage}" alt="safe">`,
        '<img src="//evil.example/protocol-relative.png">',
        '<img src="https://evil.example/pixel.png">',
        '<p>Restorable body</p>',
      ].join('')
      await withClient(async (client) => {
        await client.query(
          'update document_versions set yjs_snapshot = $2::bytea, content_html = $3 where id = $1',
          [versionId, Buffer.alloc(0), maliciousLegacyHtml],
        )
      })

      const previewResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${documentId}/versions/${versionId}`,
        { token },
      )
      const preview = await readJsonSafe<VersionDetail>(previewResponse)
      expect(previewResponse.status()).toBe(200)
      expect(preview?.creatorLabel).toBeTruthy()
      expect(preview?.creatorLabel).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/i)
      expect(preview?.contentHtml).toContain(safeImage)
      expect(preview?.contentHtml).not.toContain('script')
      expect(preview?.contentHtml).not.toContain('iframe')
      expect(preview?.contentHtml).not.toContain('onclick')
      expect(preview?.contentHtml).not.toContain('javascript:')
      expect(preview?.contentHtml).not.toContain('evil.example')

      const v2UpdatedAt = await putContent(request, token, documentId, '<p>Version two body</p>')
      const beforeStaleVersions = await listVersions(request, token, documentId)
      const stale = await restoreVersion(
        request,
        token,
        documentId,
        versionId,
        new Date(Date.parse(v2UpdatedAt) - 1000).toISOString(),
      )
      expect(stale.status()).toBe(409)
      expect(await listVersions(request, token, documentId)).toHaveLength(beforeStaleVersions.length)
      expect((await getContent(request, token, documentId)).contentHtml).toContain('Version two body')

      const restoredResponse = await restoreVersion(request, token, documentId, versionId, v2UpdatedAt)
      const restored = await readJsonSafe<Content>(restoredResponse)
      expect(restoredResponse.status()).toBe(200)
      expect(restored?.restoredVersionId).toBe(versionId)
      expect(restored?.preRestoreVersionId).toBeTruthy()
      expect(restored?.contentHtml).toContain('Version one')
      expect(restored?.contentText).toContain('Restorable body')
      expect(restored?.updatedAt).toBeTruthy()
      expect(restoredResponse.headers()['x-om-operation']).toBeUndefined()

      const restoredUpdatedAt = expectId(restored?.updatedAt, 'restored content token')
      const preRestoreVersionId = expectId(
        restored?.preRestoreVersionId,
        'pre-restore version id',
      )
      const reversedResponse = await restoreVersion(
        request,
        token,
        documentId,
        preRestoreVersionId,
        restoredUpdatedAt,
      )
      const reversed = await readJsonSafe<Content>(reversedResponse)
      expect(reversedResponse.status()).toBe(200)
      expect(reversedResponse.headers()['x-om-operation']).toBeUndefined()
      expect(reversed?.contentHtml).toContain('Version two body')
      const reversedUpdatedAt = expectId(reversed?.updatedAt, 'reversed content token')
      expect(Date.parse(reversedUpdatedAt)).toBeGreaterThan(Date.parse(restoredUpdatedAt))

      const restoredAgainResponse = await restoreVersion(
        request,
        token,
        documentId,
        versionId,
        reversedUpdatedAt,
      )
      const restoredAgain = await readJsonSafe<Content>(restoredAgainResponse)
      expect(restoredAgainResponse.status()).toBe(200)
      expect(restoredAgainResponse.headers()['x-om-operation']).toBeUndefined()
      expect(restoredAgain?.contentHtml).toContain('Version one')
      const restoredAgainUpdatedAt = expectId(restoredAgain?.updatedAt, 'restored-again content token')
      expect(Date.parse(restoredAgainUpdatedAt)).toBeGreaterThan(Date.parse(reversedUpdatedAt))
      const abaAttempt = await restoreVersion(request, token, documentId, versionId, restoredUpdatedAt)
      expect(abaAttempt.status()).toBe(409)

      await putContent(request, token, documentId, '<p>Intervening edit</p>')
      const currentBeforeCorrupt = await getContent(request, token, documentId)
      const corruptVersionId = await createVersion(request, token, documentId, 'corrupt-version')
      await withClient(async (client) => {
        await client.query(
          'update document_versions set yjs_snapshot = $2::bytea, content_html = $3 where id = $1',
          [corruptVersionId, Buffer.from([1, 2, 3, 4]), '<p>must not be used</p>'],
        )
      })
      const corruptPreview = await apiRequest(
        request,
        'GET',
        `/api/documents/${documentId}/versions/${corruptVersionId}`,
        { token },
      )
      expect(corruptPreview.status()).toBe(422)
      const versionsBeforeCorruptRestore = await listVersions(request, token, documentId)
      const corruptRestore = await restoreVersion(
        request,
        token,
        documentId,
        corruptVersionId,
        expectId(currentBeforeCorrupt.updatedAt, 'current content token'),
      )
      expect(corruptRestore.status()).toBe(422)
      expect(await listVersions(request, token, documentId)).toHaveLength(versionsBeforeCorruptRestore.length)
      expect((await getContent(request, token, documentId)).contentHtml).toContain('Intervening edit')
    } finally {
      if (token && documentId) {
        await request.fetch(`/api/documents/${documentId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            ...(documentUpdatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: documentUpdatedAt } : {}),
          },
        }).catch(() => undefined)
      }
    }
  })
})
