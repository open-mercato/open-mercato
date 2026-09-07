import { createVersionCommandSchema } from '../commands/versions'
import { documentVersionLabelSchema } from '../data/validators'
import { versionCreateSchema } from '../api/[id]/versions/route'
import { sanitizeDocumentVersionLabel } from '../lib/versionLabels'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const documentId = '33333333-3333-4333-8333-333333333333'
const versionId = '44444444-4444-4444-8444-444444444444'

const canonicalIds = [
  '123e4567-e89b-12d3-a456-426614174000',
  '550e8400-e29b-41d4-a716-446655440000',
  '01890f47-e2ab-7cc0-98c9-a72f8b123456',
  'aaaaaaaa-bbbb-fccc-dddd-eeeeeeeeeeee',
]

function commandInput(label: unknown): Record<string, unknown> {
  return { tenantId, organizationId, documentId, versionId, label }
}

describe('document version label boundary', () => {
  it.each(canonicalIds)('rejects canonical UUID version/nibble %s anywhere in new labels', (id) => {
    const label = `Review checkpoint ${id} ready`

    expect(documentVersionLabelSchema.safeParse(label).success).toBe(false)
    expect(versionCreateSchema.safeParse({ label }).success).toBe(false)
    expect(createVersionCommandSchema.safeParse(commandInput(label)).success).toBe(false)
  })

  it('rejects mixed text containing multiple canonical UUID forms', () => {
    const label = `Compared ${canonicalIds[0]} with ${canonicalIds[2]}`
    const result = documentVersionLabelSchema.safeParse(label)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          message: 'documents.validation.versions.readableLabelRequired',
        }),
      ]))
    }
  })

  it('normalizes blank labels and accepts a bounded readable label', () => {
    expect(documentVersionLabelSchema.parse('   ')).toBeNull()
    expect(documentVersionLabelSchema.parse('  Before legal review  ')).toBe('Before legal review')
    expect(documentVersionLabelSchema.safeParse('a'.repeat(257)).success).toBe(false)
  })

  it('drops unsafe or overlong legacy labels while preserving readable values', () => {
    expect(sanitizeDocumentVersionLabel(`Legacy ${canonicalIds[1]}`)).toBeNull()
    expect(sanitizeDocumentVersionLabel('a'.repeat(257))).toBeNull()
    expect(sanitizeDocumentVersionLabel('  Approved draft  ')).toBe('Approved draft')
  })
})
