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

type BackendRoute = {
  pattern: string
  title: string
  pageTitleKey?: string
  pageGroupKey?: string
  group?: string
  order?: number
}

type ModuleDefinition = {
  id: string
  backendRoutes: BackendRoute[]
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
const mockGetModules = jest.fn<ModuleDefinition[], []>()
const mockResolveTranslations = jest.fn<Promise<TranslationContext>, []>()
const mockEmFind = jest.fn<Promise<unknown[]>, [unknown, unknown, unknown?]>()
const mockLoadAcl = jest.fn<Promise<{ isSuperAdmin: boolean; features: string[] }>, [string, { tenantId: string | null; organizationId: string | null }]>()
const mockCacheSet = jest.fn<Promise<void>, [string, unknown, { tags: string[] }]>()
const mockCacheGet = jest.fn<Promise<null>, [string]>()
const mockApplySidebarPreference = jest.fn(<T extends SidebarGroup>(groups: T[]) => groups)
const mockLoadSidebarPreference = jest.fn<Promise<null>, [unknown, { userId: string; tenantId: string | null; organizationId: string | null; locale: string }]>()
const mockLoadFirstRoleSidebarPreference = jest.fn<Promise<null>, [unknown, { roleIds: string[]; tenantId: string | null; locale: string }]>()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (req: Request) => mockGetAuthFromRequest(req),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  getModules: () => mockGetModules(),
  resolveTranslations: () => mockResolveTranslations(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'em') {
        return { find: mockEmFind }
      }
      if (key === 'rbacService') {
        return { loadAcl: mockLoadAcl }
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

function makeRequest() {
  return new Request('http://localhost/api/auth/admin/nav', { method: 'GET' })
}

function setupModulesForUserEntities(pageGroupKey: string, additionalRoutes: BackendRoute[] = []): void {
  mockGetModules.mockReturnValue([
    {
      id: 'entities',
      backendRoutes: [
        {
          pattern: '/backend/entities/user',
          title: 'User Entities',
          pageTitleKey: 'entities.nav.userEntities',
          pageGroupKey,
          group: 'Data Designer',
          order: 10,
        },
        ...additionalRoutes,
      ],
    },
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
    mockLoadSidebarPreference.mockResolvedValue(null)
    mockLoadFirstRoleSidebarPreference.mockResolvedValue(null)
    mockCacheGet.mockResolvedValue(null)
    mockCacheSet.mockResolvedValue(undefined)
  })

  it('attaches dynamic user entity links for the new data-designer group layout', async () => {
    setupModulesForUserEntities('settings.sections.dataDesigner')
    setupCustomEntities([{ entityId: 'contacts', label: 'Contacts' }])

    const groups = await getGroupsFromResponse()
    const anchor = findUserEntitiesItem(groups)

    expect(anchor).toBeDefined()
    expect(anchor?.children?.map((item) => item.href)).toContain('/backend/entities/user/contacts/records')
  })

  it('keeps legacy compatibility for entities.nav.group', async () => {
    setupModulesForUserEntities('entities.nav.group')
    setupCustomEntities([{ entityId: 'accounts', label: 'Accounts' }])

    const groups = await getGroupsFromResponse()
    const anchor = findUserEntitiesItem(groups)

    expect(anchor).toBeDefined()
    expect(anchor?.children?.map((item) => item.href)).toContain('/backend/entities/user/accounts/records')
  })

  it('does not duplicate dynamic links when the same href already exists', async () => {
    setupModulesForUserEntities('settings.sections.dataDesigner', [
      {
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
    mockGetModules.mockReturnValue([
      {
        id: 'dashboard',
        backendRoutes: [
          {
            pattern: '/backend/dashboard',
            title: 'Dashboard',
            group: 'Dashboard',
            order: 1,
          },
        ],
      },
    ])
    setupCustomEntities([{ entityId: 'assets', label: 'Assets' }])

    const groups = await getGroupsFromResponse()
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href))

    expect(hrefs).toContain('/backend/dashboard')
    expect(hrefs).not.toContain('/backend/entities/user/assets/records')
  })
})
