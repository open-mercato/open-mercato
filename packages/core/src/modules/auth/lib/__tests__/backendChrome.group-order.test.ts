/** @jest-environment node */

// The first case here is the safety property that makes this change additive: with no
// `overrides.nav.groupOrder` configured, group ordering must be exactly what `develop` produces. The
// expected array below is the shipped `defaultGroupOrder`, followed by unlisted groups ordered by
// weight and then name — captured from the unmodified implementation.

const mockGetNavGroupOrderOverride = jest.fn<readonly string[] | null, []>()

jest.mock('@open-mercato/shared/modules/overrides', () => ({
  getNavGroupOrderOverride: () => mockGetNavGroupOrderOverride(),
}))

const mockFindOneWithDecryption = jest.fn(async () => null)
const mockBuildAdminNav = jest.fn()

const mockEm = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) }
const mockRbacService = {
  loadAcl: jest.fn(async () => ({ isSuperAdmin: true, features: ['*'] })),
  getEffectiveFeatures: jest.fn(async () => ['*']),
  userHasAllFeatures: jest.fn(async () => true),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      if (token === 'rbacService') return mockRbacService
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [])),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(async () => ({
    organizationId: null,
    scope: { tenantId: 'tenant-1', organizationId: null },
    allowedOrganizationIds: ['org-1'],
  })),
  getSelectedOrganizationFromRequest: jest.fn(() => null),
}))

jest.mock('@open-mercato/core/modules/directory/constants', () => ({
  isAllOrganizationsSelection: () => true,
}))

jest.mock('@open-mercato/shared/security/enabledModulesRegistry', () => ({
  filterGrantsByEnabledModules: (grants: string[]) => grants,
}))

jest.mock('@open-mercato/ui/backend/utils/nav', () => ({
  buildAdminNav: (...args: unknown[]) => mockBuildAdminNav(...(args as [])),
  buildSettingsSections: jest.fn(() => []),
  buildProfileSections: jest.fn(() => []),
  computeSettingsPathPrefixes: jest.fn(() => []),
  convertToSectionNavGroups: jest.fn(() => []),
  mergeSectionsWithDiscovered: jest.fn((baseline: unknown) => baseline),
}))

jest.mock('@open-mercato/ui/backend/icons/lucideRegistry', () => ({
  resolveRegisteredLucideIconNode: jest.fn(() => null),
}))

jest.mock('../profile-sections', () => ({ profileSections: [], profilePathPrefixes: [] }))

jest.mock('@open-mercato/core/modules/auth/services/sidebarPreferencesService', () => ({
  applySidebarPreference: (groups: unknown) => groups,
  loadFirstRoleSidebarPreference: jest.fn(async () => null),
  findSidebarPreference: jest.fn(async () => null),
}))

import { resolveBackendChromePayload } from '../backendChrome'

// One nav entry per group, so each group exists with a predictable weight.
const NAV_GROUPS: Array<{ groupId: string; priority: number }> = [
  { groupId: 'attachments.nav.group', priority: 10 },
  { groupId: 'zulu.app.nav.group', priority: 10 },
  { groupId: 'catalog.nav.group', priority: 10 },
  { groupId: 'alpha.app.nav.group', priority: 10 },
  { groupId: 'customers.nav.group', priority: 10 },
]

function navEntries() {
  return NAV_GROUPS.map(({ groupId, priority }) => ({
    href: `/backend/${groupId}`,
    title: groupId,
    defaultTitle: groupId,
    groupId,
    group: groupId,
    groupDefaultName: groupId,
    priority,
  }))
}

async function resolvedGroupIds(): Promise<string[]> {
  const payload = await resolveBackendChromePayload({
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null, roles: [] } as never,
    locale: 'en',
    modules: [],
    translate: (_key: string | undefined, fallback: string) => fallback,
  })
  return payload.groups.map((group) => group.id)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEm.find.mockResolvedValue([])
  mockRbacService.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: ['*'] })
  mockRbacService.getEffectiveFeatures.mockResolvedValue(['*'])
  mockRbacService.userHasAllFeatures.mockResolvedValue(true)
  mockBuildAdminNav.mockResolvedValue(navEntries())
  mockGetNavGroupOrderOverride.mockReturnValue(null)
})

describe('sidebar group ordering', () => {
  it('is unchanged when no override is configured', async () => {
    expect(await resolvedGroupIds()).toEqual([
      // shipped defaultGroupOrder members, in their shipped order
      'customers.nav.group',
      'catalog.nav.group',
      'attachments.nav.group',
      // everything else keeps the existing weight-then-name fallback
      'alpha.app.nav.group',
      'zulu.app.nav.group',
    ])
  })

  it('treats an empty override list as no override', async () => {
    mockGetNavGroupOrderOverride.mockReturnValue([])

    expect(await resolvedGroupIds()).toEqual([
      'customers.nav.group',
      'catalog.nav.group',
      'attachments.nav.group',
      'alpha.app.nav.group',
      'zulu.app.nav.group',
    ])
  })

  it('ranks an app group ahead of the shipped groups when it is named', async () => {
    mockGetNavGroupOrderOverride.mockReturnValue(['zulu.app.nav.group'])

    expect(await resolvedGroupIds()).toEqual([
      'zulu.app.nav.group',
      'customers.nav.group',
      'catalog.nav.group',
      'attachments.nav.group',
      'alpha.app.nav.group',
    ])
  })

  it('prepends rather than replaces, so unnamed shipped groups keep their relative order', async () => {
    mockGetNavGroupOrderOverride.mockReturnValue(['alpha.app.nav.group'])

    const ids = await resolvedGroupIds()

    expect(ids[0]).toBe('alpha.app.nav.group')
    expect(ids.indexOf('customers.nav.group')).toBeLessThan(ids.indexOf('catalog.nav.group'))
    expect(ids.indexOf('catalog.nav.group')).toBeLessThan(ids.indexOf('attachments.nav.group'))
  })

  it('honours the order within the override itself', async () => {
    mockGetNavGroupOrderOverride.mockReturnValue(['zulu.app.nav.group', 'alpha.app.nav.group'])

    const ids = await resolvedGroupIds()

    expect(ids.slice(0, 2)).toEqual(['zulu.app.nav.group', 'alpha.app.nav.group'])
  })

  it('can reorder shipped groups against each other', async () => {
    mockGetNavGroupOrderOverride.mockReturnValue(['catalog.nav.group', 'customers.nav.group'])

    const ids = await resolvedGroupIds()

    expect(ids.slice(0, 2)).toEqual(['catalog.nav.group', 'customers.nav.group'])
  })

  it('ignores ids for groups that do not exist', async () => {
    mockGetNavGroupOrderOverride.mockReturnValue(['not-a-real.nav.group', 'zulu.app.nav.group'])

    const ids = await resolvedGroupIds()

    expect(ids).not.toContain('not-a-real.nav.group')
    expect(ids[0]).toBe('zulu.app.nav.group')
    expect(ids).toHaveLength(NAV_GROUPS.length)
  })
})
