export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '66666666-6666-4666-8666-666666666666'
const TENANT = '33333333-3333-4333-8333-333333333333'
const EUR_ID = '44444444-4444-4444-8444-444444444444'
const USD_ID = '55555555-5555-4555-8555-555555555555'
const GBP_ID = '77777777-7777-4777-8777-777777777777'
const PLN_ID = '88888888-8888-4888-8888-888888888888'
const NEW_ID = '99999999-9999-4999-8999-999999999999'

type Row = Record<string, unknown>
type CommandLog = {
  resourceId?: string | null
  payload?: unknown
  snapshotBefore?: unknown
  snapshotAfter?: unknown
  redoInput?: unknown
} | null
type Command = {
  prepare?: (input: Row, ctx: unknown) => Promise<Row>
  execute: (input: Row, ctx: unknown) => Promise<unknown>
  captureAfter?: (input: Row, result: unknown, ctx: unknown) => Promise<unknown>
  buildLog: (args: Row) => Promise<CommandLog>
  undo: (args: Row) => Promise<void>
  redo?: (args: Row) => Promise<unknown>
}
type LogEntry = {
  resourceId: string | null
  payload: unknown
  snapshotBefore: unknown
  snapshotAfter: unknown
  commandPayload: unknown
}

function loadCommands(): Record<'create' | 'update' | 'delete', Command> {
  const commands: Record<string, Command> = {}
  jest.isolateModules(() => {
    require('../currencies')
    for (const [cmd] of registerCommand.mock.calls) commands[cmd.id] = cmd
  })
  return {
    create: commands['currencies.currencies.create'],
    update: commands['currencies.currencies.update'],
    delete: commands['currencies.currencies.delete'],
  }
}

function matchesCondition(value: unknown, cond: unknown): boolean {
  if (cond === undefined) return true
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    const ops = cond as Record<string, unknown>
    if ('$ne' in ops && (value ?? null) === (ops.$ne ?? null)) return false
    if ('$in' in ops && !(ops.$in as unknown[]).includes(value)) return false
    if ('$nin' in ops && (ops.$nin as unknown[]).includes(value)) return false
    if ('$eq' in ops && (value ?? null) !== (ops.$eq ?? null)) return false
    return true
  }
  return (value ?? null) === (cond ?? null)
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where ?? {}).every(([key, cond]) => {
    if (key === '$or') return (cond as Row[]).some((branch) => matches(row, branch))
    if (key === '$and') return (cond as Row[]).every((branch) => matches(row, branch))
    return matchesCondition(row[key], cond)
  })
}

function makeCurrency(id: string, code: string, isBase: boolean, organizationId = ORG): Row {
  const now = new Date('2026-01-01T00:00:00Z')
  return {
    id, code, name: code, organizationId, tenantId: TENANT, symbol: null, decimalPlaces: 2,
    thousandsSeparator: null, decimalSeparator: null, isBase, isActive: true, deletedAt: null,
    createdAt: new Date(now.getTime() + code.charCodeAt(0)), updatedAt: now,
  }
}

function makeRate(fromCurrencyCode: string, toCurrencyCode: string): Row {
  return {
    id: `rate-${fromCurrencyCode}-${toCurrencyCode}`, organizationId: ORG, tenantId: TENANT,
    fromCurrencyCode, toCurrencyCode, isActive: true, deletedAt: null,
  }
}

type LockCall = { sql: string; params: unknown[]; inTransaction: boolean }

function buildEnv(currencies: Row[], rates: Row[] = []) {
  const locks: LockCall[] = []
  const organizations: Row[] = [{ id: ORG, tenant: { id: TENANT }, deletedAt: null }]
  let inTransaction = false
  const table = (entity: unknown): Row[] => {
    const name = (entity as { name?: string })?.name
    if (name === 'ExchangeRate') return rates
    if (name === 'Organization') return organizations
    return currencies
  }
  const em: Row = {
    findOne: jest.fn(async (entity: unknown, where: Row) => table(entity).find((row) => matches(row, where)) ?? null),
    find: jest.fn(async (entity: unknown, where: Row) => table(entity).filter((row) => matches(row, where))),
    count: jest.fn(async (entity: unknown, where: Row) => table(entity).filter((row) => matches(row, where)).length),
    create: jest.fn((_entity: unknown, payload: Row) => ({ id: NEW_ID, deletedAt: null, ...payload })),
    persist: jest.fn((row: Row) => {
      if (!currencies.includes(row)) currencies.push(row)
    }),
    nativeUpdate: jest.fn(async (entity: unknown, where: Row, data: Row) => {
      const hit = table(entity).filter((row) => matches(row, where))
      hit.forEach((row) => Object.assign(row, data))
      return hit.length
    }),
    flush: jest.fn(async () => undefined),
    execute: jest.fn(async (sql: string, params: unknown[] = []) => {
      locks.push({ sql: String(sql), params, inTransaction })
      return []
    }),
    isInTransaction: jest.fn(() => inTransaction),
    begin: jest.fn(async () => {
      inTransaction = true
    }),
    commit: jest.fn(async () => {
      inTransaction = false
    }),
    rollback: jest.fn(async () => {
      inTransaction = false
    }),
  }
  em.transactional = jest.fn(async (cb: (tx: Row) => Promise<unknown>) => {
    const wasInTransaction = inTransaction
    inTransaction = true
    try {
      return await cb(em)
    } finally {
      inTransaction = wasInTransaction
    }
  })
  em.fork = jest.fn(() => em)
  const dataEngine = {
    markOrmEntityChange: jest.fn(),
    emitEvent: jest.fn(),
    flushOrmEntityChanges: jest.fn(),
  }
  const ctx = {
    container: {
      resolve: jest.fn((token: string) => (token === 'em' ? em : token === 'dataEngine' ? dataEngine : undefined)),
    },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: null,
  }
  return { em, ctx, locks }
}

async function run(command: Command, input: Row, ctx: unknown, redoOf?: LogEntry): Promise<LogEntry> {
  const prepared = command.prepare ? await command.prepare(input, ctx) : {}
  const result = redoOf && typeof command.redo === 'function'
    ? await command.redo({ input, ctx, logEntry: redoOf })
    : await command.execute(input, ctx)
  const after = command.captureAfter ? await command.captureAfter(input, result, ctx) : undefined
  const log = await command.buildLog({ input, result, ctx, snapshots: { ...prepared, after } })
  return {
    resourceId: log?.resourceId ?? null,
    payload: log?.payload,
    snapshotBefore: log?.snapshotBefore,
    snapshotAfter: log?.snapshotAfter,
    commandPayload: {
      __redoInput: log?.redoInput !== undefined ? log.redoInput : input,
      ...((log?.payload as Row | undefined) ?? {}),
    },
  }
}

async function redoUpdate(command: Command, logEntry: LogEntry, ctx: unknown): Promise<LogEntry> {
  return run(command, (logEntry.commandPayload as Row).__redoInput as Row, ctx)
}

async function undo(command: Command, logEntry: LogEntry, ctx: unknown): Promise<void> {
  await command.undo({ input: logEntry.commandPayload, logEntry, ctx })
}

function liveBases(rows: Row[], organizationId = ORG): string[] {
  return rows
    .filter((row) => !row.deletedAt && row.isBase && row.organizationId === organizationId)
    .map((row) => row.code)
    .sort()
}

async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
  let caught: unknown = null
  try {
    await promise
  } catch (err) {
    caught = err
  }
  expect(caught).not.toBeNull()
  expect((caught as { status?: number }).status).toBe(status)
}

describe('currencies base-currency invariant (exactly one live base per tenant/organization)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('create-as-base: undo restores the demoted base, redo re-demotes it, undo again restores it', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true)]
    const { ctx } = buildEnv(rows)
    const { create } = loadCommands()
    const input = { organizationId: ORG, tenantId: TENANT, code: 'USD', name: 'US Dollar', isBase: true }

    const createLog = await run(create, input, ctx)
    expect(liveBases(rows)).toEqual(['USD'])

    await undo(create, createLog, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])
    expect(rows.find((row) => row.code === 'USD')?.deletedAt).toBeTruthy()

    const redoLog = await run(create, input, ctx, createLog)
    expect(liveBases(rows)).toEqual(['USD'])

    await undo(create, redoLog, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])
  })

  it('promote: undo restores the previous base and a redo (re-execute) can be undone again', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true), makeCurrency(USD_ID, 'USD', false)]
    const { ctx } = buildEnv(rows)
    const { update } = loadCommands()

    const promoteLog = await run(update, { id: USD_ID, isBase: true }, ctx)
    expect(liveBases(rows)).toEqual(['USD'])

    await undo(update, promoteLog, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])

    const redoLog = await redoUpdate(update, promoteLog, ctx)
    expect(liveBases(rows)).toEqual(['USD'])

    await undo(update, redoLog, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])
  })

  it('undo is idempotent when replayed', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true), makeCurrency(USD_ID, 'USD', false)]
    const { ctx } = buildEnv(rows)
    const { create, update } = loadCommands()

    const promoteLog = await run(update, { id: USD_ID, isBase: true }, ctx)
    await undo(update, promoteLog, ctx)
    await undo(update, promoteLog, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])

    const createLog = await run(create, { organizationId: ORG, tenantId: TENANT, code: 'GBP', name: 'Pound', isBase: true }, ctx)
    await undo(create, createLog, ctx)
    await undo(create, createLog, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])
  })

  it('redo of a rename that sent isBase:true does not re-promote a currency that lost the base since', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true), makeCurrency(USD_ID, 'USD', false)]
    const { ctx } = buildEnv(rows)
    const { update } = loadCommands()

    const renameLog = await run(update, { id: EUR_ID, name: 'Euro renamed', isBase: true }, ctx)
    await run(update, { id: USD_ID, isBase: true }, ctx)
    await undo(update, renameLog, ctx)
    expect(liveBases(rows)).toEqual(['USD'])

    await redoUpdate(update, renameLog, ctx)
    expect(liveBases(rows)).toEqual(['USD'])
    expect(rows.find((row) => row.id === EUR_ID)?.name).toBe('Euro renamed')
  })

  it('redo of a rename that sent isBase:false succeeds after the currency became the base', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true), makeCurrency(USD_ID, 'USD', false)]
    const { ctx } = buildEnv(rows)
    const { update } = loadCommands()

    const renameLog = await run(update, { id: USD_ID, name: 'Dollar', isBase: false }, ctx)
    await undo(update, renameLog, ctx)
    await run(update, { id: USD_ID, isBase: true }, ctx)

    await redoUpdate(update, renameLog, ctx)
    expect(liveBases(rows)).toEqual(['USD'])
    expect(rows.find((row) => row.id === USD_ID)?.name).toBe('Dollar')
  })

  it('restores the first recorded predecessor that is still live', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', false), makeCurrency(GBP_ID, 'GBP', false), makeCurrency(USD_ID, 'USD', true)]
    const { ctx } = buildEnv(rows)
    const { update, delete: remove } = loadCommands()
    const snapshot = (id: string, code: string, isBase: boolean) => ({
      ...makeCurrency(id, code, isBase),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const payload = {
      undo: {
        before: snapshot(USD_ID, 'USD', false),
        after: snapshot(USD_ID, 'USD', true),
        base: { promoted: true, demotedBaseCurrencyIds: [EUR_ID, GBP_ID] },
      },
    }
    const logEntry: LogEntry = {
      resourceId: USD_ID,
      payload,
      snapshotBefore: snapshot(USD_ID, 'USD', false),
      snapshotAfter: snapshot(USD_ID, 'USD', true),
      commandPayload: { __redoInput: { id: USD_ID, isBase: true }, ...payload },
    }
    await run(remove, { id: EUR_ID, organizationId: ORG, tenantId: TENANT }, ctx)

    await undo(update, logEntry, ctx)
    expect(liveBases(rows)).toEqual(['GBP'])
  })

  it('undo of a legacy log that cleared the base re-promotes it only when the organization has no base', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', false), makeCurrency(USD_ID, 'USD', false)]
    const { ctx } = buildEnv(rows)
    const { update } = loadCommands()
    const snapshot = (isBase: boolean) => ({
      ...makeCurrency(EUR_ID, 'EUR', isBase),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const logEntry: LogEntry = {
      resourceId: EUR_ID,
      payload: { undo: { before: snapshot(true), after: snapshot(false) } },
      snapshotBefore: snapshot(true),
      snapshotAfter: snapshot(false),
      commandPayload: { id: EUR_ID, isBase: false },
    }

    await undo(update, logEntry, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])

    rows.forEach((row) => { row.isBase = row.id === USD_ID })
    await undo(update, logEntry, ctx)
    expect(liveBases(rows)).toEqual(['USD'])
  })

  it('refuses a legacy promotion log without recorded predecessors while the record is still the base', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', false), makeCurrency(USD_ID, 'USD', true)]
    const { ctx } = buildEnv(rows)
    const { update } = loadCommands()
    const snapshot = (isBase: boolean) => ({
      ...makeCurrency(USD_ID, 'USD', isBase),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const logEntry: LogEntry = {
      resourceId: USD_ID,
      payload: { undo: { before: snapshot(false), after: snapshot(true) } },
      snapshotBefore: snapshot(false),
      snapshotAfter: snapshot(true),
      commandPayload: { id: USD_ID, isBase: true },
    }

    await expectStatus(undo(update, logEntry, ctx), 409)
    expect(liveBases(rows)).toEqual(['USD'])
  })

  it('stale undo of an older promotion leaves the newer base alone', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true), makeCurrency(USD_ID, 'USD', false), makeCurrency(GBP_ID, 'GBP', false)]
    const { ctx } = buildEnv(rows)
    const { update } = loadCommands()

    const promoteUsd = await run(update, { id: USD_ID, isBase: true, name: 'Dollar' }, ctx)
    await run(update, { id: GBP_ID, isBase: true }, ctx)
    expect(liveBases(rows)).toEqual(['GBP'])

    await undo(update, promoteUsd, ctx)
    expect(liveBases(rows)).toEqual(['GBP'])
    expect(rows.find((row) => row.id === USD_ID)?.name).toBe('USD')
  })

  it('refuses to undo a promotion when the previous base no longer exists, keeping the current base', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true), makeCurrency(USD_ID, 'USD', false)]
    const { ctx } = buildEnv(rows)
    const { update, delete: remove } = loadCommands()

    const promoteLog = await run(update, { id: USD_ID, isBase: true }, ctx)
    await run(remove, { id: EUR_ID, organizationId: ORG, tenantId: TENANT }, ctx)
    expect(liveBases(rows)).toEqual(['USD'])

    await expectStatus(undo(update, promoteLog, ctx), 409)
    expect(liveBases(rows)).toEqual(['USD'])
  })

  it('refuses to undo creating the first base currency of a scope', async () => {
    const rows: Row[] = [makeCurrency(USD_ID, 'USD', false)]
    const { ctx } = buildEnv(rows)
    const { create } = loadCommands()

    const createLog = await run(create, { organizationId: ORG, tenantId: TENANT, code: 'EUR', name: 'Euro', isBase: true }, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])

    await expectStatus(undo(create, createLog, ctx), 409)
    expect(liveBases(rows)).toEqual(['EUR'])
  })

  it('refuses to undo creating a currency that was promoted to base afterwards', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true)]
    const { ctx } = buildEnv(rows)
    const { create, update } = loadCommands()

    const createLog = await run(create, { organizationId: ORG, tenantId: TENANT, code: 'USD', name: 'US Dollar' }, ctx)
    await run(update, { id: NEW_ID, isBase: true }, ctx)
    expect(liveBases(rows)).toEqual(['USD'])

    await expectStatus(undo(create, createLog, ctx), 409)
    expect(liveBases(rows)).toEqual(['USD'])
  })

  it('undo of an update that did not change isBase never re-promotes the record', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true), makeCurrency(USD_ID, 'USD', false)]
    const { ctx } = buildEnv(rows)
    const { update } = loadCommands()

    const renameLog = await run(update, { id: EUR_ID, name: 'Euro renamed' }, ctx)
    await run(update, { id: USD_ID, isBase: true }, ctx)
    expect(liveBases(rows)).toEqual(['USD'])

    await undo(update, renameLog, ctx)
    expect(liveBases(rows)).toEqual(['USD'])
    expect(rows.find((row) => row.id === EUR_ID)?.name).toBe('EUR')
  })

  it('rejects clearing isBase on the current base currency', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true), makeCurrency(USD_ID, 'USD', false)]
    const { ctx } = buildEnv(rows)
    const { update } = loadCommands()

    await expectStatus(run(update, { id: EUR_ID, isBase: false }, ctx), 400)
    expect(liveBases(rows)).toEqual(['EUR'])
  })

  it('still allows saving the base currency with isBase:true and other changes', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true)]
    const { ctx } = buildEnv(rows)
    const { update } = loadCommands()

    await run(update, { id: EUR_ID, isBase: true, name: 'Euro (base)' }, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])
    expect(rows[0].name).toBe('Euro (base)')
  })

  it('refuses to undo creating a currency that active exchange rates now reference', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true)]
    const rates: Row[] = []
    const { ctx } = buildEnv(rows, rates)
    const { create } = loadCommands()

    const createLog = await run(create, { organizationId: ORG, tenantId: TENANT, code: 'USD', name: 'US Dollar' }, ctx)
    rates.push(makeRate('USD', 'EUR'))

    await expectStatus(undo(create, createLog, ctx), 409)
    expect(rows.find((row) => row.code === 'USD')?.deletedAt).toBeFalsy()
  })

  it('still refuses deleting the base currency', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true)]
    const { ctx } = buildEnv(rows)
    const { delete: remove } = loadCommands()

    await expectStatus(run(remove, { id: EUR_ID, organizationId: ORG, tenantId: TENANT }, ctx), 400)
    expect(liveBases(rows)).toEqual(['EUR'])
  })

  it('delete undo of a non-base currency restores it without touching the base', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true), makeCurrency(USD_ID, 'USD', false)]
    const { ctx } = buildEnv(rows)
    const { delete: remove } = loadCommands()

    const deleteLog = await run(remove, { id: USD_ID, organizationId: ORG, tenantId: TENANT }, ctx)
    expect(rows.find((row) => row.id === USD_ID)?.deletedAt).toBeTruthy()

    await undo(remove, deleteLog, ctx)
    expect(rows.find((row) => row.id === USD_ID)?.deletedAt).toBeFalsy()
    expect(liveBases(rows)).toEqual(['EUR'])
  })

  it('delete undo revives a legacy base row as non-base when another base exists', async () => {
    const legacy = { ...makeCurrency(USD_ID, 'USD', true), deletedAt: new Date('2026-02-01T00:00:00Z'), isActive: false }
    const rows = [makeCurrency(EUR_ID, 'EUR', true), legacy]
    const { ctx } = buildEnv(rows)
    const { delete: remove } = loadCommands()
    const before = { ...makeCurrency(USD_ID, 'USD', false), createdAt: (legacy.createdAt as Date).toISOString(), updatedAt: (legacy.updatedAt as Date).toISOString() }
    const logEntry: LogEntry = {
      resourceId: USD_ID,
      payload: { undo: { before } },
      snapshotBefore: before,
      snapshotAfter: null,
      commandPayload: { id: USD_ID },
    }

    await undo(remove, logEntry, ctx)
    expect(legacy.deletedAt).toBeFalsy()
    expect(liveBases(rows)).toEqual(['EUR'])
  })

  it('keeps base changes inside the record organization', async () => {
    const rows = [
      makeCurrency(EUR_ID, 'EUR', true),
      makeCurrency(USD_ID, 'USD', false),
      makeCurrency(PLN_ID, 'PLN', true, OTHER_ORG),
    ]
    const { ctx } = buildEnv(rows)
    const { update, create } = loadCommands()

    const promoteLog = await run(update, { id: USD_ID, isBase: true }, ctx)
    expect(liveBases(rows, OTHER_ORG)).toEqual(['PLN'])
    await undo(update, promoteLog, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])
    expect(liveBases(rows, OTHER_ORG)).toEqual(['PLN'])

    const createLog = await run(create, { organizationId: ORG, tenantId: TENANT, code: 'GBP', name: 'Pound', isBase: true }, ctx)
    expect(liveBases(rows)).toEqual(['GBP'])
    expect(liveBases(rows, OTHER_ORG)).toEqual(['PLN'])
    await undo(create, createLog, ctx)
    expect(liveBases(rows)).toEqual(['EUR'])
    expect(liveBases(rows, OTHER_ORG)).toEqual(['PLN'])
  })

  it('takes the per-organization base-currency lock inside a transaction for every write, undo and redo', async () => {
    const rows = [makeCurrency(EUR_ID, 'EUR', true), makeCurrency(USD_ID, 'USD', false)]
    const { ctx, locks } = buildEnv(rows)
    const { create, update, delete: remove } = loadCommands()
    const steps: Array<[string, () => Promise<unknown>]> = []
    let createLog: LogEntry | null = null
    let promoteLog: LogEntry | null = null
    let deleteLog: LogEntry | null = null
    const createInput = { organizationId: ORG, tenantId: TENANT, code: 'GBP', name: 'Pound', isBase: true }
    steps.push(['create', async () => { createLog = await run(create, createInput, ctx) }])
    steps.push(['create.undo', async () => undo(create, createLog!, ctx)])
    steps.push(['create.redo', async () => { createLog = await run(create, createInput, ctx, createLog!) }])
    steps.push(['create.undo-after-redo', async () => undo(create, createLog!, ctx)])
    steps.push(['update', async () => { promoteLog = await run(update, { id: USD_ID, isBase: true }, ctx) }])
    steps.push(['update.undo', async () => undo(update, promoteLog!, ctx)])
    steps.push(['delete', async () => { deleteLog = await run(remove, { id: USD_ID, organizationId: ORG, tenantId: TENANT }, ctx) }])
    steps.push(['delete.undo', async () => undo(remove, deleteLog!, ctx)])

    for (const [label, step] of steps) {
      const before = locks.length
      await step()
      const taken = locks.slice(before).filter((call) => /pg_advisory_xact_lock/.test(call.sql))
      expect({ label, taken: taken.length > 0 }).toEqual({ label, taken: true })
      for (const call of taken) {
        expect({ label, inTransaction: call.inTransaction }).toEqual({ label, inTransaction: true })
        const key = JSON.stringify(call.params)
        expect(key).toContain(TENANT)
        expect(key).toContain(ORG)
      }
    }
    expect(liveBases(rows)).toEqual(['EUR'])
  })
})
