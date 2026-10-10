import { metadata } from '@open-mercato/document-generators'
import { metadata as moduleMetadata } from '../index'

describe('document generators module discovery', () => {
  it('exposes the same metadata through the package and module entry points', () => {
    expect(metadata).toBe(moduleMetadata)
    expect(metadata.name).toBe('document_generators')
  })

  it('can load metadata without activating source modules or renderers', () => {
    expect(metadata.requires ?? []).toEqual([])
    expect(metadata.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
