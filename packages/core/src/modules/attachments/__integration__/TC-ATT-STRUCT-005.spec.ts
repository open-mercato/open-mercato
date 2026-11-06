import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  STRUCTURE_TEST_TIMEOUT_MS,
  buildCfrExcerptText,
  deletePartitionQuietly,
  extractAndWait,
  prepareStructurePartition,
  readSections,
  uploadStructureDocument,
  type StructurePartition,
} from './helpers/documentStructure'

test.describe('TC-ATT-STRUCT-005: §-numbered regulation excerpt', () => {
  test('extracts §-numbered sections under their part', async ({ request }) => {
    test.setTimeout(STRUCTURE_TEST_TIMEOUT_MS)
    const token = await getAuthToken(request, 'admin')
    let partition: StructurePartition | null = null
    let attachmentId: string | null = null

    try {
      partition = await prepareStructurePartition(request, token, 'cfr')
      attachmentId = await uploadStructureDocument(request, token, partition, {
        fileName: 'qa-cfr-part-230.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(buildCfrExcerptText(), 'utf8'),
      })
      const structure = await extractAndWait(request, token, attachmentId, partition)
      expect(structure.extraction?.status).toBe('completed')
      expect(structure.extraction?.engine).toBe('text')

      const part = structure.outline.find((node) => node.numberLabel === 'Part 230')
      expect(part, 'outline should contain Part 230').toMatchObject({ kind: 'part', heading: 'General Rules and Regulations' })
      const labels = structure.outline.filter((node) => node.parentId === part?.id).map((node) => [node.numberLabel, node.heading])
      expect(labels).toEqual([
        ['§230.100', 'Definitions'],
        ['§230.101', 'Scope of exemption'],
        ['§230.102', 'Filing requirements'],
      ])

      const bare = await readSections(request, token, attachmentId, `?numberLabel=${encodeURIComponent('230.101')}`)
      expect(bare.status).toBe(200)
      expect(bare.body?.items.map((item) => item.numberLabel)).toEqual(['§230.101'])
      expect(bare.body?.items[0].text).toContain('The exemption applies only to offerings')
      expect(bare.body?.items[0].pageStart).toBeNull()
      expect(bare.body?.items[0].headingPath).toEqual(['Part 230', '§230.101'])
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await deletePartitionQuietly(request, token, partition)
    }
  })
})
