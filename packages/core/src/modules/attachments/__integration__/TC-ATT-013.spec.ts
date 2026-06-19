import { randomUUID } from 'crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

/**
 * TC-ATT-013: Transfer API — payload and matching validation
 * Source: GitHub issue #2488 (attachments integration coverage)
 * Surface: /api/attachments/transfer (POST)
 *
 * Empty attachmentIds or a missing toRecordId fail schema validation (400). A valid
 * UUID that matches no record, or a mismatched entityId, yields 404. A valid transfer
 * moves recordId and rewrites the matching assignment to the new record.
 */
test.describe('TC-ATT-013: Attachment transfer validation', () => {
  test('should validate payloads, matching, and perform a real transfer', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const entityId = 'example:todo'
    const fromRecordId = `att013-from-${stamp}`
    const toRecordId = `att013-to-${stamp}`

    let attachmentId: string | null = null

    try {
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId,
        recordId: fromRecordId,
        fileName: 'transfer-013.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('transfer fixture', 'utf8'),
      })
      attachmentId = uploaded.id

      // Empty attachmentIds → 400 (schema requires at least one).
      const emptyResponse = await apiRequest(request, 'POST', '/api/attachments/transfer', {
        token,
        data: { entityId, attachmentIds: [], toRecordId },
      })
      expect(emptyResponse.status(), 'empty attachmentIds should be 400').toBe(400)

      // Missing toRecordId → 400 (schema requires it).
      const missingTargetResponse = await apiRequest(request, 'POST', '/api/attachments/transfer', {
        token,
        data: { entityId, attachmentIds: [attachmentId] },
      })
      expect(missingTargetResponse.status(), 'missing toRecordId should be 400').toBe(400)

      // Valid UUID that matches no attachment → 404.
      const missingRecordResponse = await apiRequest(request, 'POST', '/api/attachments/transfer', {
        token,
        data: { entityId, attachmentIds: [randomUUID()], toRecordId },
      })
      expect(missingRecordResponse.status(), 'non-existent attachmentId should be 404').toBe(404)

      // Mismatched entityId (attachment belongs to example:todo) → 404.
      const mismatchedResponse = await apiRequest(request, 'POST', '/api/attachments/transfer', {
        token,
        data: { entityId: 'example:note', attachmentIds: [attachmentId], toRecordId },
      })
      expect(mismatchedResponse.status(), 'mismatched entityId should be 404').toBe(404)

      // Valid transfer → 200 { ok: true, updated: 1 }.
      const transferResponse = await apiRequest(request, 'POST', '/api/attachments/transfer', {
        token,
        data: { entityId, attachmentIds: [attachmentId], toRecordId },
      })
      expect(transferResponse.status(), 'valid transfer should be 200').toBe(200)
      const transferBody = await readJsonSafe<{ ok?: boolean; updated?: number }>(transferResponse)
      expect(transferBody?.ok).toBe(true)
      expect(transferBody?.updated).toBe(1)

      // The attachment now lives under the target record and not the source record.
      const atTarget = await apiRequest(
        request,
        'GET',
        `/api/attachments?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(toRecordId)}`,
        { token },
      )
      expect(atTarget.status()).toBe(200)
      const atTargetBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(atTarget)
      expect(atTargetBody?.items?.some((item) => item.id === attachmentId)).toBe(true)

      const atSource = await apiRequest(
        request,
        'GET',
        `/api/attachments?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(fromRecordId)}`,
        { token },
      )
      expect(atSource.status()).toBe(200)
      const atSourceBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(atSource)
      expect(atSourceBody?.items?.some((item) => item.id === attachmentId)).toBe(false)

      // The auto-created assignment was rewritten to the new record id.
      const detail = await apiRequest(
        request,
        'GET',
        `/api/attachments/library/${encodeURIComponent(attachmentId)}`,
        { token },
      )
      expect(detail.status()).toBe(200)
      const detailBody = await readJsonSafe<{
        item?: { assignments?: Array<{ type: string; id: string }> }
      }>(detail)
      expect(
        detailBody?.item?.assignments?.some(
          (assignment) => assignment.type === entityId && assignment.id === toRecordId,
        ),
      ).toBe(true)
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })
})
