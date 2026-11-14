import fs from 'node:fs'
import path from 'node:path'
import { AttachmentDocumentExtraction, AttachmentPartition } from '../entities'

type SnapshotColumn = { name: string; type: string; nullable: boolean; default: string | null }
type SnapshotTable = { name: string; columns: Record<string, SnapshotColumn>; indexes: Array<{ keyName: string; unique: boolean }> }
type Snapshot = { tables: SnapshotTable[] }

function readSnapshot(): Snapshot {
  const snapshotPath = path.join(__dirname, '..', '..', 'migrations', '.snapshot-open-mercato.json')
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as Snapshot
}

function findTable(snapshot: Snapshot, name: string): SnapshotTable {
  const table = snapshot.tables.find((entry) => entry.name === name)
  if (!table) throw new Error(`[internal] missing snapshot table ${name}`)
  return table
}

describe('attachments document structure entities', () => {
  it('defaults both partition structure flags to false', () => {
    const partition = new AttachmentPartition()
    expect(partition.extractDocumentStructure).toBe(false)
    expect(partition.indexDocumentSections).toBe(false)
  })

  it('starts a new extraction in pending status', () => {
    expect(new AttachmentDocumentExtraction().status).toBe('pending')
  })

  it('keeps the migration snapshot in sync with the partition flags', () => {
    const partitions = findTable(readSnapshot(), 'attachment_partitions')
    for (const column of ['extract_document_structure', 'index_document_sections']) {
      expect(partitions.columns[column]).toMatchObject({ type: 'boolean', nullable: false, default: 'false' })
    }
  })

  it('records the extraction and section tables with their indexes in the snapshot', () => {
    const snapshot = readSnapshot()
    const extractions = findTable(snapshot, 'attachment_document_extractions')
    const sections = findTable(snapshot, 'attachment_document_sections')

    expect(Object.keys(extractions.columns)).toEqual(
      expect.arrayContaining(['attachment_id', 'content_sha256', 'engine_version', 'normalized_text', 'updated_at', 'deleted_at']),
    )
    expect(Object.keys(sections.columns)).toEqual(
      expect.arrayContaining(['extraction_id', 'parent_id', 'number_label', 'anchor_key', 'heading_path', 'text', 'char_start', 'char_end']),
    )
    expect(extractions.indexes.map((index) => index.keyName)).toEqual(
      expect.arrayContaining([
        'attachment_document_extractions_live_unique',
        'attachment_document_extractions_attachment_idx',
        'attachment_document_extractions_scope_idx',
      ]),
    )
    expect(sections.indexes.map((index) => index.keyName)).toEqual(
      expect.arrayContaining([
        'attachment_document_sections_extraction_ordinal_idx',
        'attachment_document_sections_number_label_idx',
        'attachment_document_sections_anchor_key_idx',
        'attachment_document_sections_scope_idx',
      ]),
    )
  })
})
