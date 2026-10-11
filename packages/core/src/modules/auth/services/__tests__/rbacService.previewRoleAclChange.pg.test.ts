/**
 * Parity of `RbacService.previewRoleAclChange` with `loadAclWithEntityManager` on a real
 * PostgreSQL through MikroORM (relation filters, `$in`, populate, json columns), over seeded
 * scenarios with wildcards, organization allowlists (`null`, `[]`, `__all__`, parents), per-user
 * ACLs, super administrators and API keys: the preview's "before" equals what the loader grants now,
 * its "after" equals what the loader grants once the proposal is saved. Gated on
 * OM_INSIGHTS_SIMULATION_PG_URL (the change simulator's throwaway database): the suite creates its
 * own uniquely named schema and drops it afterwards.
 *
 *   OM_INSIGHTS_SIMULATION_PG_URL=postgres://postgres:postgres@localhost:55432/om_simulator \
 *     npx jest --config jest.config.cjs src/modules/auth/services/__tests__/rbacService.previewRoleAclChange.pg.test.ts --runInBand
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { Pool } from 'pg'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import { resolveEffectiveFeatures } from '@open-mercato/shared/security/featurePolicy'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { listSuperAdminUserIds } from '@open-mercato/core/modules/auth/lib/grantChecks'
import { RbacService, type RoleAclChangePreview } from '@open-mercato/core/modules/auth/services/rbacService'
import { normalizeRoleAclSnapshot, type RoleAclSnapshot } from '@open-mercato/core/modules/auth/lib/roleAclFingerprint'
import { createRandom } from './rbacPreviewFixture'

const PG_URL = process.env.OM_INSIGHTS_SIMULATION_PG_URL
const maybe = PG_URL ? describe : describe.skip

const FEATURES = [
  'auth.acl.manage', 'auth.users.list', 'sales.orders.view', 'sales.orders.manage', 'sales.quotes.view', 'catalog.products.view',
  'sales.*', 'catalog.*', 'sales.orders.*', '*',
]

registerModules([
  { id: 'auth', features: [{ id: 'auth.acl.manage', title: 'ACL', module: 'auth' }, { id: 'auth.users.list', title: 'Users', module: 'auth' }] },
  { id: 'sales', features: [
    { id: 'sales.orders.view', title: 'Orders', module: 'sales' },
    { id: 'sales.orders.manage', title: 'Manage', module: 'sales' },
    { id: 'sales.quotes.view', title: 'Quotes', module: 'sales' },
  ] },
  { id: 'catalog', features: [{ id: 'catalog.products.view', title: 'Products', module: 'catalog' }] },
] as unknown as Module[])

maybe('RbacService.previewRoleAclChange parity (PostgreSQL)', () => {
  const schema = `rbac_preview_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let pool: Pool
  let orm: MikroORM
  let em: EntityManager

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL })
    await pool.query(`create schema "${schema}"`)
    orm = await MikroORM.init({
      entities: [Tenant, Organization, User, Role, UserRole, RoleAcl, UserAcl, ApiKey],
      metadataProvider: ReflectMetadataProvider,
      clientUrl: PG_URL,
      schema,
      allowGlobalContext: true,
      discovery: { warnWhenNoEntities: false },
      debug: false,
    })
    const createSql = await orm.schema.getCreateSchemaSQL({ schema, wrap: false })
    const client = await pool.connect()
    try {
      await client.query(`set search_path to "${schema}"`)
      await client.query(createSql)
    } finally {
      client.release()
    }
    em = orm.em as EntityManager
  })

  const compared = { listed: 0, changed: 0 }

  afterAll(async () => {
    expect(compared.listed).toBeGreaterThan(0)
    expect(compared.changed).toBeGreaterThan(0)
    await orm?.close(true)
    await pool?.query(`drop schema if exists "${schema}" cascade`)
    await pool?.end()
  })

  type Seeded = { tenantId: string; organizationIds: string[]; roles: Role[]; edited: Role; proposal: RoleAclSnapshot }

  async function seed(seedValue: number): Promise<Seeded> {
    const random = createRandom(seedValue)
    const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)]
    const some = <T,>(values: readonly T[], max: number): T[] => Array.from(new Set(Array.from({ length: Math.floor(random() * (max + 1)) }, () => pick(values))))
    const fork = em.fork()
    const tenant = fork.create(Tenant, { id: randomUUID(), name: `T${seedValue}`, isActive: true, createdAt: new Date(), updatedAt: new Date() } as never)
    const otherTenant = fork.create(Tenant, { id: randomUUID(), name: `O${seedValue}`, isActive: true, createdAt: new Date(), updatedAt: new Date() } as never)
    const rootA = randomUUID()
    const childB = randomUUID()
    const rootC = randomUUID()
    const organization = (id: string, name: string, ancestors: string[]) => fork.create(Organization, {
      id, tenant, name, isActive: true, ancestorIds: ancestors, childIds: [], descendantIds: [], depth: ancestors.length, createdAt: new Date(), updatedAt: new Date(),
    } as never)
    organization(rootA, 'A', [])
    organization(childB, 'B', [rootA])
    organization(rootC, 'C', [])
    const lists: Array<string[] | null> = [null, [], ['__all__'], [rootA], [childB], [rootC], [rootA, rootC]]
    const roles = Array.from({ length: 4 }, (_, index) => fork.create(Role, { id: randomUUID(), name: `r${index}`, tenantId: tenant.id, createdAt: new Date() } as never) as Role)
    const foreignSuper = fork.create(Role, { id: randomUUID(), name: 'super', tenantId: otherTenant.id, createdAt: new Date() } as never) as Role
    fork.create(RoleAcl, { role: foreignSuper, tenantId: otherTenant.id, isSuperAdmin: true, featuresJson: [], organizationsJson: null, createdAt: new Date() } as never)
    for (const role of roles) {
      if (random() < 0.15) continue
      fork.create(RoleAcl, { role, tenantId: tenant.id, isSuperAdmin: random() < 0.1, featuresJson: some(FEATURES, 4), organizationsJson: pick(lists), createdAt: new Date() } as never)
    }
    for (let index = 0; index < 8; index += 1) {
      const user = fork.create(User, { id: randomUUID(), tenantId: tenant.id, organizationId: pick([rootA, childB, rootC, null]), email: `u${index}@${seedValue}.test`, createdAt: new Date() } as never) as User
      for (const role of some(roles, 3)) fork.create(UserRole, { user, role, createdAt: new Date() } as never)
      if (random() < 0.08) fork.create(UserRole, { user, role: foreignSuper, createdAt: new Date() } as never)
      if (random() < 0.12) fork.create(UserAcl, { user, tenantId: tenant.id, isSuperAdmin: random() < 0.2, featuresJson: some(FEATURES, 3), organizationsJson: pick(lists), createdAt: new Date() } as never)
    }
    for (let index = 0; index < 5; index += 1) {
      fork.create(ApiKey, {
        id: randomUUID(),
        name: `k${index}`,
        tenantId: tenant.id,
        organizationId: pick([null, rootA, childB, rootC]),
        keyHash: 'x',
        keyPrefix: `omk_${seedValue}_${index}`,
        rolesJson: some(roles, 2).map((role) => role.id),
        expiresAt: random() < 0.1 ? new Date('2020-01-01T00:00:00Z') : null,
        createdAt: new Date(),
      } as never)
    }
    await fork.flush()
    const edited = pick(roles)
    const proposal = normalizeRoleAclSnapshot({ isSuperAdmin: random() < 0.08, features: some(FEATURES, 4), organizations: pick(lists) })
    return { tenantId: tenant.id, organizationIds: [rootA, childB, rootC], roles, edited, proposal }
  }

  async function loaderEffective(service: RbacService, principal: string, tenantId: string, organizationId: string): Promise<string[]> {
    const granted = await service.getGrantedFeaturesWithEntityManager(em.fork(), principal, { tenantId, organizationId })
    return [...resolveEffectiveFeatures(granted)].sort()
  }

  function accessOf(preview: RoleAclChangePreview): Map<string, Map<string, { before: string[]; after: string[] }>> {
    const map = new Map<string, Map<string, { before: string[]; after: string[] }>>()
    for (const cohort of preview.cohorts) {
      for (const principal of cohort.principals) {
        const key = cohort.principalType === 'user' ? principal.id : `api_key:${principal.id}`
        map.set(key, new Map(cohort.access.map((entry) => [entry.organizationId, { before: preview.featureSets[entry.before], after: preview.featureSets[entry.after] }])))
      }
    }
    return map
  }

  async function principalsOf(seeded: Seeded): Promise<string[]> {
    const links = await em.fork().find(UserRole, { role: seeded.edited.id } as never)
    const userIds = Array.from(new Set(links.map((link) => String((link.user as { id: string }).id))))
    const keys = await em.fork().find(ApiKey, { tenantId: seeded.tenantId } as never)
    const keyIds = keys.filter((key) => (key.rolesJson ?? []).includes(seeded.edited.id) && !(key.expiresAt && key.expiresAt.getTime() < Date.now())).map((key) => `api_key:${key.id}`)
    return [...userIds, ...keyIds]
  }

  it.each(Array.from({ length: 12 }, (_, index) => 9_101 + index))('matches the loader before and after the proposal is saved (seed %i)', async (seedValue) => {
    const seeded = await seed(seedValue)
    const service = new RbacService(em)
    const preview = await service.previewRoleAclChange(seeded.tenantId, seeded.edited.id, seeded.proposal, { em: em.fork() })
    expect(preview).not.toBeNull()
    const access = accessOf(preview!)
    const principals = await principalsOf(seeded)
    const superAdmins = await listSuperAdminUserIds(em.fork(), seeded.tenantId)
    const userAcls = await em.fork().find(UserAcl, { tenantId: seeded.tenantId } as never)
    const userAclHolders = new Set(userAcls.map((acl) => String((acl.user as { id: string }).id)))
    const before = new Map<string, Map<string, string[]>>()
    for (const principal of principals) {
      const perOrganization = new Map<string, string[]>()
      for (const organizationId of seeded.organizationIds) perOrganization.set(organizationId, await loaderEffective(service, principal, seeded.tenantId, organizationId))
      before.set(principal, perOrganization)
    }
    const fork = em.fork()
    await fork.nativeDelete(RoleAcl, { role: seeded.edited.id, tenantId: seeded.tenantId } as never)
    fork.create(RoleAcl, {
      role: seeded.edited.id,
      tenantId: seeded.tenantId,
      isSuperAdmin: seeded.proposal.isSuperAdmin,
      featuresJson: seeded.proposal.features,
      organizationsJson: seeded.proposal.organizations,
      createdAt: new Date(),
    } as never)
    await fork.flush()
    for (const principal of principals) {
      const listed = access.get(principal)
      const excludedUser = !principal.startsWith('api_key:') && superAdmins.has(principal)
      for (const organizationId of seeded.organizationIds) {
        const expectedBefore = before.get(principal)!.get(organizationId)!
        const expectedAfter = await loaderEffective(service, principal, seeded.tenantId, organizationId)
        if (listed) {
          compared.listed += 1
          if (JSON.stringify(expectedBefore) !== JSON.stringify(expectedAfter)) compared.changed += 1
          expect(excludedUser).toBe(false)
          expect(listed.get(organizationId)?.before ?? []).toEqual(expectedBefore)
          expect(listed.get(organizationId)?.after ?? []).toEqual(expectedAfter)
        } else if (!excludedUser && !userAclHolders.has(principal)) {
          const globalBefore = await service.loadAclWithEntityManager(em.fork(), principal, { tenantId: seeded.tenantId, organizationId: null })
          if (!(globalBefore.isSuperAdmin && globalBefore.organizations === null)) {
            expect(expectedBefore).toEqual([])
            expect(expectedAfter).toEqual([])
          }
        }
      }
    }
  })
})
