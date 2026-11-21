import { hasUploadProvenance, withUploadProvenance } from '../uploadProvenance'
import { mergeAttachmentMetadata } from '../metadata'

const auth = { sub: 'actor', tenantId: 'tenant', orgId: 'org' }

it('takes uploader identity exclusively from server auth and preserves assignments', () => {
  const metadata = withUploadProvenance({ __openMercatoUpload: { principalId: 'forged' }, assignments: [{ type: 'documents:document', id: 'document' }] }, auth)
  expect(hasUploadProvenance(metadata, auth)).toBe(true)
  expect(metadata.assignments).toEqual([{ type: 'documents:document', id: 'document' }])
})

it.each([
  { ...auth, sub: 'other' }, { ...auth, tenantId: 'other' }, { ...auth, orgId: 'other' }, { ...auth, orgId: null },
])('refuses a principal or scope mismatch: %o', (otherAuth) => {
  expect(hasUploadProvenance(withUploadProvenance({}, auth), otherAuth)).toBe(false)
})

it('preserves provenance when user-editable tags and assignments change', () => {
  const metadata = withUploadProvenance({ tags: ['old'] }, auth)
  expect(hasUploadProvenance(mergeAttachmentMetadata(metadata, { tags: ['new'], assignments: [] }), auth)).toBe(true)
})

it.each([null, {}, [], { __openMercatoUpload: [] }, { __openMercatoUpload: { principalId: 'actor' } }])('refuses legacy or malformed provenance: %o', (metadata) => {
  expect(hasUploadProvenance(metadata, auth)).toBe(false)
})
