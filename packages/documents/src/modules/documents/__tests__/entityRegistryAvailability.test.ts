const mockGetEnabledModuleIds = jest.fn()

jest.mock('@open-mercato/shared/security/enabledModulesRegistry', () => ({
  getEnabledModuleIds: (...args: unknown[]) => mockGetEnabledModuleIds(...args),
}))

import { DOCUMENT_ENTITY_REGISTRY, getEntityRegistryEntry } from '../lib/entityRegistry'
import { isDocumentEntityRegistryModuleEnabled } from '../lib/entityRegistryAvailability.server'

describe('Documents entity-registry server module availability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('fails closed when the bootstrapped module registry is unavailable', () => {
    mockGetEnabledModuleIds.mockReturnValue([])

    for (const entry of DOCUMENT_ENTITY_REGISTRY) {
      expect(isDocumentEntityRegistryModuleEnabled(entry)).toBe(false)
    }
  })

  it.each([
    ['customer-person', ['customers'], true],
    ['customer-company', ['catalog', 'sales'], false],
    ['deal', ['customers'], true],
    ['product', ['customers'], false],
    ['catalog-offer', ['catalog'], false],
    ['catalog-offer', ['catalog', 'sales'], true],
    ['quote', ['sales'], true],
    ['sales-order', ['customers', 'catalog'], false],
  ] as const)('gates %s by its declared requiredModule', (entityType, enabled, expected) => {
    mockGetEnabledModuleIds.mockReturnValue(enabled)
    const entry = getEntityRegistryEntry(entityType)
    expect(entry).not.toBeNull()
    expect(isDocumentEntityRegistryModuleEnabled(entry!)).toBe(expected)
  })
})
