import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import { Role, RoleAcl, UserRole } from '../../data/entities'
import { DefaultAuthPrincipalService } from '../principalService'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const mockedFindOne = findOneWithDecryption as jest.Mock
const mockedFind = findWithDecryption as jest.Mock
const recordedQueries: CompiledQuery[] = []

function createRecordingKysely(): Kysely<any> {
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
  ;(db.getExecutor() as any).executeQuery = async (query: CompiledQuery) => {
    recordedQueries.push(query)
    if (query.sql.toLowerCase().includes('count(*)')) return { rows: [{ count: '1000' }] }
    return { rows: [{ id: 'role-eligible', name: 'Eligible role' }] }
  }
  return db
}

describe('DefaultAuthPrincipalService organization-scoped roles', () => {
  const scope = { tenantId: 'tenant-1', organizationId: 'org-2' }
  const roleA = { id: 'role-a', tenantId: scope.tenantId, name: 'Organization A', deletedAt: null }
  const roleB = { id: 'role-b', tenantId: scope.tenantId, name: 'Organization B', deletedAt: null }
  const roleWithoutAcl = { id: 'role-without-acl', tenantId: scope.tenantId, name: 'Explicit share', deletedAt: null }
  const mockEm = {}
  const organizationHierarchyService = { resolveAncestorIds: jest.fn() }
  const createService = () => new DefaultAuthPrincipalService(
    mockEm as never,
    organizationHierarchyService,
  )

  beforeEach(() => {
    jest.clearAllMocks()
    recordedQueries.length = 0
    organizationHierarchyService.resolveAncestorIds.mockResolvedValue([])
    mockedFindOne.mockResolvedValue(null)
    mockedFind.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, any>) => {
      if (entity === UserRole) {
        return [{ role: roleA }, { role: roleB }]
      }
      if (entity === Role) {
        const requested = Array.isArray(where?.id?.$in) ? where.id.$in : []
        return [roleA, roleB, roleWithoutAcl].filter((role) => requested.includes(role.id))
      }
      if (entity === RoleAcl) {
        return [
          { role: roleA, tenantId: scope.tenantId, organizationsJson: ['org-1'], deletedAt: null },
          { role: roleB, tenantId: scope.tenantId, organizationsJson: ['org-2'], deletedAt: null },
        ]
      }
      return []
    })
  })

  it('projects only human-user roles whose ACL applies to the selected organization', async () => {
    const service = createService()

    await expect(service.resolveActiveUserRoleIds('user-1', scope)).resolves.toEqual(['role-b'])
  })

  it('filters tenant-scoped API-key role assignments by the same organization rule', async () => {
    const service = createService()

    await expect(service.filterActiveRoleIds(['role-a', 'role-b'], scope)).resolves.toEqual(['role-b'])
  })

  it('keeps an active tenant role without a RoleAcl eligible for an explicit share', async () => {
    const service = createService()

    await expect(service.filterActiveRoleIds([roleWithoutAcl.id], scope)).resolves.toEqual([roleWithoutAcl.id])
    await expect(service.principalExists({ type: 'role', id: roleWithoutAcl.id, scope })).resolves.toBe(true)
  })

  it('rejects and omits out-of-organization role share principals', async () => {
    const service = createService()

    await expect(service.principalExists({ type: 'role', id: 'role-a', scope })).resolves.toBe(false)
    await expect(service.principalExists({ type: 'role', id: 'role-b', scope })).resolves.toBe(true)
    await expect(service.resolveLabels({ type: 'role', ids: ['role-a', 'role-b'], scope })).resolves.toEqual([
      { id: 'role-b', label: 'Organization B', secondary: null },
    ])
  })

  it('never treats a deny-all role as a share principal, even for a user who reaches the organization through another role (#4033)', async () => {
    const denyAllRole = {
      id: 'role-deny-all',
      tenantId: scope.tenantId,
      name: 'Deny-all scope',
      deletedAt: null,
    }
    mockedFind.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, any>) => {
      if (entity === UserRole) {
        // The user reaches org-2 through roleB while also holding the deny-all role.
        return [{ role: denyAllRole }, { role: roleB }]
      }
      if (entity === Role) {
        const requested = Array.isArray(where?.id?.$in) ? where.id.$in : []
        return [denyAllRole, roleB].filter((role) => requested.includes(role.id))
      }
      if (entity === RoleAcl) {
        return [
          { role: denyAllRole, tenantId: scope.tenantId, organizationsJson: [], deletedAt: null },
          { role: roleB, tenantId: scope.tenantId, organizationsJson: ['org-2'], deletedAt: null },
        ]
      }
      return []
    })
    const service = createService()

    // An empty allowlist grants no organization reach, so the role must not be resolvable into a
    // share target — otherwise a document shared with it would leak through the second role.
    await expect(service.resolveActiveUserRoleIds('user-1', scope)).resolves.toEqual(['role-b'])
    await expect(service.filterActiveRoleIds([denyAllRole.id, roleB.id], scope)).resolves.toEqual([roleB.id])
    await expect(service.principalExists({ type: 'role', id: denyAllRole.id, scope })).resolves.toBe(false)
    await expect(service.resolveLabels({ type: 'role', ids: [denyAllRole.id, roleB.id], scope })).resolves.toEqual([
      { id: 'role-b', label: 'Organization B', secondary: null },
    ])
  })

  it('accepts a parent-scoped role for a selected descendant organization', async () => {
    const parentRole = {
      id: 'role-parent',
      tenantId: scope.tenantId,
      name: 'Parent organization',
      deletedAt: null,
    }
    organizationHierarchyService.resolveAncestorIds.mockResolvedValue(['org-parent'])
    mockedFind.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === UserRole) return [{ role: parentRole }]
      if (entity === Role) return [parentRole]
      if (entity === RoleAcl) {
        return [{
          role: parentRole,
          tenantId: scope.tenantId,
          organizationsJson: ['org-parent'],
          deletedAt: null,
        }]
      }
      return []
    })
    const service = createService()

    await expect(service.resolveActiveUserRoleIds('user-1', scope)).resolves.toEqual([parentRole.id])
    await expect(service.filterActiveRoleIds([parentRole.id], scope)).resolves.toEqual([parentRole.id])
    await expect(service.principalExists({ type: 'role', id: parentRole.id, scope })).resolves.toBe(true)
  })

  it('fails closed for a restricted role when the selected organization is invalid', async () => {
    organizationHierarchyService.resolveAncestorIds.mockResolvedValue(null)
    const service = createService()

    await expect(service.filterActiveRoleIds([roleB.id], scope)).resolves.toEqual([])
  })

  it('keeps exact-organization grants without requiring the Directory hierarchy seam', async () => {
    const service = new DefaultAuthPrincipalService(mockEm as never)

    await expect(service.filterActiveRoleIds(['role-a', 'role-b'], scope)).resolves.toEqual(['role-b'])
  })

  it('filters role eligibility before one bounded database page instead of scanning sparse candidates', async () => {
    organizationHierarchyService.resolveAncestorIds.mockResolvedValue(['org-parent'])
    const service = new DefaultAuthPrincipalService(
      { getKysely: () => createRecordingKysely() } as never,
      organizationHierarchyService,
    )

    await expect(service.queryActiveRolePage({
      scope,
      search: 'Sales_%',
      excludedIds: ['role-existing'],
      page: 2,
      pageSize: 20,
    })).resolves.toEqual({
      items: [{ id: 'role-eligible', label: 'Eligible role', secondary: null }],
      page: 2,
      pageSize: 20,
      total: 1000,
    })

    expect(recordedQueries).toHaveLength(2)
    const countQuery = recordedQueries.find((query) => query.sql.toLowerCase().includes('count(*)'))
    const pageQuery = recordedQueries.find((query) => !query.sql.toLowerCase().includes('count(*)'))
    expect(countQuery?.sql).toMatch(/from \(select "r"\."id" from "roles" as "r"[\s\S]+limit \$\d+\) as "bounded_roles"/)
    expect(countQuery?.parameters).toContain(1000)
    expect(pageQuery?.sql).toContain('not exists')
    expect(pageQuery?.sql).toContain('from role_acls as ra_any')
    expect(pageQuery?.sql).toContain('from role_acls as ra')
    expect(pageQuery?.sql).not.toContain('jsonb_array_length(ra.organizations_json) = 0')
    expect(pageQuery?.sql).toContain('order by "r"."id" asc')
    expect(pageQuery?.parameters).toEqual(expect.arrayContaining([
      scope.tenantId,
      JSON.stringify(['__all__']),
      JSON.stringify([scope.organizationId]),
      JSON.stringify(['org-parent']),
      '%Sales\\_\\%%',
      'role-existing',
      20,
      20,
    ]))
  })
})
