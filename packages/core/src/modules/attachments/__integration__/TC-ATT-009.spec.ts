import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

/**
 * TC-ATT-009: Upload validation — dangerous executable extensions are rejected
 * Source: GitHub issue #2488 (attachments integration coverage)
 * Surface: /api/attachments (POST)
 *
 * `hasDangerousExecutableExtension` rejects executable extensions (exe, bat, …)
 * case-insensitively with HTTP 400 and a structured error message. Ordinary
 * document/image types upload successfully.
 *
 * Assertions check the 400 status (the locale-independent contract) plus a
 * non-empty error body — the rejection message is localized via `t(...)`, so
 * matching specific English copy would be brittle across locales.
 */

// Minimal 10x10 red PNG (valid binary fixture), mirrors TC-ATT-005.
function makeMinimalPng(): Buffer {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=='
  return Buffer.from(base64, 'base64')
}

async function uploadFile(
  request: APIRequestContext,
  token: string,
  recordId: string,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<APIResponse> {
  return request.fetch(`${BASE_URL}/api/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      entityId: 'attachments:library',
      recordId,
      file,
    },
  })
}

test.describe('TC-ATT-009: Attachment upload validation (dangerous extensions)', () => {
  test('should reject executable uploads with 400 and allow legitimate types', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const recordId = `qa-validation-009-${stamp}`
    const createdIds: string[] = []

    try {
      // .exe → 400, message mentions "Executable".
      const exeResponse = await uploadFile(request, token, recordId, {
        name: 'payload.exe',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('MZ executable stub', 'utf8'),
      })
      expect(exeResponse.status(), '.exe upload should be 400').toBe(400)
      const exeBody = await readJsonSafe<{ error?: string }>(exeResponse)
      expect(
        typeof exeBody?.error === 'string' && exeBody.error.length > 0,
        '.exe rejection should include an error message',
      ).toBe(true)

      // .bat → 400.
      const batResponse = await uploadFile(request, token, recordId, {
        name: 'script.bat',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('@echo off', 'utf8'),
      })
      expect(batResponse.status(), '.bat upload should be 400').toBe(400)
      const batBody = await readJsonSafe<{ error?: string }>(batResponse)
      expect(
        typeof batBody?.error === 'string' && batBody.error.length > 0,
        '.bat rejection should include an error message',
      ).toBe(true)

      // Uppercase .EXE → 400 (extension matching is case-insensitive).
      const upperExeResponse = await uploadFile(request, token, recordId, {
        name: 'PAYLOAD.EXE',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('MZ executable stub', 'utf8'),
      })
      expect(upperExeResponse.status(), '.EXE upload should be 400').toBe(400)

      // .txt → 200 (sanity).
      const txtResponse = await uploadFile(request, token, recordId, {
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('plain text body', 'utf8'),
      })
      expect(txtResponse.status(), '.txt upload should be 200').toBe(200)
      const txtBody = await readJsonSafe<{ item?: { id?: string } }>(txtResponse)
      if (txtBody?.item?.id) createdIds.push(txtBody.item.id)

      // Legitimate image → 200.
      const pngResponse = await uploadFile(request, token, recordId, {
        name: 'picture.png',
        mimeType: 'image/png',
        buffer: makeMinimalPng(),
      })
      expect(pngResponse.status(), '.png upload should be 200').toBe(200)
      const pngBody = await readJsonSafe<{ item?: { id?: string } }>(pngResponse)
      if (pngBody?.item?.id) createdIds.push(pngBody.item.id)

      // Legitimate document → 200.
      const pdfResponse = await uploadFile(request, token, recordId, {
        name: 'document.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 minimal document', 'utf8'),
      })
      expect(pdfResponse.status(), '.pdf upload should be 200').toBe(200)
      const pdfBody = await readJsonSafe<{ item?: { id?: string } }>(pdfResponse)
      if (pdfBody?.item?.id) createdIds.push(pdfBody.item.id)
    } finally {
      for (const id of createdIds) {
        await deleteAttachmentIfExists(request, token, id)
      }
    }
  })
})
