/** @jest-environment node */
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import cli from '@open-mercato/core/modules/customer_accounts/cli'

const testModules: Module[] = [
  {
    id: 'workflows',
    setup: {
      defaultCustomerRoleFeatures: {
        buyer: ['portal.tasks.view', 'portal.tasks.complete'],
        viewer: ['portal.tasks.view'],
      },
    },
  },
  {
    id: 'partnerships',
    setup: { defaultCustomerRoleFeatures: { buyer: ['portal.partners.view'] } },
  },
  { id: 'customer_accounts', setup: { defaultRoleFeatures: { admin: ['customer_accounts.*'] } } },
]
registerModules(testModules)
registerCliModules(testModules)

type RoleStub = { id: string; name: string; slug: string; tenantId: string; deletedAt: Date | null }
type RoleAclStub = { id: string; role: RoleStub; tenantId: string; featuresJson: string[] }

let tenantsList: Array<{ id: string }> = []
let rolesByTenant: Record<string, RoleStub[]> = {}
let aclsByTenant: Record<string, RoleAclStub[]> = {}
let persistedAcls: RoleAclStub[] = []
let flushCount = 0

const findOne = jest.fn(async (Entity: { name?: string }, where: Record<string, unknown>) => {
  if (Entity?.name === 'CustomerRole') {
    const tenantId = String(where?.tenantId ?? '')
    const roles = rolesByTenant[tenantId] ?? []
    return (
      roles.find((role) => role.slug === where?.slug && role.deletedAt === (where?.deletedAt ?? null)) ?? null
    )
  }
  if (Entity?.name === 'CustomerRoleAcl') {
    const tenantId = String(where?.tenantId ?? '')
    const role = where?.role as RoleStub | undefined
    const acls = aclsByTenant[tenantId] ?? []
    return acls.find((acl) => acl.role?.id === role?.id) ?? null
  }
  if (Entity?.name === 'Tenant') {
    const id = where?.id
    if (!id) return null
    return tenantsList.find((tenant) => tenant.id === id) ?? null
  }
  return null
})

const find = jest.fn(async (Entity: { name?: string }) => {
  if (Entity?.name === 'Tenant') return tenantsList
  return []
})

const persist = jest.fn(function persist(this: unknown, entity: RoleAclStub) {
  if (!persistedAcls.includes(entity)) persistedAcls.push(entity)
  return this
})

const flush = jest.fn(async () => {
  flushCount += 1
})

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => ({ findOne, find, persist, flush }),
  }),
}))

function seedTenant(
  tenantId: string,
  roles: Array<{ slug: string; name: string; features: string[] }>,
): void {
  if (!tenantsList.some((tenant) => tenant.id === tenantId)) tenantsList.push({ id: tenantId })
  rolesByTenant[tenantId] = roles.map((role) => ({
    id: `role-${role.slug}-${tenantId}`,
    name: role.name,
    slug: role.slug,
    tenantId,
    deletedAt: null,
  }))
  aclsByTenant[tenantId] = rolesByTenant[tenantId].map((role, index) => ({
    id: `acl-${role.slug}-${tenantId}`,
    role,
    tenantId,
    featuresJson: [...roles[index].features],
  }))
}

function aclFor(tenantId: string, slug: string): RoleAclStub | undefined {
  return (aclsByTenant[tenantId] ?? []).find((acl) => acl.role.slug === slug)
}

function command() {
  const cmd = cli.find((entry) => entry.command === 'sync-customer-role-acls')
  if (!cmd) throw new Error('[internal] sync-customer-role-acls command not registered')
  return cmd
}

describe('customer_accounts CLI sync-customer-role-acls', () => {
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    tenantsList = []
    rolesByTenant = {}
    aclsByTenant = {}
    persistedAcls = []
    flushCount = 0
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('grants a declared feature the role is missing, writing once', async () => {
    seedTenant('t-1', [
      { slug: 'buyer', name: 'Buyer', features: ['portal.orders.view'] },
    ])

    await command().run(['--tenant', 't-1'])

    expect(aclFor('t-1', 'buyer')?.featuresJson).toEqual([
      'portal.orders.view',
      'portal.tasks.view',
      'portal.tasks.complete',
      'portal.partners.view',
    ])
    expect(persistedAcls).toHaveLength(1)
    expect(flushCount).toBe(1)
    expect(logSpy).toHaveBeenCalledWith(
      '   • Buyer (buyer) gained: portal.tasks.view, portal.tasks.complete, portal.partners.view',
    )
  })

  it('writes nothing when the role already holds every declared feature', async () => {
    seedTenant('t-1', [
      {
        slug: 'buyer',
        name: 'Buyer',
        features: ['portal.orders.view', 'portal.tasks.view', 'portal.tasks.complete', 'portal.partners.view'],
      },
    ])

    await command().run(['--tenant', 't-1'])

    expect(aclFor('t-1', 'buyer')?.featuresJson).toEqual([
      'portal.orders.view',
      'portal.tasks.view',
      'portal.tasks.complete',
      'portal.partners.view',
    ])
    expect(persistedAcls).toEqual([])
    expect(flushCount).toBe(0)
    expect(logSpy).toHaveBeenCalledWith('✅ Customer role ACLs already in sync for tenant t-1')
  })

  it('treats a wildcard grant as covering the concrete feature', async () => {
    seedTenant('t-1', [{ slug: 'buyer', name: 'Buyer', features: ['portal.*'] }])

    await command().run(['--tenant', 't-1'])

    expect(aclFor('t-1', 'buyer')?.featuresJson).toEqual(['portal.*'])
    expect(persistedAcls).toEqual([])
    expect(flushCount).toBe(0)
  })

  it('is additive — never revokes a hand-added feature', async () => {
    seedTenant('t-1', [
      { slug: 'viewer', name: 'Viewer', features: ['portal.catalog.view', 'operator.added.by.hand'] },
    ])

    await command().run(['--tenant', 't-1'])

    expect(aclFor('t-1', 'viewer')?.featuresJson).toEqual([
      'portal.catalog.view',
      'operator.added.by.hand',
      'portal.tasks.view',
    ])
  })

  it('never creates a role or an ACL row for a slug the tenant does not have', async () => {
    seedTenant('t-1', [{ slug: 'viewer', name: 'Viewer', features: [] }])

    await command().run(['--tenant', 't-1'])

    expect(rolesByTenant['t-1'].map((role) => role.slug)).toEqual(['viewer'])
    expect((aclsByTenant['t-1'] ?? []).map((acl) => acl.role.slug)).toEqual(['viewer'])
    expect(persistedAcls.map((acl) => acl.role.slug)).toEqual(['viewer'])
    const buyerMentions = logSpy.mock.calls.filter((call) => String(call[0]).includes('(buyer)'))
    expect(buyerMentions).toEqual([])
    expect(logSpy).toHaveBeenCalledWith('Updated 1 customer role ACL(s) across 1 tenant(s).')
  })

  it('a second run is a no-op', async () => {
    seedTenant('t-1', [{ slug: 'buyer', name: 'Buyer', features: [] }])

    await command().run(['--tenant', 't-1'])
    const afterFirstRun = [...(aclFor('t-1', 'buyer')?.featuresJson ?? [])]
    expect(flushCount).toBe(1)

    persistedAcls = []
    await command().run(['--tenant', 't-1'])

    expect(aclFor('t-1', 'buyer')?.featuresJson).toEqual(afterFirstRun)
    expect(persistedAcls).toEqual([])
    expect(flushCount).toBe(1)
  })

  it('--tenant narrows the write to that tenant only', async () => {
    seedTenant('t-1', [{ slug: 'buyer', name: 'Buyer', features: [] }])
    seedTenant('t-2', [{ slug: 'buyer', name: 'Buyer', features: [] }])

    await command().run(['--tenant', 't-1'])

    expect(aclFor('t-1', 'buyer')?.featuresJson).toEqual([
      'portal.tasks.view',
      'portal.tasks.complete',
      'portal.partners.view',
    ])
    expect(aclFor('t-2', 'buyer')?.featuresJson).toEqual([])
  })

  it('syncs every tenant when --tenant is omitted', async () => {
    seedTenant('t-1', [{ slug: 'buyer', name: 'Buyer', features: [] }])
    seedTenant('t-2', [{ slug: 'viewer', name: 'Viewer', features: [] }])

    await command().run([])

    expect(aclFor('t-1', 'buyer')?.featuresJson).toContain('portal.tasks.complete')
    expect(aclFor('t-2', 'viewer')?.featuresJson).toEqual(['portal.tasks.view'])
  })

  it('errors and writes nothing when --tenant points at a non-existent tenant', async () => {
    seedTenant('t-1', [{ slug: 'buyer', name: 'Buyer', features: [] }])

    await command().run(['--tenant', 't-missing'])

    expect(persistedAcls).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith('❌ Tenant not found: t-missing')
  })

  it('logs and exits when there are no tenants', async () => {
    await command().run([])

    expect(persistedAcls).toEqual([])
    expect(logSpy).toHaveBeenCalledWith('No tenants found; nothing to sync.')
  })
})
