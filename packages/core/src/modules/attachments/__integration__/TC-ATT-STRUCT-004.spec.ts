import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import {
  STRUCTURE_TEST_TIMEOUT_MS,
  buildRulebookPdf,
  deletePartitionQuietly,
  extractAndWait,
  prepareStructurePartition,
  readSections,
  readStructure,
  structurePath,
  uploadStructureDocument,
  type StructurePartition,
} from './helpers/documentStructure'

type StructureRowCounts = { extractions: number; sections: number }

async function countStructureRows(attachmentId: string): Promise<StructureRowCounts> {
  return withClient(async (client) => {
    const extractions = await client.query<{ total: string }>(
      'select count(*)::text as total from attachment_document_extractions where attachment_id = $1',
      [attachmentId],
    )
    const sections = await client.query<{ total: string }>(
      'select count(*)::text as total from attachment_document_sections where attachment_id = $1',
      [attachmentId],
    )
    return {
      extractions: Number(extractions.rows[0]?.total ?? 0),
      sections: Number(sections.rows[0]?.total ?? 0),
    }
  })
}

test.describe('TC-ATT-STRUCT-004: deleting an attachment purges its structure', () => {
  test('returns 404 from every structure route after the attachment is deleted', async ({ request }) => {
    test.setTimeout(STRUCTURE_TEST_TIMEOUT_MS)
    const token = await getAuthToken(request, 'admin')
    let partition: StructurePartition | null = null
    let attachmentId: string | null = null

    try {
      partition = await prepareStructurePartition(request, token, 'purge')
      attachmentId = await uploadStructureDocument(request, token, partition, {
        fileName: 'qa-rulebook-purge.pdf',
        mimeType: 'application/pdf',
        buffer: await buildRulebookPdf(),
      })
      const structure = await extractAndWait(request, token, attachmentId, partition)
      expect(structure.extraction?.status).toBe('completed')
      const before = await readSections(request, token, attachmentId, '?includeText=false')
      expect(before.status).toBe(200)
      expect(before.body?.items.length).toBeGreaterThan(0)
      const rowsBefore = await countStructureRows(attachmentId)
      expect(rowsBefore.extractions).toBeGreaterThan(0)
      expect(rowsBefore.sections).toBeGreaterThan(0)

      const deleted = await apiRequest(request, 'DELETE', `/api/attachments?id=${encodeURIComponent(attachmentId)}`, { token })
      expect(deleted.status()).toBe(200)
      const removedId = attachmentId
      attachmentId = null

      expect(await countStructureRows(removedId)).toEqual({ extractions: 0, sections: 0 })
      expect((await readStructure(request, token, removedId)).status).toBe(404)
      expect((await readSections(request, token, removedId)).status).toBe(404)
      expect((await readSections(request, token, removedId, `?anchorKey=${structure.outline[0]?.anchorKey ?? ''}`)).status).toBe(404)
      const requestAfterDelete = await apiRequest(request, 'POST', structurePath(removedId), { token, data: { force: true } })
      expect(requestAfterDelete.status()).toBe(404)
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await deletePartitionQuietly(request, token, partition)
    }
  })
})
