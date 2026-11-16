/**
 * Catalog page-context hydration through the REAL catalog tool pack. Only the
 * decryption-aware persistence helpers are stubbed (no DB), so the test proves
 * that the record lookup the hydrator triggers is scoped to the caller's
 * tenant and organization, and that a lookup outside that scope leaves the
 * hydrated context empty.
 */

const mockLoggerInstance = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
}
mockLoggerInstance.child.mockImplementation(() => mockLoggerInstance)

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => mockLoggerInstance),
}))

const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: jest.fn() }),
}))

import { hydrateCatalogAssistantContext } from '../ai-agents-context'

const PRODUCT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function containerWithAcl(acl: { isSuperAdmin: boolean; features: string[]; organizations?: string[] | null }) {
  const loadAcl = jest.fn(async () => ({ organizations: ['org-1'], ...acl }))
  const services: Record<string, unknown> = { rbacService: { loadAcl }, em: {} }
  return { loadAcl, container: { resolve: (name: string) => services[name] ?? null } }
}

function hydrate(container: unknown) {
  return hydrateCatalogAssistantContext({
    entityType: 'catalog.product',
    recordId: PRODUCT_ID,
    container: container as never,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
  })
}

describe('catalog page-context hydration through the real tool pack', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('scopes the product lookup to the caller tenant and organization and renders the found product', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: PRODUCT_ID,
      title: 'Scoped Product',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productType: 'simple',
    })
    const { container, loadAcl } = containerWithAcl({ isSuperAdmin: false, features: ['catalog.products.view'] })
    const result = await hydrate(container)

    expect(loadAcl).toHaveBeenCalledWith('user-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    const [, , where, , scope] = mockFindOneWithDecryption.mock.calls[0]
    expect(where).toMatchObject({ id: PRODUCT_ID, tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(scope).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(result).toContain('Scoped Product')
  })

  it('keeps the hydrated context empty when the product is outside the caller scope', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const { container } = containerWithAcl({ isSuperAdmin: false, features: ['catalog.products.view'] })
    const result = await hydrate(container)
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('drops a product returned for another tenant', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: PRODUCT_ID,
      title: 'Foreign Product',
      tenantId: 'tenant-2',
      organizationId: 'org-9',
      productType: 'simple',
    })
    const { container } = containerWithAcl({ isSuperAdmin: false, features: ['catalog.products.view'] })
    const result = await hydrate(container)
    expect(result).toBeNull()
  })

  it.each([
    ['an empty organization scope', []],
    ['an organization scope excluding the active organization', ['org-2']],
  ])('skips the product lookup for a caller with %s', async (_label, organizations) => {
    const { container } = containerWithAcl({ isSuperAdmin: false, features: ['catalog.products.view'], organizations })
    const result = await hydrate(container)
    expect(result).toBeNull()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it.each([
    ['unrestricted organizations', null],
    ['an explicit all-organizations grant', ['__all__']],
  ])('hydrates for a caller with %s', async (_label, organizations) => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: PRODUCT_ID,
      title: 'Scoped Product',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productType: 'simple',
    })
    const { container } = containerWithAcl({ isSuperAdmin: false, features: ['catalog.products.view'], organizations })
    const result = await hydrate(container)
    expect(result).toContain('Scoped Product')
  })

  it('never reaches the product lookup without a caller identity', async () => {
    const { container, loadAcl } = containerWithAcl({ isSuperAdmin: false, features: ['catalog.products.view'] })
    const result = await hydrateCatalogAssistantContext({
      entityType: 'catalog.product',
      recordId: PRODUCT_ID,
      container: container as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: null,
    })
    expect(result).toBeNull()
    expect(loadAcl).not.toHaveBeenCalled()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })
})
