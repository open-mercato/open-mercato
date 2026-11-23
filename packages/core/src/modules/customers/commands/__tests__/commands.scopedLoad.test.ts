type Row = { id: string; tenantId: string; organizationId: string; [key: string]: unknown }

const seenWheres: Array<{ entity: string; where: Record<string, unknown> }> = []
let store = new Map<string, Row[]>()

function entityName(entity: unknown): string {
  return typeof entity === 'function' ? entity.name : String(entity)
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'deletedAt') continue
    const actual = row[key]
    if (expected && typeof expected === 'object' && '$in' in expected) {
      if (!(expected as { $in: unknown[] }).$in.includes(actual)) return false
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

function lookup(entity: unknown, where: unknown): Row | null {
  const filter = (where ?? {}) as Record<string, unknown>
  const name = entityName(entity)
  seenWheres.push({ entity: name, where: filter })
  return (store.get(name) ?? []).find((row) => matches(row, filter)) ?? null
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: unknown) => lookup(entity, where)),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

const TENANT_A = '33333333-3333-4333-8333-333333333333'
const TENANT_B = '44444444-4444-4444-8444-444444444444'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_A2 = '55555555-5555-4555-8555-555555555555'
const ORG_B = '66666666-6666-4666-8666-666666666666'
const PERSON_ID = '11111111-1111-4111-8111-111111111111'
const COMPANY_ID = '77777777-7777-4777-8777-777777777777'
const DEAL_ID = '88888888-8888-4888-8888-888888888888'
const ADDRESS_ID = '99999999-9999-4999-8999-999999999999'
const COMMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TAG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PIPELINE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const INTERACTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function seed(tenantId: string, organizationId: string) {
  const scope = { tenantId, organizationId, deletedAt: null }
  store = new Map<string, Row[]>([
    ['CustomerEntity', [
      { id: PERSON_ID, kind: 'person', ...scope },
      { id: COMPANY_ID, kind: 'company', ...scope },
    ]],
    ['CustomerDeal', [{ id: DEAL_ID, ...scope }]],
    ['CustomerAddress', [{ id: ADDRESS_ID, entity: { id: PERSON_ID }, ...scope }]],
    ['CustomerComment', [{ id: COMMENT_ID, entity: { id: PERSON_ID }, ...scope }]],
    ['CustomerTag', [{ id: TAG_ID, slug: 'vip', label: 'VIP', ...scope }]],
    ['CustomerPipeline', [{ id: PIPELINE_ID, name: 'Main', ...scope }]],
    ['CustomerInteraction', [{ id: INTERACTION_ID, entity: { id: PERSON_ID }, interactionType: 'call', ...scope }]],
  ])
}

function buildEm() {
  const em: Record<string, jest.Mock> = {
    findOne: jest.fn(async (entity: unknown, where: unknown) => lookup(entity, where)),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, payload: unknown) => payload),
    nativeDelete: jest.fn(async () => 0),
    nativeUpdate: jest.fn(async () => 0),
    remove: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
    fork: jest.fn(),
    transactional: jest.fn(),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (callback: (trx: unknown) => Promise<unknown>) => callback(em))
  return em
}

function buildCtx(overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
  const em = buildEm()
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return { markOrmEntityChange: jest.fn(), setCustomFields: jest.fn() }
      return undefined
    }),
  } as unknown as AppContainer
  return {
    container,
    auth: { sub: 'user-1', tenantId: TENANT_A, orgId: ORG_A } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG_A,
    organizationIds: [ORG_A],
    ...overrides,
  }
}

type Case = [commandId: string, entity: string, id: string, input: Record<string, unknown>]

const COMMANDS: Case[] = [
  ['customers.people.update', 'CustomerEntity', PERSON_ID, { id: PERSON_ID }],
  ['customers.people.delete', 'CustomerEntity', PERSON_ID, { body: { id: PERSON_ID } }],
  ['customers.companies.update', 'CustomerEntity', COMPANY_ID, { id: COMPANY_ID }],
  ['customers.companies.delete', 'CustomerEntity', COMPANY_ID, { body: { id: COMPANY_ID } }],
  ['customers.deals.update', 'CustomerDeal', DEAL_ID, { id: DEAL_ID }],
  ['customers.deals.delete', 'CustomerDeal', DEAL_ID, { body: { id: DEAL_ID } }],
  ['customers.addresses.update', 'CustomerAddress', ADDRESS_ID, { id: ADDRESS_ID }],
  ['customers.addresses.delete', 'CustomerAddress', ADDRESS_ID, { body: { id: ADDRESS_ID } }],
  ['customers.comments.update', 'CustomerComment', COMMENT_ID, { id: COMMENT_ID }],
  ['customers.comments.delete', 'CustomerComment', COMMENT_ID, { body: { id: COMMENT_ID } }],
  ['customers.tags.update', 'CustomerTag', TAG_ID, { id: TAG_ID }],
  ['customers.pipelines.update', 'CustomerPipeline', PIPELINE_ID, { id: PIPELINE_ID }],
  ['customers.pipelines.delete', 'CustomerPipeline', PIPELINE_ID, { id: PIPELINE_ID }],
  ['customers.interactions.update', 'CustomerInteraction', INTERACTION_ID, { id: INTERACTION_ID }],
  ['customers.interactions.complete', 'CustomerInteraction', INTERACTION_ID, { id: INTERACTION_ID }],
  ['customers.interactions.cancel', 'CustomerInteraction', INTERACTION_ID, { id: INTERACTION_ID }],
  ['customers.interactions.delete', 'CustomerInteraction', INTERACTION_ID, { body: { id: INTERACTION_ID } }],
]

const SCOPE_ONLY_CTX: Partial<CommandRuntimeContext> = {
  auth: null,
  organizationScope: { selectedId: ORG_A, filterIds: [ORG_A], allowedIds: [ORG_A], tenantId: TENANT_A },
}

function getHandler(commandId: string): CommandHandler<unknown, unknown> {
  const handler = commandRegistry.get(commandId) as CommandHandler<unknown, unknown> | undefined
  if (!handler) throw new Error(`[internal] command ${commandId} not registered`)
  return handler
}

function targetWheres(entity: string, id: string) {
  return seenWheres.filter((entry) => entry.entity === entity && entry.where.id === id).map((entry) => entry.where)
}

describe('customers write commands load records inside the caller scope (#7598)', () => {
  beforeEach(() => {
    seenWheres.length = 0
    store = new Map()
  })

  it.each(COMMANDS)("%s treats another tenant's record as not found", async (commandId, _entity, _id, input) => {
    seed(TENANT_B, ORG_B)
    const handler = getHandler(commandId)
    const ctx = buildCtx()
    const prepared = handler.prepare ? await handler.prepare(input, ctx) : {}
    expect((prepared as { before?: unknown } | undefined)?.before).toBeUndefined()
    await expect(handler.execute(input, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it.each(COMMANDS)('%s scopes the target lookup to the tenant and allowed organizations when auth is null', async (commandId, entity, id, input) => {
    seed(TENANT_B, ORG_A)
    const handler = getHandler(commandId)
    const ctx = buildCtx(SCOPE_ONLY_CTX)
    const prepared = handler.prepare ? await handler.prepare(input, ctx) : {}
    expect((prepared as { before?: unknown } | undefined)?.before).toBeUndefined()
    await expect(handler.execute(input, ctx)).rejects.toMatchObject({ status: 404 })
    const wheres = targetWheres(entity, id)
    expect(wheres.length).toBeGreaterThan(0)
    for (const where of wheres) {
      expect(where.tenantId).toBe(TENANT_A)
      const organizationIds = typeof where.organizationId === 'string'
        ? [where.organizationId]
        : (where.organizationId as { $in: string[] }).$in
      expect(organizationIds).toEqual([ORG_A])
    }
  })

  it.each(COMMANDS)('%s does not restrict organizations for a super admin', async (commandId, entity, id, input) => {
    seed(TENANT_A, ORG_B)
    const handler = getHandler(commandId)
    const ctx = buildCtx({
      auth: { sub: 'admin-1', tenantId: TENANT_A, orgId: ORG_A, isSuperAdmin: true } as CommandRuntimeContext['auth'],
      organizationScope: { selectedId: ORG_A, filterIds: [ORG_A], allowedIds: [ORG_A], tenantId: TENANT_A },
    })
    const entryLookups: Array<Record<string, unknown>> = []
    if (handler.prepare) {
      await handler.prepare(input, ctx).catch(() => undefined)
      const prepareWheres = targetWheres(entity, id)
      if (prepareWheres.length) entryLookups.push(prepareWheres[0])
      seenWheres.length = 0
    }
    await handler.execute(input, ctx).catch(() => undefined)
    const executeWheres = targetWheres(entity, id)
    expect(executeWheres.length).toBeGreaterThan(0)
    entryLookups.push(executeWheres[0])
    for (const where of entryLookups) {
      expect(where.tenantId).toBe(TENANT_A)
      expect(where.organizationId).toBeUndefined()
    }
  })

  it('still finds a person in a non-selected allowed organization', async () => {
    seed(TENANT_A, ORG_A2)
    const handler = getHandler('customers.people.update')
    const ctx = buildCtx({
      organizationScope: { selectedId: ORG_A, filterIds: [ORG_A, ORG_A2], allowedIds: [ORG_A, ORG_A2], tenantId: TENANT_A },
      organizationIds: [ORG_A, ORG_A2],
    })
    await handler.execute({ id: PERSON_ID }, ctx).catch(() => undefined)
    const wheres = targetWheres('CustomerEntity', PERSON_ID)
    expect(wheres[0]).toMatchObject({ tenantId: TENANT_A, organizationId: { $in: [ORG_A, ORG_A2] } })
    expect(store.get('CustomerEntity')?.some((row) => matches(row, wheres[0]))).toBe(true)
  })
})
