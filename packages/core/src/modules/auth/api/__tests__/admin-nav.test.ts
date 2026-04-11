/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/auth/api/admin/nav'

type AuthContext = {
  sub: string
  tenantId: string | null
  orgId: string | null
  roles: string[]
  isApiKey?: boolean
  userId?: string
}

type TranslationContext = {
  locale: string
  translate: (key: string, fallback?: string) => string
}

type BackendRouteManifest = {
  moduleId: string
  pattern: string
  title: string
  pageTitleKey?: string
  pageGroupKey?: string
  group?: string
  order?: number
}

type DynamicEntity = {
  entityId: string
  label: string
}

type SidebarItem = {
  href: string
  title: string
  defaultTitle: string
  enabled: boolean
  hidden?: boolean
  children?: SidebarItem[]
}

type SidebarGroup = {
  id: string
  name: string
  defaultName: string
  items: SidebarItem[]
}

const mockGetAuthFromRequest = jest.fn<Promise<AuthContext | null>, [Request]>()
const mockGetBackendRouteManifests = jest.fn<BackendRouteManifest[], []>()
const mockResolveTranslations = jest.fn<Promise<TranslationContext>, []>()
const mockEmFind = jest.fn<Promise<unknown[]>, [unknown, unknown, unknown?]>()
const mockLoadAcl = jest.fn<Promise<{ isSuperAdmin: boolean; features: string[] }>, [string, { tenantId: string | null; organizationId: string | null }]>()
const mockUserHasAllFeatures = jest.fn<Promise<boolean>, [string, string[], { tenantId: string | null; organizationId: string | null }]>()
const mockCacheSet = jest.fn<Promise<void>, [string, unknown, { tags: string[] }]>()
const mockCacheGet = jest.fn<Promise<null>, [string]>()
const mockApplySidebarPreference = jest.fn(<T extends SidebarGroup>(groups: T[]) => groups)
const mockLoadSidebarPreference = jest.fn<Promise<null>, [unknown, { userId: string; tenantId: string | null; organizationId: string | null; locale: string }]>()
const mockLoadFirstRoleSidebarPreference = jest.fn<Promise<null>, [unknown, { roleIds: string[]; tenantId: string | null; locale: string }]>()
const mockResolveFeatureCheckContext = jest.fn<
  Promise<{ organizationId: string | null; scope: { tenantId: string | null }; allowedOrganizationIds: string[] | null }>,
  [unknown]
>()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (req: Request) => mockGetAuthFromRequest(req),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: () => mockResolveTranslations(),
}))

jest.mock('@open-mercato/shared/modules/registry', () => ({
  getBackendRouteManifests: () => mockGetBackendRouteManifests(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'em') {
        return { find: mockEmFind }
      }
      if (key === 'rbacService') {
        return { loadAcl: mockLoadAcl, userHasAllFeatures: mockUserHasAllFeatures }
      }
      if (key === 'cache') {
        return { get: mockCacheGet, set: mockCacheSet }
      }
      return null
    },
  }),
}))

jest.mock('@open-mercato/core/modules/auth/services/sidebarPreferencesService', () => ({
  applySidebarPreference: <T extends SidebarGroup>(groups: T[]) => mockApplySidebarPreference(groups),
  loadSidebarPreference: (em: unknown, scope: { userId: string; tenantId: string | null; organizationId: string | null; locale: string }) =>
    mockLoadSidebarPreference(em, scope),
  loadFirstRoleSidebarPreference: (em: unknown, scope: { roleIds: string[]; tenantId: string | null; locale: string }) =>
    mockLoadFirstRoleSidebarPreference(em, scope),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: (args: unknown) => mockResolveFeatureCheckContext(args),
}))

function makeRequest() {
  return new Request('http://localhost/api/auth/admin/nav', { method: 'GET' })
}

function setupRoutesForUserEntities(pageGroupKey: string, additionalRoutes: BackendRouteManifest[] = []): void {
  mockGetBackendRouteManifests.mockReturnValue([
    {
      moduleId: 'entities',
      pattern: '/backend/entities/user',
      title: 'User Entities',
      pageTitleKey: 'entities.nav.userEntities',
      pageGroupKey,
      group: 'Data Designer',
      order: 10,
    },
    ...additionalRoutes,
  ])
}

function setupCustomEntities(entities: DynamicEntity[]): void {
  mockEmFind.mockResolvedValueOnce(entities as unknown[])
}

async function getGroupsFromResponse(): Promise<SidebarGroup[]> {
  const response = await GET(makeRequest())
  expect(response.status).toBe(200)
  const payload = (await response.json()) as { groups: SidebarGroup[] }
  return payload.groups
}

function findUserEntitiesItem(groups: SidebarGroup[]): SidebarItem | undefined {
  for (const group of groups) {
    const item = group.items.find((candidate) => candidate.href === '/backend/entities/user')
    if (item) return item
  }
  return undefined
}

describe('GET /api/auth/admin/nav', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      roles: [],
    })
    mockResolveTranslations.mockResolvedValue({
      locale: 'pl',
      translate: (_key: string, fallback?: string) => fallback ?? '',
    })
    mockLoadAcl.mockResolvedValue({
      isSuperAdmin: true,
      features: [],
    })
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockLoadSidebarPreference.mockResolvedValue(null)
    mockLoadFirstRoleSidebarPreference.mockResolvedValue(null)
    mockCacheGet.mockResolvedValue(null)
    mockCacheSet.mockResolvedValue(undefined)
    mockResolveFeatureCheckContext.mockResolvedValue({
      organizationId: 'org-1',
      scope: { tenantId: 'tenant-1' },
      allowedOrganizationIds: ['org-1'],
    })
  })

  it('attaches dynamic user entity links for the new data-designer group layout', async () => {
    setupRoutesForUserEntities('settings.sections.dataDesigner')
    setupCustomEntities([{ entityId: 'contacts', label: 'Contacts' }])

    const groups = await getGroupsFromResponse()
    const anchor = findUserEntitiesItem(groups)

    expect(anchor).toBeDefined()
    expect(anchor?.children?.map((item) => item.href)).toContain('/backend/entities/user/contacts/records')
  })

  it('keeps legacy compatibility for entities.nav.group', async () => {
    setupRoutesForUserEntities('entities.nav.group')
    setupCustomEntities([{ entityId: 'accounts', label: 'Accounts' }])

    const groups = await getGroupsFromResponse()
    const anchor = findUserEntitiesItem(groups)

    expect(anchor).toBeDefined()
    expect(anchor?.children?.map((item) => item.href)).toContain('/backend/entities/user/accounts/records')
  })

  it('does not duplicate dynamic links when the same href already exists', async () => {
    setupRoutesForUserEntities('settings.sections.dataDesigner', [
      {
        moduleId: 'entities',
        pattern: '/backend/entities/user/orders/records',
        title: 'Orders Existing Link',
        pageGroupKey: 'settings.sections.dataDesigner',
        group: 'Data Designer',
        order: 11,
      },
    ])
    setupCustomEntities([{ entityId: 'orders', label: 'Orders Dynamic Link' }])

    const groups = await getGroupsFromResponse()
    const anchor = findUserEntitiesItem(groups)
    const matchingChildren = anchor?.children?.filter((item) => item.href === '/backend/entities/user/orders/records') ?? []

    expect(anchor).toBeDefined()
    expect(matchingChildren).toHaveLength(1)
  })

  it('returns navigation without throwing when the user entities anchor is missing', async () => {
    mockGetBackendRouteManifests.mockReturnValue([
      {
        moduleId: 'dashboard',
        pattern: '/backend/dashboard',
        title: 'Dashboard',
        group: 'Dashboard',
        order: 1,
      },
    ])
    setupCustomEntities([{ entityId: 'assets', label: 'Assets' }])

    const groups = await getGroupsFromResponse()
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href))

    expect(hrefs).toContain('/backend/dashboard')
    expect(hrefs).not.toContain('/backend/entities/user/assets/records')
  })

  it('includes wildcard-granted customer portal settings routes', async () => {
    mockLoadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['customer_accounts.*'],
    })
    mockGetBackendRouteManifests.mockReturnValue([
      {
        moduleId: 'customer_accounts',
        pattern: '/backend/customer_accounts/users',
        title: 'Users',
        pageGroupKey: 'customer_accounts.settings.section',
        group: 'Customer Portal',
        order: 1,
        requireFeatures: ['customer_accounts.view'],
      } as BackendRouteManifest & { requireFeatures: string[] },
    ])
    setupCustomEntities([])

    const groups = await getGroupsFromResponse()
    const customerPortalGroup = groups.find((group) => group.id === 'customer_accounts.settings.section')

    expect(customerPortalGroup?.items.map((item) => item.href)).toContain('/backend/customer_accounts/users')
  })

  it('builds grouped navigation from backend route manifests instead of full module registry', async () => {
    mockGetBackendRouteManifests.mockReturnValue([
      {
        moduleId: 'dashboard',
        pattern: '/backend/dashboard',
        title: 'Dashboard',
        group: 'Dashboard',
        order: 1,
      },
    ])
    setupCustomEntities([])

    const groups = await getGroupsFromResponse()

    expect(groups.find((group) => group.id === 'Dashboard')?.items.map((item) => item.href)).toContain('/backend/dashboard')
  })

  it('returns the extended backend chrome payload fields for client hydration', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['customer_accounts.*', 'auth.*'],
    })
    mockGetBackendRouteManifests.mockReturnValue([
      {
        moduleId: 'auth',
        pattern: '/backend/settings/auth/users',
        title: 'Users',
        pageGroupKey: 'auth.settings.section',
        group: 'Auth',
        order: 1,
        pageContext: 'settings',
      } as BackendRouteManifest & { pageContext: 'settings' },
    ])
    setupCustomEntities([])

    const response = await GET(makeRequest())
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      settingsSections: Array<{ id: string; items: Array<{ href: string }> }>
      settingsPathPrefixes: string[]
      profileSections: Array<{ id: string }>
      profilePathPrefixes: string[]
      grantedFeatures: string[]
      roles: string[]
    }

    expect(payload.settingsSections[0]?.items.map((item) => item.href)).toContain('/backend/settings/auth/users')
    expect(payload.settingsPathPrefixes).toContain('/backend/settings/auth')
    expect(payload.profileSections.length).toBeGreaterThan(0)
    expect(payload.profilePathPrefixes).toContain('/backend/profile/')
    expect(payload.grantedFeatures).toEqual(expect.arrayContaining(['customer_accounts.*', 'auth.*']))
    expect(payload.roles).toEqual(['admin'])
  })

  it('passes the request through every scope resolution during hydrated nav generation', async () => {
    mockGetBackendRouteManifests.mockReturnValue([
      {
        moduleId: 'dashboard',
        pattern: '/backend/dashboard',
        title: 'Dashboard',
        group: 'Dashboard',
        order: 1,
      },
    ])
    setupCustomEntities([])

    const request = makeRequest()
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mockResolveFeatureCheckContext).toHaveBeenCalledTimes(2)
    for (const [callArgs] of mockResolveFeatureCheckContext.mock.calls) {
      expect(callArgs).toEqual(expect.objectContaining({ request }))
    }
  })

  it('uses per-feature RBAC checks for sidebar inclusion, not only the raw ACL snapshot', async () => {
    mockLoadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: [],
    })
    mockUserHasAllFeatures.mockImplementation(async (_userId, required) => {
      return required.every((feature) => feature === 'customer_accounts.view')
    })
    mockGetBackendRouteManifests.mockReturnValue([
      {
        moduleId: 'customer_accounts',
        pattern: '/backend/customer_accounts/users',
        title: 'Users',
        pageGroupKey: 'customer_accounts.settings.section',
        group: 'Customer Portal',
        order: 1,
        requireFeatures: ['customer_accounts.view'],
      } as BackendRouteManifest & { requireFeatures: string[] },
    ])
    setupCustomEntities([])

    const groups = await getGroupsFromResponse()
    const customerPortalGroup = groups.find((group) => group.id === 'customer_accounts.settings.section')

    expect(customerPortalGroup?.items.map((item) => item.href)).toContain('/backend/customer_accounts/users')
    expect(mockUserHasAllFeatures).toHaveBeenCalled()
  })
})
