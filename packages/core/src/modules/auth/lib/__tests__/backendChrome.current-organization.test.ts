/** @jest-environment node */

// `brand` only populates when the scoped organization has a `logoUrl`, so it could never serve as a
// "which organization am I viewing" source. `currentOrganization` fills that gap from the row the
// resolver already loads. The first case below is the regression oracle: an organization with no logo
// must still be identified.

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const USER_ID = '123e4567-e89b-12d3-a456-426614174010'
const ALL_ORGS = '__all__'

const mockFindOneWithDecryption = jest.fn()
const mockResolveFeatureCheckContext = jest.fn()
const mockGetSelectedOrganizationFromRequest = jest.fn()

const mockEm = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) }
const mockRbacService = {
  loadAcl: jest.fn(async () => ({ isSuperAdmin: true, features: ['*'] })),
  userHasAllFeatures: jest.fn(async () => true),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: (...args: unknown[]) => mockResolveFeatureCheckContext(...args),
  getSelectedOrganizationFromRequest: (...args: unknown[]) => mockGetSelectedOrganizationFromRequest(...args),
}))

jest.mock('@open-mercato/core/modules/directory/constants', () => ({
  isAllOrganizationsSelection: (value: string | null) => value === '__all__',
}))

jest.mock('@open-mercato/shared/security/enabledModulesRegistry', () => ({
  filterGrantsByEnabledModules: (grants: string[]) => grants,
}))

jest.mock('@open-mercato/ui/backend/utils/nav', () => ({
  buildAdminNav: jest.fn(async () => []),
  buildSettingsSections: jest.fn(() => []),
  computeSettingsPathPrefixes: jest.fn(() => []),
  convertToSectionNavGroups: jest.fn(() => []),
}))

jest.mock('@open-mercato/ui/backend/icons/lucideRegistry', () => ({
  resolveRegisteredLucideIconNode: jest.fn(() => null),
}))

jest.mock('../profile-sections', () => ({
  profileSections: [],
  profilePathPrefixes: [],
}))

jest.mock('@open-mercato/core/modules/auth/services/sidebarPreferencesService', () => ({
  applySidebarPreference: (groups: unknown) => groups,
  loadFirstRoleSidebarPreference: jest.fn(async () => null),
  loadSidebarPreference: jest.fn(async () => null),
}))

import { resolveBackendChromePayload } from '../backendChrome'

function resolve(selectedOrganizationId: string | null = ORG_ID) {
  return resolveBackendChromePayload({
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, roles: [] } as never,
    locale: 'en',
    modules: [],
    translate: (_key: string | undefined, fallback: string) => fallback,
    selectedOrganizationId,
    selectedTenantId: TENANT_ID,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEm.find.mockResolvedValue([])
  mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: ['*'] })
  mockRbacService.userHasAllFeatures.mockResolvedValue(true)
  mockGetSelectedOrganizationFromRequest.mockReturnValue(null)
  mockResolveFeatureCheckContext.mockResolvedValue({
    organizationId: ORG_ID,
    scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    allowedOrganizationIds: [ORG_ID],
  })
})

describe('resolveBackendChromePayload — currentOrganization', () => {
  it('identifies an organization that has no logo, where brand stays null', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: ORG_ID, name: 'Northwind Ltd', logoUrl: null })

    const payload = await resolve()

    expect(payload.currentOrganization).toEqual({ id: ORG_ID, name: 'Northwind Ltd' })
    expect(payload.brand).toBeNull()
  })

  it('populates both when the organization has a logo, leaving brand behaviour unchanged', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: ORG_ID,
      name: 'Northwind Ltd',
      logoUrl: 'https://cdn.example.com/logo.png',
    })

    const payload = await resolve()

    expect(payload.currentOrganization).toEqual({ id: ORG_ID, name: 'Northwind Ltd' })
    expect(payload.brand).toEqual({
      name: 'Northwind Ltd',
      logo: { src: 'https://cdn.example.com/logo.png', alt: 'Northwind Ltd logo' },
    })
  })

  it('is null under an all-organizations selection', async () => {
    mockResolveFeatureCheckContext.mockResolvedValue({
      organizationId: null,
      scope: { tenantId: TENANT_ID, organizationId: null },
      allowedOrganizationIds: [ORG_ID],
    })

    const payload = await resolve(ALL_ORGS)

    expect(payload.currentOrganization).toBeNull()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('is null and the payload still resolves when the organization lookup fails', async () => {
    mockFindOneWithDecryption.mockRejectedValue(new Error('database unavailable'))

    const payload = await resolve()

    expect(payload.currentOrganization).toBeNull()
    expect(payload.brand).toBeNull()
    expect(Array.isArray(payload.groups)).toBe(true)
  })

  it('is null when the organization row cannot be found', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    const payload = await resolve()

    expect(payload.currentOrganization).toBeNull()
    expect(payload.brand).toBeNull()
  })

  it('scopes the organization lookup to the resolved tenant and organization', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: ORG_ID, name: 'Northwind Ltd', logoUrl: null })

    await resolve()

    const [, , where] = mockFindOneWithDecryption.mock.calls[0]
    expect(where).toMatchObject({ id: ORG_ID, tenant: TENANT_ID, deletedAt: null })
  })
})
