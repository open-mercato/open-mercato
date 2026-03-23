import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

test.describe('TC-ATT-001: Attachment upload and library APIs', () => {
  test('should upload, list, detail, patch, and delete an attachment', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const recordId = `qa-library-record-${Date.now()}`
    let attachmentId: string | null = null

    try {
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'phase2-attachment.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('phase 2 attachment body', 'utf8'),
        tags: ['phase2', 'initial'],
      })
      attachmentId = uploaded.id
      expect(uploaded.fileName).toBe('phase2-attachment.txt')
      expect(uploaded.tags).toEqual(['phase2', 'initial'])

      const recordListResponse = await apiRequest(
        request,
        'GET',
        `/api/attachments?entityId=${encodeURIComponent('attachments:library')}&recordId=${encodeURIComponent(recordId)}`,
        { token },
      )
      expect(recordListResponse.status()).toBe(200)
      const recordListBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(recordListResponse)
      expect(recordListBody?.items?.some((item) => item.id === attachmentId)).toBe(true)

      const libraryListResponse = await apiRequest(
        request,
        'GET',
        `/api/attachments/library?search=${encodeURIComponent('phase2-attachment')}`,
        { token },
      )
      expect(libraryListResponse.status()).toBe(200)
      const libraryListBody = await readJsonSafe<{
        items?: Array<{ id: string }>
        availableTags?: string[]
      }>(libraryListResponse)
      expect(libraryListBody?.items?.some((item) => item.id === attachmentId)).toBe(true)
      expect(libraryListBody?.availableTags?.includes('phase2')).toBe(true)

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/attachments/library/${encodeURIComponent(attachmentId)}`,
        { token },
      )
      expect(detailResponse.status()).toBe(200)
      const detailBody = await readJsonSafe<{
        item?: { id: string; fileName: string; tags: string[]; content?: string | null }
      }>(detailResponse)
      expect(detailBody?.item?.id).toBe(attachmentId)
      expect(detailBody?.item?.fileName).toBe('phase2-attachment.txt')
      expect(detailBody?.item?.tags).toEqual(['phase2', 'initial'])

      const patchResponse = await apiRequest(
        request,
        'PATCH',
        `/api/attachments/library/${encodeURIComponent(attachmentId)}`,
        {
          token,
          data: {
            tags: ['phase2', 'updated'],
            assignments: [
              {
                type: 'example:todo',
                id: 'todo-123',
                label: 'Todo 123',
              },
            ],
          },
        },
      )
      expect(patchResponse.status()).toBe(200)
      const patchBody = await readJsonSafe<{
        item?: {
          id?: string
          tags?: string[]
          assignments?: Array<{ type: string; id: string; label?: string | null }>
        }
      }>(patchResponse)
      expect(patchBody?.item?.tags).toEqual(['phase2', 'updated'])
      expect(patchBody?.item?.assignments?.[0]).toMatchObject({
        type: 'example:todo',
        id: 'todo-123',
      })

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/attachments/library/${encodeURIComponent(attachmentId)}`,
        { token },
      )
      expect(deleteResponse.status()).toBe(200)
      attachmentId = null

      const afterDeleteResponse = await apiRequest(
        request,
        'GET',
        `/api/attachments/library/${encodeURIComponent(uploaded.id)}`,
        { token },
      )
      expect(afterDeleteResponse.status()).toBe(404)
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })
})
