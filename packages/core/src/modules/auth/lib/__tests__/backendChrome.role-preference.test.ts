/** @jest-environment node */

// The sidebar is a two-layer merge: role preference over the base nav, then `adoptSidebarDefaults`
// bakes the role-applied state as the new defaults, then the user preference over that.
// `applySidebarPreference` OVERWRITES `hidden` (`next.hidden = hidden`) instead of OR-ing it, and
// falls back to weight/name ordering when `groupOrder` is empty — so running the user pass with an
// empty settings object erases the whole role layer. That is exactly what happened while the user
// preference loader returned normalized defaults instead of `null` for a user with no saved row:
// the `userPreference ? ... : baseForUser` guard could never take its else-branch.
//
// These tests keep the REAL `applySidebarPreference` AND the REAL `findSidebarPreference`, and
// drive the latter by stubbing the `UserSidebarPreference` row it reads. Stubbing the loader
// itself would leave the loader untested here, so a regression in either the merge or the
// absent-row sentinel fails this suite.

const mockLoadFirstRoleSidebarPreference = jest.fn()

jest.mock('@open-mercato/shared/modules/overrides', () => ({
  getNavGroupOrderOverride: () => null,
}))

// The only two entities read through this helper on the chrome path are `UserSidebarPreference`
// (from the real loader) and `Organization` (current-organization lookup), so dispatch on name.
const userSidebarPreferenceRow: { current: { id: string; settingsJson: unknown } | null } = {
  current: null,
}
const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: { name?: string }) =>
  entity?.name === 'UserSidebarPreference' ? userSidebarPreferenceRow.current : null,
)
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
  // The merge and the user-preference loader are both subjects of these tests — keep the real
  // implementations and stub only the role loader.
  applySidebarPreference: jest.requireActual(
    '@open-mercato/core/modules/auth/services/sidebarPreferencesService',
  ).applySidebarPreference,
  findSidebarPreference: jest.requireActual(
    '@open-mercato/core/modules/auth/services/sidebarPreferencesService',
  ).findSidebarPreference,
  loadFirstRoleSidebarPreference: (...args: unknown[]) => mockLoadFirstRoleSidebarPreference(...(args as [])),
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
  userSidebarPreferenceRow.current = null
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: { name?: string }) =>
    entity?.name === 'UserSidebarPreference' ? userSidebarPreferenceRow.current : null,
  )
})

describe('backend chrome — role sidebar preference vs. a user with no saved layout', () => {
  it('keeps a role-hidden item hidden when the user has no saved preference', async () => {
    mockLoadFirstRoleSidebarPreference.mockResolvedValue({
      ...emptySettings,
      hiddenItems: [HIDDEN_HREF],
    })
    userSidebarPreferenceRow.current = null

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
    userSidebarPreferenceRow.current = null

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
    // A row that exists but holds no customization — the real loader must return it as
    // non-null settings, which is what makes the user pass run and override the role layer.
    userSidebarPreferenceRow.current = { id: 'pref-1', settingsJson: {} }

    const payload = await resolvePayload()

    expect(findItem(payload, HIDDEN_HREF)?.hidden).toBe(false)
  })
})
