import { MetadataStorage } from '@mikro-orm/core'
import { GeneratedDocument } from '../entities'
import { defaultEncryptionMaps } from '../../encryption'

function readMeta() {
  void GeneratedDocument
  const meta = Object.values(MetadataStorage.getMetadata()).find((candidate) => candidate.className === 'GeneratedDocument')
  if (!meta) throw new Error('[internal] GeneratedDocument metadata not registered')
  return meta
}

function readProperties() {
  return readMeta().properties as Record<string, { name: string; nullable?: boolean; default?: unknown; onUpdate?: unknown }>
}

describe('GeneratedDocument entity', () => {
  it('maps to the history table', () => {
    const meta = readMeta()
    expect(meta.tableName).toBe('document_generators_generated_documents')
  })

  it('keeps only attachment_id nullable', () => {
    const nullable = Object.values(readProperties()).filter((property) => property.nullable).map((property) => property.name)
    expect(nullable).toEqual(['attachmentId'])
  })

  it('defaults the format discriminator to pdf', () => {
    const document = new GeneratedDocument()
    expect(document.format).toBe('pdf')
    expect(document.mimeType).toBe('application/pdf')
  })

  it('never auto-touches generated_at', () => {
    const properties = readProperties()
    expect(properties.generatedAt.onUpdate).toBeUndefined()
    expect(properties.updatedAt.onUpdate).toBeDefined()
  })

  it('declares the resource and descending scope indexes', () => {
    const meta = readMeta()
    const indexes = meta.indexes as Array<{ name?: string; properties?: string[]; expression?: string }>
    expect(indexes.find((index) => index.properties?.join() === 'organizationId,resourceKind,resourceId')).toBeDefined()
    expect(indexes.some((index) => index.expression?.includes('("tenant_id", "organization_id", "generated_at" desc)'))).toBe(true)
  })
})

describe('document_generators encryption map', () => {
  it('encrypts resource_label without a hash field', () => {
    expect(defaultEncryptionMaps).toEqual([
      { entityId: 'document_generators:generated_document', fields: [{ field: 'resource_label' }] },
    ])
  })
})
