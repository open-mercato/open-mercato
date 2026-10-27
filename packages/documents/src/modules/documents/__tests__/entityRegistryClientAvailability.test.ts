import { DOCUMENT_ENTITY_REGISTRY } from '../lib/entityRegistry'
import { filterDocumentEntityRegistryByEnabledModules } from '../backend/documents/components/useAvailableEntityRegistry'

describe('Documents entity-registry client module availability', () => {
  it('offers no peer types before ClientBootstrap registers enabled modules', () => {
    expect(filterDocumentEntityRegistryByEnabledModules(
      DOCUMENT_ENTITY_REGISTRY,
      null,
    )).toEqual([])
  })

  it('offers only entity types backed by enabled peer modules', () => {
    const available = filterDocumentEntityRegistryByEnabledModules(
      DOCUMENT_ENTITY_REGISTRY,
      new Set(['documents', 'customers']),
    )

    expect(available.map((entry) => entry.type)).toEqual([
      'customer-person',
      'customer-company',
      'deal',
      'document',
    ])
    expect(available.every((entry) => entry.requiredModule === 'customers' || entry.requiredModule === 'documents')).toBe(true)
  })

  it('requires both the renderer and feature-owner modules for catalog offers', () => {
    expect(filterDocumentEntityRegistryByEnabledModules(
      DOCUMENT_ENTITY_REGISTRY,
      new Set(['documents', 'catalog']),
    ).map((entry) => entry.type)).toEqual(['product', 'document'])

    expect(filterDocumentEntityRegistryByEnabledModules(
      DOCUMENT_ENTITY_REGISTRY,
      new Set(['documents', 'catalog', 'sales']),
    ).map((entry) => entry.type)).toEqual([
      'product',
      'catalog-offer',
      'quote',
      'sales-order',
      'document',
    ])
  })
})
