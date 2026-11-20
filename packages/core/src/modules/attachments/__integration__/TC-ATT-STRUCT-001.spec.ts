import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  STRUCTURE_TEST_TIMEOUT_MS,
  buildRulebookPdf,
  deletePartitionQuietly,
  extractAndWait,
  prepareStructurePartition,
  uploadStructureDocument,
  type StructurePartition,
} from './helpers/documentStructure'

test.describe('TC-ATT-STRUCT-001: PDF document structure outline', () => {
  test('extracts a rulebook PDF and exposes chapter 8 with clause 8.12 on its page', async ({ request }) => {
    test.setTimeout(STRUCTURE_TEST_TIMEOUT_MS)
    const token = await getAuthToken(request, 'admin')
    let partition: StructurePartition | null = null
    let attachmentId: string | null = null

    try {
      partition = await prepareStructurePartition(request, token, 'outline')
      attachmentId = await uploadStructureDocument(request, token, partition, {
        fileName: 'qa-rulebook.pdf',
        mimeType: 'application/pdf',
        buffer: await buildRulebookPdf(),
      })

      const structure = await extractAndWait(request, token, attachmentId, partition)
      expect(structure.attachmentId).toBe(attachmentId)
      expect(structure.extraction?.status).toBe('completed')
      expect(structure.extraction?.engine).toBe('pdf_layout')
      expect(structure.extraction?.pageCount).toBe(3)

      const chapter = structure.outline.find((node) => node.numberLabel === 'Chapter 8')
      expect(chapter, 'outline should contain chapter 8').toBeTruthy()
      expect(chapter).toMatchObject({ kind: 'chapter', heading: 'Financial Promotions', pageStart: 2 })

      const clause = structure.outline.find((node) => node.numberLabel === '8.12')
      expect(clause, 'outline should contain clause 8.12').toBeTruthy()
      expect(clause).toMatchObject({ kind: 'clause', heading: 'Past performance', pageStart: 3, parentId: chapter?.id })
      expect(clause?.anchorKey).toMatch(/^[0-9a-f]{32}$/)
      expect(chapter?.childCount).toBeGreaterThanOrEqual(3)
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await deletePartitionQuietly(request, token, partition)
    }
  })
})
