jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [])),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CustomerAddress, CustomerEntity } from '../../data/entities'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT_ID = '99999999-9999-4999-8999-999999999999'
const OTHER_ORG_ID = '88888888-8888-4888-8888-888888888888'
const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_PERSON_ID = '44444444-4444-4444-8444-444444444444'
const ADDRESS_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ADDRESS_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ADDRESS_C_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ADDRESS_D_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

type AddressRow = {
  id: string
  entityId: string
  tenantId: string
  organizationId: string
  addressLine1: string
  isPrimary: boolean
}

type ManagedAddress = Record<string, unknown> & { id: string; isPrimary: boolean; entity: CustomerEntity }

type Store = {
  rows: Map<string, AddressRow>
  em: any
  primaryIds: (entityId?: string) => string[]
}

function matchesCondition(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object') {
    const operators = expected as { $ne?: unknown; $in?: unknown[] }
    if ('$ne' in operators) return actual !== operators.$ne
    if (Array.isArray(operators.$in)) return operators.$in.includes(actual)
  }
  return actual === expected
}

function rowMatches(row: AddressRow, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = key === 'entity' ? row.entityId : (row as Record<string, unknown>)[key]
    if (!matchesCondition(actual, expected)) return false
  }
  return true
}

// Row store with MikroORM-like semantics: `nativeUpdate` writes rows directly and leaves
// managed entities stale, `flush` only writes fields that differ from the entity's
// last-loaded baseline, a fork starts with an empty identity map, and a rollback puts the
// rows back. Assertions read `rows`, never the managed entities. It exercises the handlers'
// decisions, not SQL; TC-UNDO-006 covers the same flows against Postgres.
function makeStore(
  seed: Array<Partial<AddressRow> & { id: string; isPrimary: boolean }>,
  createdIds: string[] = [ADDRESS_B_ID, ADDRESS_C_ID],
): Store {
  const customers = new Map<string, CustomerEntity>(
    [PERSON_ID, OTHER_PERSON_ID].map((id) => [
      id,
      { id, kind: 'person', organizationId: ORG_ID, tenantId: TENANT_ID, deletedAt: null } as unknown as CustomerEntity,
    ]),
  )
  const rows = new Map<string, AddressRow>()
  for (const entry of seed) {
    rows.set(entry.id, {
      entityId: PERSON_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      addressLine1: `Line ${entry.id.slice(0, 1)}`,
      ...entry,
    })
  }

  const managed = new Map<string, ManagedAddress>()
  const baselines = new Map<string, { isPrimary: boolean; entityId: string }>()
  const pendingInserts = new Set<ManagedAddress>()
  const pendingRemovals = new Set<ManagedAddress>()
  const nextIds = [...createdIds]
  let rowsAtBegin: Map<string, AddressRow> | null = null

  const hydrate = (row: AddressRow): ManagedAddress => {
    const existing = managed.get(row.id)
    if (existing) return existing
    const entity: ManagedAddress = {
      id: row.id,
      organizationId: row.organizationId,
      tenantId: row.tenantId,
      addressLine1: row.addressLine1,
      isPrimary: row.isPrimary,
      entity: customers.get(row.entityId)!,
    }
    managed.set(row.id, entity)
    baselines.set(row.id, { isPrimary: row.isPrimary, entityId: row.entityId })
    return entity
  }

  const em: any = {
    fork: jest.fn(),
    isInTransaction: jest.fn(() => false),
    begin: jest.fn(async () => {
      rowsAtBegin = new Map([...rows].map(([id, row]) => [id, { ...row }]))
    }),
    commit: jest.fn(async () => {
      rowsAtBegin = null
    }),
    rollback: jest.fn(async () => {
      if (!rowsAtBegin) return
      rows.clear()
      for (const [id, row] of rowsAtBegin) rows.set(id, row)
      rowsAtBegin = null
    }),
    create: jest.fn((ctor: unknown, data: Record<string, unknown>) => {
      if (ctor !== CustomerAddress) throw new Error('Unexpected em.create target')
      const id = (data.id as string | undefined) ?? nextIds.shift()
      if (!id) throw new Error('No address id left for em.create')
      return { ...data, id }
    }),
    persist: jest.fn((entity: ManagedAddress) => {
      if (!managed.has(entity.id) && !rows.has(entity.id)) pendingInserts.add(entity)
    }),
    remove: jest.fn((entity: ManagedAddress) => {
      pendingRemovals.add(entity)
    }),
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor === CustomerEntity) {
        const customer = customers.get(String(where.id)) ?? null
        if (!customer) return null
        if (where.tenantId && where.tenantId !== customer.tenantId) return null
        return customer
      }
      if (ctor === CustomerAddress) {
        const row = [...rows.values()].find((candidate) => rowMatches(candidate, where))
        return row ? hydrate(row) : null
      }
      return null
    }),
    find: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor !== CustomerAddress) return []
      return [...rows.values()].filter((row) => rowMatches(row, where)).map((row) => ({ id: row.id }))
    }),
    count: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor !== CustomerAddress) return 0
      return [...rows.values()].filter((row) => rowMatches(row, where)).length
    }),
    nativeUpdate: jest.fn(async (ctor: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      if (ctor !== CustomerAddress) return 0
      let affected = 0
      for (const row of rows.values()) {
        if (!rowMatches(row, where)) continue
        if ('isPrimary' in data) row.isPrimary = Boolean(data.isPrimary)
        affected += 1
      }
      return affected
    }),
    flush: jest.fn(async () => {
      for (const entity of pendingInserts) {
        rows.set(entity.id, {
          id: entity.id,
          entityId: entity.entity.id,
          tenantId: String(entity.tenantId),
          organizationId: String(entity.organizationId),
          addressLine1: String(entity.addressLine1),
          isPrimary: Boolean(entity.isPrimary),
        })
        managed.set(entity.id, entity)
        baselines.set(entity.id, { isPrimary: Boolean(entity.isPrimary), entityId: entity.entity.id })
      }
      pendingInserts.clear()
      for (const entity of pendingRemovals) {
        rows.delete(entity.id)
        managed.delete(entity.id)
        baselines.delete(entity.id)
      }
      pendingRemovals.clear()
      for (const [id, entity] of managed) {
        const row = rows.get(id)
        const baseline = baselines.get(id)
        if (!row || !baseline) continue
        if (Boolean(entity.isPrimary) !== baseline.isPrimary) row.isPrimary = Boolean(entity.isPrimary)
        if (entity.entity.id !== baseline.entityId) row.entityId = entity.entity.id
        baselines.set(id, { isPrimary: Boolean(entity.isPrimary), entityId: entity.entity.id })
      }
    }),
  }
  em.fork.mockImplementation(() => {
    managed.clear()
    baselines.clear()
    pendingInserts.clear()
    pendingRemovals.clear()
    return em
  })

  mockFindOneWithDecryption.mockImplementation(async (...args: unknown[]) => {
    const [, ctor, where] = args as [unknown, unknown, Record<string, unknown>]
    return em.findOne(ctor, where)
  })

  const primaryIds = (entityId: string = PERSON_ID) =>
    [...rows.values()]
      .filter((row) => row.entityId === entityId && row.isPrimary)
      .map((row) => row.id)
      .sort((left, right) => left.localeCompare(right))

  return { rows, em, primaryIds }
}

function makeCtx(em: any): CommandRuntimeContext {
  const dataEngine: any = {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
  }
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        throw new Error(`Unexpected DI token: ${token}`)
      },
    } as any,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID } as any,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

type UndoPayload = Record<string, unknown>
type LogEntry = { resourceId: string | null; commandPayload: { undo: UndoPayload; __redoInput: unknown }; snapshotAfter?: unknown }

function getHandler(id: string): CommandHandler<any, any> {
  const handler = commandRegistry.get(id) as CommandHandler<any, any> | undefined
  if (!handler) throw new Error(`Command ${id} is not registered`)
  return handler
}

async function run(
  commandId: string,
  input: Record<string, unknown>,
  store: Store,
  redoLogEntry?: LogEntry,
): Promise<LogEntry> {
  const handler = getHandler(commandId)
  const ctx = makeCtx(store.em)
  const prepared = handler.prepare ? await handler.prepare(input, ctx) : {}
  const result = redoLogEntry && typeof handler.redo === 'function'
    ? await handler.redo({ input, ctx, logEntry: redoLogEntry } as any)
    : await handler.execute(input, ctx)
  const after = handler.captureAfter ? await handler.captureAfter(input, result, ctx) : undefined
  const log = await handler.buildLog!({ input, result, ctx, snapshots: { ...(prepared ?? {}), after } } as any)
  return {
    resourceId: (log as any)?.resourceId ?? null,
    commandPayload: JSON.parse(JSON.stringify({ undo: (log as any)?.payload?.undo ?? {}, __redoInput: input })),
    snapshotAfter: (log as any)?.snapshotAfter ?? null,
  }
}

async function undo(commandId: string, logEntry: LogEntry, store: Store): Promise<void> {
  await getHandler(commandId).undo!({ logEntry, ctx: makeCtx(store.em) } as any)
}

const createInput = (overrides: Record<string, unknown> = {}) => ({
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  entityId: PERSON_ID,
  addressLine1: 'Line B',
  isPrimary: true,
  ...overrides,
})

describe('customers.addresses undo restores the primary address the operation demoted', () => {
  afterEach(() => jest.clearAllMocks())

  it('create undo makes the previously primary address primary again', async () => {
    const store = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])

    const logEntry = await run('customers.addresses.create', createInput(), store)
    expect(store.primaryIds()).toEqual([ADDRESS_B_ID])

    await undo('customers.addresses.create', logEntry, store)

    expect(store.rows.has(ADDRESS_B_ID)).toBe(false)
    expect(store.primaryIds()).toEqual([ADDRESS_A_ID])
  })

  it('update undo makes the previously primary address primary again', async () => {
    const store = makeStore([
      { id: ADDRESS_A_ID, isPrimary: true },
      { id: ADDRESS_B_ID, isPrimary: false },
    ])

    const logEntry = await run('customers.addresses.update', { id: ADDRESS_B_ID, isPrimary: true }, store)
    expect(store.primaryIds()).toEqual([ADDRESS_B_ID])

    await undo('customers.addresses.update', logEntry, store)

    expect(store.primaryIds()).toEqual([ADDRESS_A_ID])
  })

  it('undo of an update redo restores the demoted primary as well', async () => {
    const store = makeStore([
      { id: ADDRESS_A_ID, isPrimary: true },
      { id: ADDRESS_B_ID, isPrimary: false },
    ])
    const input = { id: ADDRESS_B_ID, isPrimary: true }
    const logEntry = await run('customers.addresses.update', input, store)
    await undo('customers.addresses.update', logEntry, store)

    const redoLogEntry = await run('customers.addresses.update', input, store, logEntry)
    expect(store.primaryIds()).toEqual([ADDRESS_B_ID])

    await undo('customers.addresses.update', redoLogEntry, store)

    expect(store.primaryIds()).toEqual([ADDRESS_A_ID])
  })

  it('update undo re-creates a deleted address without restoring the demoted one', async () => {
    const store = makeStore([
      { id: ADDRESS_A_ID, isPrimary: true },
      { id: ADDRESS_B_ID, isPrimary: false },
    ])
    const logEntry = await run('customers.addresses.update', { id: ADDRESS_B_ID, isPrimary: true }, store)
    store.rows.delete(ADDRESS_B_ID)

    await undo('customers.addresses.update', logEntry, store)

    expect(store.rows.get(ADDRESS_B_ID)?.isPrimary).toBe(false)
    expect(store.primaryIds()).toEqual([])
  })

  it('undo of a create redo restores the demoted primary as well', async () => {
    const store = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])
    const logEntry = await run('customers.addresses.create', createInput(), store)
    await undo('customers.addresses.create', logEntry, store)

    const redoLogEntry = await run('customers.addresses.create', createInput(), store, logEntry)
    expect(store.primaryIds()).toEqual([ADDRESS_B_ID])

    await undo('customers.addresses.create', redoLogEntry, store)

    expect(store.rows.has(ADDRESS_B_ID)).toBe(false)
    expect(store.primaryIds()).toEqual([ADDRESS_A_ID])
  })

  it('keeps a primary chosen later instead of restoring the demoted one', async () => {
    const store = makeStore([
      { id: ADDRESS_A_ID, isPrimary: true },
      { id: ADDRESS_C_ID, isPrimary: false },
    ])
    const logEntry = await run('customers.addresses.create', createInput(), store)
    await run('customers.addresses.update', { id: ADDRESS_C_ID, isPrimary: true }, store)
    expect(store.primaryIds()).toEqual([ADDRESS_C_ID])

    await undo('customers.addresses.create', logEntry, store)

    expect(store.primaryIds()).toEqual([ADDRESS_C_ID])
  })

  it('does not fail or resurrect anything when the demoted address was deleted meanwhile', async () => {
    const store = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])
    const logEntry = await run('customers.addresses.create', createInput(), store)
    store.rows.delete(ADDRESS_A_ID)

    await undo('customers.addresses.create', logEntry, store)

    expect(store.rows.size).toBe(0)
    await expect(store.em.nativeUpdate.mock.results[1]?.value).resolves.toBe(0)
  })

  it('keeps the customer without a primary when the created address lost the flag before undo', async () => {
    const store = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])
    const logEntry = await run('customers.addresses.create', createInput(), store)
    store.rows.get(ADDRESS_B_ID)!.isPrimary = false

    await undo('customers.addresses.create', logEntry, store)

    expect(store.rows.has(ADDRESS_B_ID)).toBe(false)
    expect(store.primaryIds()).toEqual([])
  })

  it('leaves a demoted address alone once it belongs to another customer, tenant or organization', async () => {
    const moved = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])
    const movedLog = await run('customers.addresses.create', createInput(), moved)
    moved.rows.get(ADDRESS_A_ID)!.entityId = OTHER_PERSON_ID
    await undo('customers.addresses.create', movedLog, moved)
    expect(moved.rows.get(ADDRESS_A_ID)!.isPrimary).toBe(false)

    const foreign = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])
    const foreignLog = await run('customers.addresses.create', createInput(), foreign)
    foreign.rows.get(ADDRESS_A_ID)!.tenantId = OTHER_TENANT_ID
    await undo('customers.addresses.create', foreignLog, foreign)
    expect(foreign.rows.get(ADDRESS_A_ID)!.isPrimary).toBe(false)

    const otherOrg = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])
    const otherOrgLog = await run('customers.addresses.create', createInput(), otherOrg)
    otherOrg.rows.get(ADDRESS_A_ID)!.organizationId = OTHER_ORG_ID
    await undo('customers.addresses.create', otherOrgLog, otherOrg)
    expect(otherOrg.rows.get(ADDRESS_A_ID)!.isPrimary).toBe(false)
  })

  it('records nothing when no address was demoted and still undoes legacy log entries', async () => {
    const store = makeStore([{ id: ADDRESS_A_ID, isPrimary: false }])
    const logEntry = await run('customers.addresses.create', createInput(), store)
    expect(logEntry.commandPayload.undo).not.toHaveProperty('demotedPrimaryAddresses')
    await undo('customers.addresses.create', logEntry, store)
    expect(store.rows.has(ADDRESS_B_ID)).toBe(false)
    expect(store.primaryIds()).toEqual([])

    const legacy = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])
    const legacyLog = await run('customers.addresses.create', createInput(), legacy)
    const legacyUndo = { ...legacyLog.commandPayload.undo }
    delete legacyUndo.demotedPrimaryAddresses
    await undo(
      'customers.addresses.create',
      { ...legacyLog, commandPayload: { ...legacyLog.commandPayload, undo: legacyUndo } },
      legacy,
    )

    expect(legacy.rows.has(ADDRESS_B_ID)).toBe(false)
    expect(legacy.primaryIds()).toEqual([])
  })

  it('keeps an explicit "no primary" made after the promotion', async () => {
    const store = makeStore(
      [
        { id: ADDRESS_A_ID, isPrimary: true },
        { id: ADDRESS_B_ID, isPrimary: false },
      ],
      [ADDRESS_C_ID],
    )
    const promotion = await run('customers.addresses.update', { id: ADDRESS_B_ID, isPrimary: true }, store)
    await run('customers.addresses.create', createInput({ addressLine1: 'Line C' }), store)
    await run('customers.addresses.update', { id: ADDRESS_C_ID, isPrimary: false }, store)
    expect(store.primaryIds()).toEqual([])

    await undo('customers.addresses.update', promotion, store)

    expect(store.primaryIds()).toEqual([])
  })

  it('is a no-op when the created address is already gone', async () => {
    const store = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])
    const logEntry = await run('customers.addresses.create', createInput(), store)
    store.rows.delete(ADDRESS_B_ID)

    await undo('customers.addresses.create', logEntry, store)

    expect(store.primaryIds()).toEqual([])
    expect(store.em.begin).toHaveBeenCalledTimes(1)
  })

  it('restores every address a single operation demoted', async () => {
    const store = makeStore(
      [
        { id: ADDRESS_A_ID, isPrimary: true },
        { id: ADDRESS_C_ID, isPrimary: true },
      ],
      [ADDRESS_B_ID],
    )
    const logEntry = await run('customers.addresses.create', createInput(), store)
    expect(store.primaryIds()).toEqual([ADDRESS_B_ID])

    await undo('customers.addresses.create', logEntry, store)

    expect(store.primaryIds()).toEqual([ADDRESS_A_ID, ADDRESS_C_ID])
  })

  it('restores the primary of the customer an address was moved to, and of the one it came from', async () => {
    const store = makeStore([
      { id: ADDRESS_A_ID, isPrimary: true },
      { id: ADDRESS_B_ID, isPrimary: true, entityId: OTHER_PERSON_ID },
      { id: ADDRESS_D_ID, isPrimary: false, entityId: OTHER_PERSON_ID },
    ])
    const move = await run(
      'customers.addresses.update',
      { id: ADDRESS_B_ID, entityId: PERSON_ID, isPrimary: true },
      store,
    )
    expect(store.primaryIds()).toEqual([ADDRESS_B_ID])
    expect(store.primaryIds(OTHER_PERSON_ID)).toEqual([])

    await undo('customers.addresses.update', move, store)

    expect(store.primaryIds()).toEqual([ADDRESS_A_ID])
    expect(store.primaryIds(OTHER_PERSON_ID)).toEqual([ADDRESS_B_ID])
  })

  it('rolls the removal back when restoring the demoted address fails', async () => {
    const store = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])
    const logEntry = await run('customers.addresses.create', createInput(), store)
    store.em.count.mockRejectedValueOnce(new Error('count failed'))

    await expect(undo('customers.addresses.create', logEntry, store)).rejects.toThrow('count failed')

    expect(store.em.rollback).toHaveBeenCalledTimes(1)
    expect(store.rows.has(ADDRESS_B_ID)).toBe(true)
    expect(store.primaryIds()).toEqual([ADDRESS_B_ID])
  })

  it('restores the state from before the undone operation when undo runs out of order', async () => {
    const store = makeStore(
      [
        { id: ADDRESS_A_ID, isPrimary: true },
        { id: ADDRESS_B_ID, isPrimary: false },
      ],
      [ADDRESS_C_ID],
    )
    const promotion = await run('customers.addresses.update', { id: ADDRESS_B_ID, isPrimary: true }, store)
    const creation = await run('customers.addresses.create', createInput({ addressLine1: 'Line C' }), store)

    await undo('customers.addresses.update', promotion, store)
    expect(store.primaryIds()).toEqual([ADDRESS_C_ID])

    await undo('customers.addresses.create', creation, store)
    expect(store.primaryIds()).toEqual([ADDRESS_B_ID])
  })

  it('ignores malformed demotion entries in the log payload', async () => {
    const store = makeStore([{ id: ADDRESS_A_ID, isPrimary: true }])
    const logEntry = await run('customers.addresses.create', createInput(), store)
    const undoPayload = logEntry.commandPayload.undo
    expect(undoPayload.demotedPrimaryAddresses).toEqual([{ id: ADDRESS_A_ID, entityId: PERSON_ID }])

    await undo(
      'customers.addresses.create',
      {
        ...logEntry,
        commandPayload: {
          ...logEntry.commandPayload,
          undo: {
            ...undoPayload,
            demotedPrimaryAddresses: [null, 'x', { id: 7 }, { id: ADDRESS_A_ID }, { id: 'x', entityId: PERSON_ID }],
          },
        },
      },
      store,
    )

    expect(store.rows.has(ADDRESS_B_ID)).toBe(false)
    expect(store.primaryIds()).toEqual([])
    expect(store.em.nativeUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not add a second primary when the undone address keeps the flag', async () => {
    const store = makeStore([
      { id: ADDRESS_A_ID, isPrimary: true },
      { id: ADDRESS_B_ID, isPrimary: true },
    ])
    const logEntry = await run('customers.addresses.update', { id: ADDRESS_B_ID, addressLine1: 'Renamed' }, store)
    expect(logEntry.commandPayload.undo.demotedPrimaryAddresses).toEqual([{ id: ADDRESS_A_ID, entityId: PERSON_ID }])
    expect(store.primaryIds()).toEqual([ADDRESS_B_ID])

    await undo('customers.addresses.update', logEntry, store)

    expect(store.primaryIds()).toEqual([ADDRESS_B_ID])
  })
})
