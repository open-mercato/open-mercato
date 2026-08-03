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
  getEffectiveFeatures: jest.fn(async () => ['*']),
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

/**
 * Faithful `FeatureCheckContext` shapes. The real `OrganizationScope`
 * (`modules/directory/utils/organizationScope.ts:16`) carries
 * `selectedId`/`filterIds`/`allowedIds`/`tenantId` and has **no** `organizationId`. An earlier version
 * of this file invented that property, which let the all-organizations case pass while the real
 * resolver did the opposite — the integration spec `TC-AUTH-NAV-ORG-001` caught it.
 *
 * The asymmetry these helpers preserve is the whole point: with no concrete selection, the resolver
 * still returns an `organizationId`, because it falls back to `auth.orgId`.
 */
function concreteSelection(organizationId: string) {
  return {
    organizationId,
    scope: {
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId: TENANT_ID,
    },
    allowedOrganizationIds: [organizationId],
  }
}

function allOrganizationsSelection(fallbackOrganizationId: string | null) {
  return {
    organizationId: fallbackOrganizationId,
    scope: { selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID },
    allowedOrganizationIds: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEm.find.mockResolvedValue([])
  mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: ['*'] })
  mockRbacService.getEffectiveFeatures.mockResolvedValue(['*'])
  mockRbacService.userHasAllFeatures.mockResolvedValue(true)
  mockGetSelectedOrganizationFromRequest.mockReturnValue(null)
  mockResolveFeatureCheckContext.mockResolvedValue(concreteSelection(ORG_ID))
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

  it('is null under an all-organizations selection, even though the resolver still returns an organization id', async () => {
    // The regression this test exists for: the resolver falls back to `auth.orgId` here, so the
    // organization row is still loaded (branding depends on it) and a payload built from the resolved
    // id would name that organization while the operator is viewing all of them.
    mockResolveFeatureCheckContext.mockResolvedValue(allOrganizationsSelection(ORG_ID))
    mockFindOneWithDecryption.mockResolvedValue({ id: ORG_ID, name: 'Northwind Ltd', logoUrl: null })

    const payload = await resolve(ALL_ORGS)

    expect(payload.currentOrganization).toBeNull()
  })

  it('keeps branding working under an all-organizations selection', async () => {
    // Corollary of the above: the fallback organization is still the branding source, so suppressing
    // `currentOrganization` must not suppress `brand`.
    mockResolveFeatureCheckContext.mockResolvedValue(allOrganizationsSelection(ORG_ID))
    mockFindOneWithDecryption.mockResolvedValue({
      id: ORG_ID,
      name: 'Northwind Ltd',
      logoUrl: 'https://cdn.example.com/logo.png',
    })

    const payload = await resolve(ALL_ORGS)

    expect(payload.currentOrganization).toBeNull()
    expect(payload.brand).toEqual({
      name: 'Northwind Ltd',
      logo: { src: 'https://cdn.example.com/logo.png', alt: 'Northwind Ltd logo' },
    })
  })

  it('is null when no organization is in scope at all', async () => {
    mockResolveFeatureCheckContext.mockResolvedValue(allOrganizationsSelection(null))

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
