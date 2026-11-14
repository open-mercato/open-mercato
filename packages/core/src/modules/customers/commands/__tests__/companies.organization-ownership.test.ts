jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (entity: unknown, filters: unknown) => unknown }, entity: unknown, filters: unknown) => em.find(entity, filters),
  findOneWithDecryption: (em: { findOne: (entity: unknown, filters: unknown) => unknown }, entity: unknown, filters: unknown) => em.findOne(entity, filters),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual<typeof import('@open-mercato/shared/lib/commands/helpers')>('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(async () => {}),
  setCustomFieldsIfAny: jest.fn(async () => {}),
}))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { runCommandInterceptorsBefore } from '@open-mercato/shared/lib/commands/command-interceptor-runner'
import { emitCrudSideEffects, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CustomerEntity, CustomerCompanyProfile } from '../../data/entities'
import '../companies'

const ids = {
  tenant: '550e8400-e29b-41d4-a716-446655440001',
  organization: '550e8400-e29b-41d4-a716-446655440002',
  otherTenant: '550e8400-e29b-41d4-a716-446655440003',
  foreign: '550e8400-e29b-41d4-a716-446655440004',
  sibling: '550e8400-e29b-41d4-a716-446655440005',
  deleted: '550e8400-e29b-41d4-a716-446655440006',
  missing: '550e8400-e29b-41d4-a716-446655440007',
}

type Row = Record<string, unknown>

function harness() {
  const organizations = [
    { id: ids.organization, tenant: ids.tenant, deletedAt: null },
    { id: ids.sibling, tenant: ids.tenant, deletedAt: null },
    { id: ids.foreign, tenant: ids.otherTenant, deletedAt: null },
    { id: ids.deleted, tenant: ids.tenant, deletedAt: new Date() },
  ]
  const em = {
    fork: () => em,
    findOne: jest.fn(async (entity: unknown, filters: Row) => entity === Organization
      ? organizations.find((row) => Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value)) ?? null
      : null),
    find: jest.fn(async () => []),
    create: jest.fn((entity: unknown, values: Row) => ({ id: entity === CustomerEntity ? 'company-entity' : 'company-profile', ...values })),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
  const eventBus = { emitEvent: jest.fn(async () => {}) }
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        if (name === 'eventBus') return eventBus
        throw new Error(`[internal] Unexpected dependency ${name}`)
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'actor', tenantId: ids.tenant, orgId: ids.organization },
    selectedOrganizationId: ids.organization,
    organizationIds: null,
    organizationScope: { tenantId: ids.tenant, selectedId: ids.organization, allowedIds: null, filterIds: null },
  }
  return { em, ctx, eventBus }
}

function create(input: Row, ctx: CommandRuntimeContext) {
  const command = commandRegistry.get('customers.companies.create')
  if (!command) throw new Error('[internal] Company create command is not registered')
  return command.execute({ displayName: 'Ownership regression', tenantId: ids.tenant, organizationId: ids.organization, ...input }, ctx)
}

function expectNoWrites(state: ReturnType<typeof harness>) {
  expect(state.em.create).not.toHaveBeenCalled()
  expect(state.em.persist).not.toHaveBeenCalled()
  expect(state.em.flush).not.toHaveBeenCalled()
  expect(state.em.begin).not.toHaveBeenCalled()
  expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
  expect(emitCrudSideEffects).not.toHaveBeenCalled()
  expect(state.eventBus.emitEvent).not.toHaveBeenCalled()
}

beforeEach(() => jest.clearAllMocks())

describe('customers.companies.create organization ownership (#8675)', () => {
  it.each(['foreign', 'missing', 'deleted'] as const)('rejects a %s organization before any writes with unrestricted organization ACL', async (target) => {
    const state = harness()
    await expect(create({ organizationId: ids[target], customFields: { probe: true } }, state.ctx)).rejects.toMatchObject({ status: 403, body: { error: 'Forbidden' } })
    expect(state.em.findOne).toHaveBeenCalledWith(Organization, { id: ids[target], tenant: ids.tenant, deletedAt: null })
    expectNoWrites(state)
  })

  it('rejects a foreign tenant input even when the organization belongs to that tenant', async () => {
    const state = harness()
    await expect(create({ tenantId: ids.otherTenant, organizationId: ids.foreign }, state.ctx)).rejects.toMatchObject({ status: 403 })
    expectNoWrites(state)
  })

  it.each([{ allowedIds: [] }, { allowedIds: [ids.organization] }])('preserves restricted organization ACL $allowedIds', async ({ allowedIds }) => {
    const state = harness()
    state.ctx.organizationScope = { tenantId: ids.tenant, selectedId: ids.organization, allowedIds, filterIds: allowedIds }
    await expect(create({ organizationId: ids.sibling }, state.ctx)).rejects.toMatchObject({ status: 403 })
    expectNoWrites(state)
  })

  it('preserves a restricted caller creating in its allowed organization', async () => {
    const state = harness()
    state.ctx.organizationScope = { tenantId: ids.tenant, selectedId: ids.organization, allowedIds: [ids.organization], filterIds: [ids.organization] }
    await expect(create({}, state.ctx)).resolves.toMatchObject({ entityId: 'company-entity' })
  })

  it('checks the final organization after a command interceptor rewrites the input', async () => {
    const state = harness()
    const before = await runCommandInterceptorsBefore([{
      id: 'company-ownership-probe',
      targetCommand: 'customers.companies.create',
      beforeExecute: async () => ({ ok: true, modifiedInput: { organizationId: ids.foreign } }),
    }], 'customers.companies.create', { organizationId: ids.organization }, {
      commandId: 'customers.companies.create', auth: state.ctx.auth, container: state.ctx.container, selectedOrganizationId: ids.organization,
    }, [])
    expect(before.ok).toBe(true)
    expect(before.modifiedInput).toEqual({ organizationId: ids.foreign })
    await expect(create(before.modifiedInput ?? {}, state.ctx)).rejects.toMatchObject({ status: 403 })
    expectNoWrites(state)
  })

  it.each([ids.organization, ids.sibling])('preserves valid same-tenant creation in %s', async (organizationId) => {
    const state = harness()
    await expect(create({ organizationId }, state.ctx)).resolves.toEqual({ entityId: 'company-entity', companyId: 'company-profile' })
    for (const entity of [CustomerEntity, CustomerCompanyProfile]) {
      expect(state.em.create).toHaveBeenCalledWith(entity, expect.objectContaining({ organizationId, tenantId: ids.tenant }))
    }
    expect(emitCrudSideEffects).toHaveBeenCalledTimes(1)
  })

  it.each(['selected-tenant', 'global-superadmin', 'system', 'legacy-worker'] as const)('preserves supported %s contexts while still enforcing ownership', async (context) => {
    const state = harness()
    const organizationId = context === 'selected-tenant' ? ids.foreign : ids.organization
    const tenantId = context === 'selected-tenant' ? ids.otherTenant : ids.tenant
    if (context === 'selected-tenant') {
      state.ctx.auth = { sub: 'platform-actor', isSuperAdmin: true, tenantId, orgId: null }
      state.ctx.organizationScope = { tenantId, selectedId: organizationId, allowedIds: null, filterIds: [organizationId] }
    } else if (context === 'global-superadmin') {
      state.ctx.auth = { sub: 'platform-actor', isSuperAdmin: true, tenantId: null, orgId: null }
      state.ctx.organizationScope = null
    } else {
      state.ctx.auth = null
      state.ctx.organizationScope = null
      state.ctx.systemActor = context === 'system'
    }
    state.ctx.selectedOrganizationId = organizationId
    await expect(create({ tenantId, organizationId }, state.ctx)).resolves.toMatchObject({ entityId: 'company-entity' })
    jest.clearAllMocks()
    await expect(create({ tenantId, organizationId: ids.missing }, state.ctx)).rejects.toMatchObject({ status: 403 })
    expectNoWrites(state)
  })
})
