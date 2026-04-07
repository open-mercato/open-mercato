/** @jest-environment node */
import { GET } from '../definitions'

const installCustomEntitiesFromModulesMock = jest.fn(async () => ({
  processed: 1,
  synchronized: 1,
  skipped: 0,
  fieldChanges: 1,
}))

const loadEntityFieldsetConfigsMock = jest.fn(async () => new Map())
const mockRbac = { userHasAllFeatures: jest.fn() }

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
}

const mockCache = {
  get: jest.fn(async () => null),
  set: jest.fn(async () => undefined),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      if (key === 'cache') return mockCache
      if (key === 'rbacService') return mockRbac
      return null
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', roles: ['admin'] }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ tenantId: 'tenant-1', selectedId: 'org-1' }),
}))

jest.mock('../../lib/fieldsets', () => ({
  loadEntityFieldsetConfigs: (...args: unknown[]) => loadEntityFieldsetConfigsMock(...args),
  CustomFieldsetDefinition: class {},
}))

jest.mock('../../lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: (...args: unknown[]) => installCustomEntitiesFromModulesMock(...args),
}))

describe('entities/definitions API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.find.mockResolvedValue([])
    mockEm.findOne.mockResolvedValue(null)
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
  })

  it('synchronizes module-backed definitions for requested entities when the caller can manage definitions', async () => {
    const response = await GET(
      new Request('http://x/api/entities/definitions?entityId=customers:customer_interaction'),
    )

    expect(response.status).toBe(200)
    expect(installCustomEntitiesFromModulesMock).toHaveBeenCalledWith(
      mockEm,
      mockCache,
      expect.objectContaining({
        tenantIds: ['tenant-1'],
        entityIds: ['customers:customer_interaction'],
        includeGlobal: true,
        createOnly: true,
      }),
    )
  })

  it('does not synchronize module-backed definitions for callers without manage permission', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    const response = await GET(
      new Request('http://x/api/entities/definitions?entityId=customers:customer_interaction'),
    )

    expect(response.status).toBe(200)
    expect(installCustomEntitiesFromModulesMock).not.toHaveBeenCalled()
  })
})
