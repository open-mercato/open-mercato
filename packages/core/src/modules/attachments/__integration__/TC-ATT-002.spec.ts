import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  deleteAttachmentPartitionIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

test.describe('TC-ATT-002: Attachment partition and transfer APIs', () => {
  test('should create/update/delete partitions and transfer attachments between records', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const partitionCode = `qa_partition_${Date.now()}`
    const fromRecordId = `from-${Date.now()}`
    const toRecordId = `to-${Date.now()}`
    let partitionId: string | null = null
    let attachmentId: string | null = null

    try {
      const partitionsResponse = await apiRequest(request, 'GET', '/api/attachments/partitions', { token })
      expect(partitionsResponse.status()).toBe(200)
      const partitionsBody = await readJsonSafe<{
        items?: Array<{ id: string; code: string; title: string; isPublic: boolean }>
      }>(partitionsResponse)
      expect(partitionsBody?.items?.some((item) => item.code === 'privateAttachments')).toBe(true)

      const existingPartition = partitionsBody?.items?.find((item) => item.code === 'privateAttachments') ?? null

      const createPartitionResponse = await apiRequest(request, 'POST', '/api/attachments/partitions', {
        token,
        data: {
          code: partitionCode,
          title: 'QA Partition',
          description: 'Phase 2 attachment partition',
          isPublic: false,
          requiresOcr: false,
        },
      })

      const partitionsLocked = createPartitionResponse.status() === 403
      if (partitionsLocked) {
        const createBody = await readJsonSafe<{ error?: string }>(createPartitionResponse)
        expect(createBody?.error).toContain('managed by the environment')

        expect(existingPartition).toBeTruthy()

        const updatePartitionResponse = await apiRequest(request, 'PUT', '/api/attachments/partitions', {
          token,
          data: {
            id: existingPartition?.id,
            code: existingPartition?.code,
            title: 'Private attachments updated',
            description: 'Updated partition description',
            isPublic: false,
            requiresOcr: false,
          },
        })
        expect(updatePartitionResponse.status()).toBe(403)

        const deletePartitionResponse = await apiRequest(
          request,
          'DELETE',
          `/api/attachments/partitions?id=${encodeURIComponent(existingPartition?.id ?? '')}`,
          { token },
        )
        expect(deletePartitionResponse.status()).toBe(403)
      } else {
        expect(createPartitionResponse.status()).toBe(201)
        const createBody = await readJsonSafe<{ item?: { id?: string } }>(createPartitionResponse)
        partitionId = createBody?.item?.id ?? null

        const updatePartitionResponse = await apiRequest(request, 'PUT', '/api/attachments/partitions', {
          token,
          data: {
            id: partitionId,
            code: partitionCode,
            title: 'QA Partition Updated',
            description: 'Updated partition description',
            isPublic: true,
            requiresOcr: false,
          },
        })
        expect(updatePartitionResponse.status()).toBe(200)
      }

      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: 'example:todo',
        recordId: fromRecordId,
        fileName: 'transfer-source.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('transfer me', 'utf8'),
        partitionCode: partitionsLocked ? 'privateAttachments' : partitionCode,
      })
      attachmentId = uploaded.id
      expect(uploaded.partitionCode).toBe(partitionsLocked ? 'privateAttachments' : partitionCode)

      if (partitionId) {
        const inUseDeleteResponse = await apiRequest(
          request,
          'DELETE',
          `/api/attachments/partitions?id=${encodeURIComponent(partitionId)}`,
          { token },
        )
        expect(inUseDeleteResponse.status()).toBe(409)
      }

      const transferResponse = await apiRequest(request, 'POST', '/api/attachments/transfer', {
        token,
        data: {
          entityId: 'example:todo',
          attachmentIds: [attachmentId],
          fromRecordId,
          toRecordId,
        },
      })
      expect(transferResponse.status()).toBe(200)
      const transferBody = await readJsonSafe<{ ok?: boolean; updated?: number }>(transferResponse)
      expect(transferBody?.ok).toBe(true)
      expect(transferBody?.updated).toBe(1)

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/attachments/library/${encodeURIComponent(attachmentId)}`,
        { token },
      )
      expect(detailResponse.status()).toBe(200)
      const detailBody = await readJsonSafe<{
        item?: {
          assignments?: Array<{ type: string; id: string }>
          partitionCode?: string
        }
      }>(detailResponse)
      expect(detailBody?.item?.partitionCode).toBe(partitionsLocked ? 'privateAttachments' : partitionCode)
      expect(detailBody?.item?.assignments?.some((assignment) =>
        assignment.type === 'example:todo' && assignment.id === toRecordId,
      )).toBe(true)

      await deleteAttachmentIfExists(request, token, attachmentId)
      attachmentId = null

      if (partitionId) {
        const deletePartitionResponse = await apiRequest(
          request,
          'DELETE',
          `/api/attachments/partitions?id=${encodeURIComponent(partitionId)}`,
          { token },
        )
        expect(deletePartitionResponse.status()).toBe(200)
        partitionId = null
      }
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await deleteAttachmentPartitionIfExists(request, token, partitionId)
    }
  })
})
