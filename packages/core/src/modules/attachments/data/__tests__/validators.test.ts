import {
  DOCUMENT_SECTIONS_REQUIRE_STRUCTURE_MESSAGE,
  isDocumentStructureFlagCombinationValid,
  partitionCreateSchema,
  partitionUpdateSchema,
} from '../validators'

const PARTITION_ID = '22222222-2222-4222-8222-222222222222'

describe('attachment partition validators', () => {
  it('defaults both document structure flags to false on create', () => {
    const parsed = partitionCreateSchema.parse({ code: 'contracts', title: 'Contracts' })
    expect(parsed.extractDocumentStructure).toBe(false)
    expect(parsed.indexDocumentSections).toBe(false)
    expect(parsed.storageDriver).toBe('local')
  })

  it('accepts extraction without section indexing', () => {
    const parsed = partitionCreateSchema.parse({
      code: 'contracts',
      title: 'Contracts',
      extractDocumentStructure: true,
    })
    expect(parsed.extractDocumentStructure).toBe(true)
    expect(parsed.indexDocumentSections).toBe(false)
  })

  it('accepts section indexing when extraction is enabled', () => {
    const result = partitionCreateSchema.safeParse({
      code: 'manuals',
      title: 'Manuals',
      extractDocumentStructure: true,
      indexDocumentSections: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects section indexing without extraction on create with a field error', () => {
    const result = partitionCreateSchema.safeParse({
      code: 'manuals',
      title: 'Manuals',
      indexDocumentSections: true,
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues).toEqual([
      expect.objectContaining({
        path: ['indexDocumentSections'],
        message: DOCUMENT_SECTIONS_REQUIRE_STRUCTURE_MESSAGE,
      }),
    ])
  })

  it('leaves omitted flags undefined on update so stored values are kept', () => {
    const parsed = partitionUpdateSchema.parse({ id: PARTITION_ID, code: 'contracts', title: 'Contracts' })
    expect(parsed.extractDocumentStructure).toBeUndefined()
    expect(parsed.indexDocumentSections).toBeUndefined()
  })

  it('rejects section indexing with extraction explicitly off on update', () => {
    const result = partitionUpdateSchema.safeParse({
      id: PARTITION_ID,
      code: 'contracts',
      title: 'Contracts',
      extractDocumentStructure: false,
      indexDocumentSections: true,
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path).toEqual(['indexDocumentSections'])
  })

  it('evaluates flag combinations', () => {
    expect(isDocumentStructureFlagCombinationValid({})).toBe(true)
    expect(isDocumentStructureFlagCombinationValid({ extractDocumentStructure: true })).toBe(true)
    expect(isDocumentStructureFlagCombinationValid({ extractDocumentStructure: true, indexDocumentSections: true })).toBe(true)
    expect(isDocumentStructureFlagCombinationValid({ indexDocumentSections: true })).toBe(false)
    expect(isDocumentStructureFlagCombinationValid({ extractDocumentStructure: false, indexDocumentSections: true })).toBe(false)
  })
})
