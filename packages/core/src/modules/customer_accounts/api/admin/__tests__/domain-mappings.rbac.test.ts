import type { EntityManager } from '@mikro-orm/postgresql'
import { User, UserRole, RoleAcl, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { DomainMapping } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import {
  applyAclFeatureOverrides,
  resetModuleContractOverridesForTests,
} from '@open-mercato/shared/modules/overrides'
import { GET, POST, DELETE } from '../domain-mappings'
import { POST as verify } from '../domain-mappings/[id]/verify'
import { POST as healthCheck } from '../domain-mappings/[id]/health-check'

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const ORGANIZATION_A = '10000000-0000-4000-8000-000000000002'
const ORGANIZATION_B = '10000000-0000-4000-8000-000000000003'
const USER_ID = '10000000-0000-4000-8000-000000000004'
const MAPPING_A = '10000000-0000-4000-8000-000000000005'
const MAPPING_B = '10000000-0000-4000-8000-000000000006'
const FEATURE = 'customer_accounts.domain.manage'
const BASE_URL = 'http://localhost/api/customer_accounts/admin/domain-mappings'

type RoleGrant = {
  role: { id: string }
  tenantId: string
  isSuperAdmin: boolean
  featuresJson: string[]
  organizationsJson: string[]
}

type Operation = 'create' | 'delete' | 'verify' | 'health-check'

const mockAuth = jest.fn()
const mockGuard = jest.fn()
const mockAfterSuccess = jest.fn()
const mockEm = {
  fork: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
}
const mockDomainService = {
  findById: jest.fn(),
  register: jest.fn(),
  remove: jest.fn(),
  verify: jest.fn(),
  healthCheck: jest.fn(),
}
let mockRbac: RbacService

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (request: Request) => mockAuth(request),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'em') return mockEm
      if (name === 'rbacService') return mockRbac
      if (name === 'domainMappingService') return mockDomainService
      throw new Error(`[internal] Unexpected service ${name}`)
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (
    em: { find: (...args: unknown[]) => Promise<unknown> },
    entity: unknown,
    where: unknown,
    options: unknown,
  ) => em.find(entity, where, options),
  findOneWithDecryption: (
    em: { findOne: (...args: unknown[]) => Promise<unknown> },
    entity: unknown,
    where: unknown,
    options: unknown,
  ) => em.findOne(entity, where, options),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => mockGuard(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => mockAfterSuccess(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/services/domainMappingService', () => ({
  DomainMappingOrgScopeError: class extends Error {},
}))

function createMapping(id: string, organizationId: string): DomainMapping {
  return Object.assign(new DomainMapping(), {
    id,
    organizationId,
    tenantId: TENANT_ID,
    hostname: `${id}.example.com`,
    createdAt: new Date('2026-10-29T00:00:00.000Z'),
    updatedAt: new Date('2026-10-29T00:00:00.000Z'),
  })
}

function matchesOrganization(value: unknown, organizationId: string): boolean {
  if (value === undefined) return true
  if (typeof value === 'string') return value === organizationId
  if (value && typeof value === 'object' && '$in' in value && Array.isArray(value.$in)) {
    return value.$in.includes(organizationId)
  }
  return false
}

async function invokeOperation(operation: Operation, organizationId: string, mappingId: string) {
  if (operation === 'create') {
    return POST(new Request(BASE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname: 'new.example.com', organizationId }),
    }))
  }
  if (operation === 'delete') return DELETE(new Request(`${BASE_URL}?id=${mappingId}`, { method: 'DELETE' }))
  const request = new Request(`${BASE_URL}/${mappingId}/${operation}`, { method: 'POST' })
  const context = { params: Promise.resolve({ id: mappingId }) }
  return operation === 'verify' ? verify(request, context) : healthCheck(request, context)
}

describe('custom-domain routes with real organization-scoped RBAC', () => {
  let grants: RoleGrant[]
  let mappings: DomainMapping[]
  let organizations: Array<{ id: string; ancestorIds: string[] }>

  beforeEach(() => {
    jest.clearAllMocks()
    resetModuleContractOverridesForTests()
    registerModules([{
      id: 'customer_accounts',
      features: [{ id: FEATURE, title: 'Manage custom domains', module: 'customer_accounts' }],
    }])
    grants = [
      {
        role: { id: 'domain-manager-a' },
        tenantId: TENANT_ID,
        isSuperAdmin: false,
        featuresJson: ['customer_accounts.*'],
        organizationsJson: [ORGANIZATION_A],
      },
      {
        role: { id: 'viewer-b' },
        tenantId: TENANT_ID,
        isSuperAdmin: false,
        featuresJson: ['customer_accounts.view'],
        organizationsJson: [ORGANIZATION_B],
      },
    ]
    mappings = [createMapping(MAPPING_A, ORGANIZATION_A), createMapping(MAPPING_B, ORGANIZATION_B)]
    organizations = [ORGANIZATION_A, ORGANIZATION_B].map((id) => ({ id, ancestorIds: [] }))
    mockAuth.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_A })
    mockGuard.mockResolvedValue(null)
    mockAfterSuccess.mockResolvedValue(undefined)
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.findOne.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === User) return { id: USER_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_A }
      if (entity === UserAcl) return null
      if (entity === Organization) {
        return organizations.find((organization) => organization.id === where.id) ?? null
      }
      return null
    })
    mockEm.find.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === UserRole) return grants.map((grant) => ({ role: grant.role }))
      if (entity === RoleAcl) return grants.filter((grant) => where.isSuperAdmin !== true || grant.isSuperAdmin)
      if (entity === Organization) {
        return where.tenant === TENANT_ID && where.deletedAt === null ? organizations : []
      }
      if (entity === DomainMapping) {
        return mappings.filter((mapping) => (
          mapping.tenantId === where.tenantId
          && matchesOrganization(where.organizationId, mapping.organizationId)
        ))
      }
      return []
    })
    mockRbac = new RbacService(mockEm as unknown as EntityManager)
    mockDomainService.findById.mockImplementation(async (id: string, scope: { tenantId: string }) => (
      mappings.find((mapping) => mapping.id === id && mapping.tenantId === scope.tenantId) ?? null
    ))
    mockDomainService.register.mockImplementation(async (input: { organizationId: string }) => (
      createMapping('10000000-0000-4000-8000-000000000007', input.organizationId)
    ))
    mockDomainService.remove.mockResolvedValue(undefined)
    mockDomainService.verify.mockImplementation(async (id: string) => ({
      domainMapping: mappings.find((mapping) => mapping.id === id),
    }))
    mockDomainService.healthCheck.mockImplementation(async (id: string) => (
      mappings.find((mapping) => mapping.id === id)
    ))
  })

  afterEach(() => {
    resetModuleContractOverridesForTests()
    registerModules([])
  })

  it('filters list results by the feature grant rather than the union of visible organizations', async () => {
    const acl = await mockRbac.loadAcl(USER_ID, { tenantId: TENANT_ID, organizationId: ORGANIZATION_A })
    expect(acl.organizations).toEqual(expect.arrayContaining([ORGANIZATION_A, ORGANIZATION_B]))
    const featureCheck = jest.spyOn(mockRbac, 'userHasAllFeatures')
    const organizationAccess = jest.spyOn(mockRbac, 'resolveFeatureOrganizationAccess')
    const response = await GET(new Request(BASE_URL))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ domainMappings: [{ id: MAPPING_A, organizationId: ORGANIZATION_A }] })
    expect(organizationAccess).toHaveBeenCalledTimes(1)
    expect(featureCheck).toHaveBeenCalledTimes(1)
    expect(mockEm.find).toHaveBeenCalledWith(
      Organization,
      { tenant: TENANT_ID, deletedAt: null },
      { fields: ['id', 'ancestorIds'] },
    )
    expect(mockEm.find).toHaveBeenCalledWith(
      DomainMapping,
      { tenantId: TENANT_ID, organizationId: { $in: [ORGANIZATION_A] } },
      { orderBy: { createdAt: 'desc' } },
    )
  })

  it('includes descendant mappings inherited from an organization-scoped role grant', async () => {
    const childOrganizationId = '10000000-0000-4000-8000-000000000008'
    const childMappingId = '10000000-0000-4000-8000-000000000009'
    organizations.push({ id: childOrganizationId, ancestorIds: [ORGANIZATION_A] })
    mappings.push(createMapping(childMappingId, childOrganizationId))

    const response = await GET(new Request(BASE_URL))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      domainMappings: [{ id: MAPPING_A }, { id: childMappingId }],
    })
    expect(mockEm.find).toHaveBeenCalledWith(
      DomainMapping,
      { tenantId: TENANT_ID, organizationId: { $in: [ORGANIZATION_A, childOrganizationId] } },
      { orderBy: { createdAt: 'desc' } },
    )
  })

  it('keeps all tenant mappings available to an unrestricted organization grant', async () => {
    grants[0].organizationsJson = ['__all__']

    const response = await GET(new Request(BASE_URL))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ domainMappings: [{ id: MAPPING_A }, { id: MAPPING_B }] })
    expect(mockEm.find).not.toHaveBeenCalledWith(Organization, expect.anything(), expect.anything())
    expect(mockEm.find).toHaveBeenCalledWith(
      DomainMapping,
      { tenantId: TENANT_ID },
      { orderBy: { createdAt: 'desc' } },
    )
  })

  it('rejects an explicit organization filter without a domain-management grant', async () => {
    const response = await GET(new Request(`${BASE_URL}?organizationId=${ORGANIZATION_B}`))
    expect(response.status).toBe(403)
    expect(mockEm.find).not.toHaveBeenCalledWith(DomainMapping, expect.anything(), expect.anything())
  })

  it.each<Operation>(['create', 'delete', 'verify', 'health-check'])('denies %s before side effects in organization B', async (operation) => {
    const response = await invokeOperation(operation, ORGANIZATION_B, MAPPING_B)
    expect(response.status).toBe(403)
    expect(mockGuard).not.toHaveBeenCalled()
    expect(mockDomainService.register).not.toHaveBeenCalled()
    expect(mockDomainService.remove).not.toHaveBeenCalled()
    expect(mockDomainService.verify).not.toHaveBeenCalled()
    expect(mockDomainService.healthCheck).not.toHaveBeenCalled()
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })

  it.each<Operation>(['create', 'delete', 'verify', 'health-check'])('allows %s through a wildcard grant in organization A', async (operation) => {
    const response = await invokeOperation(operation, ORGANIZATION_A, MAPPING_A)
    expect(response.status).toBe(operation === 'create' ? 201 : 200)
    expect(mockGuard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: ORGANIZATION_A }))
  })

  it('keeps a global feature wildcard confined to its role organization', async () => {
    grants[0].featuresJson = ['*']
    const response = await GET(new Request(BASE_URL))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ domainMappings: [{ id: MAPPING_A }] })
    expect((await invokeOperation('delete', ORGANIZATION_B, MAPPING_B)).status).toBe(403)
  })

  it('honors a removed feature even when a matching wildcard grant exists', async () => {
    applyAclFeatureOverrides({ [FEATURE]: null })
    const response = await invokeOperation('create', ORGANIZATION_A, MAPPING_A)
    expect(response.status).toBe(403)
    expect(mockDomainService.register).not.toHaveBeenCalled()
    expect(mockGuard).not.toHaveBeenCalled()
  })
})
