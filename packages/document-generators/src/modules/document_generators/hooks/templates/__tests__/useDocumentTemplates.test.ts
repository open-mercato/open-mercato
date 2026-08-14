import { buildDocumentTemplatesUrl, documentTemplatesQueryKey } from '../useDocumentTemplates'

describe('document template query', () => {
  it('keeps the global catalogue URL when no filters are selected', () => {
    expect(buildDocumentTemplatesUrl({})).toBe('/api/document-generators/templates')
  })

  it('serializes every supported server filter', () => {
    const url = buildDocumentTemplatesUrl({
      resourceKind: 'example.record',
      documentType: 'report',
      format: 'pdf',
      tags: ['accounting', 'customer copy'],
    })

    expect(url).toBe(
      '/api/document-generators/templates?resource_kind=example.record&document_type=report&format=pdf&tags=accounting&tags=customer+copy',
    )
  })

  it('separates cached results for different filters', () => {
    expect(documentTemplatesQueryKey({ resourceKind: 'example.record' }))
      .not.toEqual(documentTemplatesQueryKey({ resourceKind: 'example.report' }))
  })
})
