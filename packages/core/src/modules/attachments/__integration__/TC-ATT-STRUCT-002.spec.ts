import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  PAST_PERFORMANCE_PHRASE,
  STRUCTURE_TEST_TIMEOUT_MS,
  buildRulebookPdf,
  deletePartitionQuietly,
  extractAndWait,
  prepareStructurePartition,
  readSections,
  uploadStructureDocument,
  type StructurePartition,
} from './helpers/documentStructure'

test.describe('TC-ATT-STRUCT-002: document sections lookup and paging', () => {
  test('finds clause 8.12 by number label with locator and citation, and pages by keyset', async ({ request }) => {
    test.setTimeout(STRUCTURE_TEST_TIMEOUT_MS)
    const token = await getAuthToken(request, 'admin')
    let partition: StructurePartition | null = null
    let attachmentId: string | null = null

    try {
      partition = await prepareStructurePartition(request, token, 'sections')
      attachmentId = await uploadStructureDocument(request, token, partition, {
        fileName: 'qa-rulebook-sections.pdf',
        mimeType: 'application/pdf',
        buffer: await buildRulebookPdf(),
      })
      const structure = await extractAndWait(request, token, attachmentId, partition)
      expect(structure.extraction?.status).toBe('completed')

      const lookup = await readSections(request, token, attachmentId, '?numberLabel=8.12')
      expect(lookup.status).toBe(200)
      expect(lookup.body?.extractionId).toBe(structure.extraction?.id)
      expect(lookup.body?.items).toHaveLength(1)
      const clause = lookup.body!.items[0]
      expect(clause).toMatchObject({ numberLabel: '8.12', heading: 'Past performance', pageStart: 3, textTruncated: false })
      expect(clause.text).toContain(PAST_PERFORMANCE_PHRASE)
      expect(clause.locator).toBe(`page:3;sec=8.12;chars=${clause.charStart}-${clause.charEnd}`)
      expect(clause.citation).toContain('8.12')
      expect(clause.citation).toContain('Past performance')

      const byAnchor = await readSections(request, token, attachmentId, `?anchorKey=${clause.anchorKey}&includeText=false`)
      expect(byAnchor.status).toBe(200)
      expect(byAnchor.body?.items.map((item) => item.id)).toEqual([clause.id])
      expect(byAnchor.body?.items[0].text).toBeUndefined()

      const firstPage = await readSections(request, token, attachmentId, '?limit=2&includeText=false')
      expect(firstPage.status).toBe(200)
      expect(firstPage.body?.items).toHaveLength(2)
      const cursor = firstPage.body?.nextCursor
      expect(typeof cursor).toBe('number')
      expect(cursor).toBe(firstPage.body!.items[1].ordinal)

      const secondPage = await readSections(request, token, attachmentId, `?limit=2&includeText=false&afterOrdinal=${cursor}`)
      expect(secondPage.status).toBe(200)
      expect(secondPage.body?.items.length).toBeGreaterThan(0)
      const firstIds = new Set(firstPage.body!.items.map((item) => item.id))
      for (const item of secondPage.body!.items) {
        expect(firstIds.has(item.id)).toBe(false)
        expect(item.ordinal).toBeGreaterThan(cursor as number)
      }

      const overLimit = await readSections(request, token, attachmentId, '?limit=101')
      expect(overLimit.status).toBe(400)
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await deletePartitionQuietly(request, token, partition)
    }
  })
})
