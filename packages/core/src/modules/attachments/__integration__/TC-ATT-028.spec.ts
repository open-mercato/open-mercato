import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..')
const MAX_SEARCH_DEPTH = 5

function candidateStorageRoots(): string[] {
  const configured = process.env.ATTACHMENTS_STORAGE_ROOT?.trim()
  return [
    ...(configured ? [configured] : []),
    path.join(PROJECT_ROOT, 'apps', 'mercato', 'storage', 'attachments'),
    path.join(PROJECT_ROOT, 'storage', 'attachments'),
  ]
}

async function findStoredFile(directory: string, storedNameSuffix: string, depth = 0): Promise<string | null> {
  if (depth > MAX_SEARCH_DEPTH) return null
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isFile() && entry.name.endsWith(storedNameSuffix)) return entryPath
    if (entry.isDirectory()) {
      const found = await findStoredFile(entryPath, storedNameSuffix, depth + 1)
      if (found) return found
    }
  }
  return null
}

async function locateStoredFile(storedNameSuffix: string): Promise<string | null> {
  for (const root of candidateStorageRoots()) {
    const found = await findStoredFile(root, storedNameSuffix)
    if (found) return found
  }
  return null
}

async function fetchAttachmentFile(request: APIRequestContext, token: string, attachmentId: string) {
  return request.fetch(`${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
}

test.describe('TC-ATT-028: file route distinguishes missing files from failed storage reads', () => {
  test('returns 404 STORAGE_FILE_MISSING for a removed file and 500 STORAGE_READ_FAILED for an unreadable one', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const uniqueName = `qa_att_028_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.txt`
    const originalContent = Buffer.from(`TC-ATT-028 ${uniqueName}`, 'utf8')
    let attachmentId: string | null = null
    let storedFilePath: string | null = null

    try {
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId: `qa-att-028-${Date.now()}`,
        fileName: uniqueName,
        mimeType: 'text/plain',
        buffer: originalContent,
      })
      attachmentId = uploaded.id

      const okResponse = await fetchAttachmentFile(request, token, attachmentId)
      expect(okResponse.status()).toBe(200)

      storedFilePath = await locateStoredFile(`_${uniqueName}`)
      test.skip(
        !storedFilePath,
        'Stored file is not reachable from the test runner (remote app or non-local storage driver); this scenario needs a shared filesystem.',
      )
      const filePath = storedFilePath as string

      await fs.rm(filePath)
      const missingResponse = await fetchAttachmentFile(request, token, attachmentId)
      expect(missingResponse.status()).toBe(404)
      const missingBody = await readJsonSafe<Record<string, unknown>>(missingResponse)
      expect(missingBody).toEqual({ error: 'File not available', code: 'STORAGE_FILE_MISSING' })

      await fs.mkdir(filePath)
      const failedResponse = await fetchAttachmentFile(request, token, attachmentId)
      expect(failedResponse.status()).toBe(500)
      const failedBody = await readJsonSafe<Record<string, unknown>>(failedResponse)
      expect(failedBody).toEqual({ error: 'File not available', code: 'STORAGE_READ_FAILED' })
      const rawFailedBody = JSON.stringify(failedBody)
      expect(rawFailedBody).not.toContain(uniqueName)
      expect(rawFailedBody).not.toContain('EISDIR')
    } finally {
      if (storedFilePath) {
        await fs.rm(storedFilePath, { recursive: true, force: true }).catch(() => undefined)
        await fs.writeFile(storedFilePath, originalContent).catch(() => undefined)
      }
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })
})
