/** @jest-environment node */

// The sidebar is a two-layer merge: role preference over the base nav, then `adoptSidebarDefaults`
// bakes the role-applied state as the new defaults, then the user preference over that.
// `applySidebarPreference` OVERWRITES `hidden` (`next.hidden = hidden`) instead of OR-ing it, and
// falls back to weight/name ordering when `groupOrder` is empty — so running the user pass with an
// empty settings object erases the whole role layer. That is exactly what happened while
// `loadSidebarPreference` returned normalized defaults instead of `null` for a user with no saved
// row: the `userPreference ? ... : baseForUser` guard could never take its else-branch.
//
// These tests keep the REAL `applySidebarPreference` (the merge behaviour is what is under test)
// and stub only the two loaders.

const mockLoadFirstRoleSidebarPreference = jest.fn()
const mockLoadSidebarPreference = jest.fn()

jest.mock('@open-mercato/shared/modules/overrides', () => ({
  getNavGroupOrderOverride: () => null,
}))

const mockFindOneWithDecryption = jest.fn(async () => null)
const mockBuildAdminNav = jest.fn()

const mockEm = {
  find: jest.fn(async (entity: { name?: string }) => (entity?.name === 'Role' ? [{ id: 'role-1' }] : [])),
  findOne: jest.fn(async () => null),
}
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
  computeSettingsPathPrefixes: jest.fn(() => []),
  convertToSectionNavGroups: jest.fn(() => []),
}))

jest.mock('@open-mercato/ui/backend/icons/lucideRegistry', () => ({
  resolveRegisteredLucideIconNode: jest.fn(() => null),
}))

jest.mock('../profile-sections', () => ({ profileSections: [], profilePathPrefixes: [] }))

jest.mock('@open-mercato/core/modules/auth/services/sidebarPreferencesService', () => ({
  // The merge itself is the subject of these tests — keep the real implementation.
  applySidebarPreference: jest.requireActual(
    '@open-mercato/core/modules/auth/services/sidebarPreferencesService',
  ).applySidebarPreference,
  loadFirstRoleSidebarPreference: (...args: unknown[]) => mockLoadFirstRoleSidebarPreference(...(args as [])),
  loadSidebarPreference: (...args: unknown[]) => mockLoadSidebarPreference(...(args as [])),
}))

import { SIDEBAR_PREFERENCES_VERSION } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { resolveBackendChromePayload } from '../backendChrome'

const HIDDEN_HREF = '/backend/catalog/products'
const VISIBLE_HREF = '/backend/customers/people'

// `serializeNavItem` derives the item id from its href, and `applySidebarPreference` resolves an
// item key as `id ?? href` — so `hiddenItems` entries are hrefs here.
function navEntries() {
  return [
    {
      href: HIDDEN_HREF,
      title: 'Products',
      defaultTitle: 'Products',
      groupId: 'catalog.nav.group',
      group: 'Catalog',
      groupDefaultName: 'Catalog',
      priority: 10,
    },
    {
      href: VISIBLE_HREF,
      title: 'People',
      defaultTitle: 'People',
      groupId: 'customers.nav.group',
      group: 'Customers',
      groupDefaultName: 'Customers',
      priority: 10,
    },
  ]
}

async function resolvePayload() {
  return resolveBackendChromePayload({
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null, roles: ['employee'] } as never,
    locale: 'en',
    modules: [],
    translate: (_key: string | undefined, fallback: string) => fallback,
  })
}

function findItem(payload: Awaited<ReturnType<typeof resolvePayload>>, href: string) {
  return payload.groups.flatMap((group) => group.items).find((item) => item.href === href)
}

const emptySettings = {
  version: SIDEBAR_PREFERENCES_VERSION,
  groupOrder: [],
  groupLabels: {},
  itemLabels: {},
  hiddenItems: [],
  itemOrder: {},
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEm.find.mockImplementation(async (entity: { name?: string }) =>
    entity?.name === 'Role' ? [{ id: 'role-1' }] : [],
  )
  mockRbacService.getEffectiveFeatures.mockResolvedValue(['*'])
  mockRbacService.userHasAllFeatures.mockResolvedValue(true)
  mockBuildAdminNav.mockResolvedValue(navEntries())
  mockLoadFirstRoleSidebarPreference.mockResolvedValue(null)
  mockLoadSidebarPreference.mockResolvedValue(null)
})

describe('backend chrome — role sidebar preference vs. a user with no saved layout', () => {
  it('keeps a role-hidden item hidden when the user has no saved preference', async () => {
    mockLoadFirstRoleSidebarPreference.mockResolvedValue({
      ...emptySettings,
      hiddenItems: [HIDDEN_HREF],
    })
    mockLoadSidebarPreference.mockResolvedValue(null)

    const payload = await resolvePayload()

    expect(findItem(payload, HIDDEN_HREF)?.hidden).toBe(true)
    expect(findItem(payload, VISIBLE_HREF)?.hidden).not.toBe(true)
  })

  it('keeps the role group order when the user has no saved preference', async () => {
    mockLoadFirstRoleSidebarPreference.mockResolvedValue({
      ...emptySettings,
      // Reversed against the shipped defaultGroupOrder, which ranks customers ahead of catalog.
      groupOrder: ['catalog.nav.group', 'customers.nav.group'],
    })
    mockLoadSidebarPreference.mockResolvedValue(null)

    const payload = await resolvePayload()

    expect(payload.groups.map((group) => group.id)).toEqual([
      'catalog.nav.group',
      'customers.nav.group',
    ])
  })

  it('lets a saved-but-empty user preference override the role layer', async () => {
    // The semantic distinction the null sentinel buys: an existing row means the user made a
    // choice, so their (empty) layout still wins. Whether role hides should instead be
    // un-overridable policy is a separate product question, tracked as a follow-up.
    mockLoadFirstRoleSidebarPreference.mockResolvedValue({
      ...emptySettings,
      hiddenItems: [HIDDEN_HREF],
    })
    mockLoadSidebarPreference.mockResolvedValue(emptySettings)

    const payload = await resolvePayload()

    expect(findItem(payload, HIDDEN_HREF)?.hidden).toBe(false)
  })
})
