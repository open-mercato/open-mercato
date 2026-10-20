jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string, params?: Record<string, string>) =>
      (fallback ?? _key).replace(/\{(\w+)\}/g, (_m, k) => String(params?.[k] ?? `{${k}}`)),
  }),
}))

// The line read goes through `findOneWithDecryption` (the ledger line has an
// encrypted column); decryption itself is not under test here, so the helper
// delegates straight to the fake em's `findOne`.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (em: any, entity: unknown, where: unknown, options: unknown) =>
    em.findOne(entity, where, options),
}))

import { LockMode } from '@mikro-orm/core'
import { asValue, createContainer, InjectionMode } from 'awilix'
import '../setJournalEntryLineDimension'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { JournalEntryLineDimension } from '../../data/entities'
import { FiscalPeriod, JournalEntry, JournalEntryLine } from '../../../ledger/data/entities'
import { setJournalEntryLineDimensionSchema } from '../../data/validators'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const ORG_A = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const LINE_1 = '55555555-5555-4555-8555-555555555555'
const ENTRY_1 = '66666666-6666-4666-8666-666666666666'

const OPERATION_DATE = new Date('2026-03-15')

type DimensionRow = {
  id: string
  journalEntryLineId: string
  dimensionType: string
  dimensionId: string
  writer: string
  tenantId: string
  organizationId: string
  createdAt: Date
}

type LineRow = { id: string; journalEntryId: string; tenantId: string; organizationId: string }
type EntryRow = { id: string; operationDate: Date; tenantId: string; organizationId: string }
type PeriodRow = {
  id: string
  startDate: Date
  endDate: Date
  isLocked: boolean
  tenantId: string
  organizationId: string
}

let nextId = 1
function freshId(): string {
  nextId += 1
  return `generated-${nextId}`
}

function dimRow(dimensionType: string, dimensionId: string, writer: string, tenantId = TENANT_A, organizationId = ORG_A): DimensionRow {
  return {
    id: freshId(),
    journalEntryLineId: LINE_1,
    dimensionType,
    dimensionId,
    writer,
    tenantId,
    organizationId,
    createdAt: new Date(),
  }
}

function defaultLines(): LineRow[] {
  return [{ id: LINE_1, journalEntryId: ENTRY_1, tenantId: TENANT_A, organizationId: ORG_A }]
}

function defaultEntries(): EntryRow[] {
  return [{ id: ENTRY_1, operationDate: OPERATION_DATE, tenantId: TENANT_A, organizationId: ORG_A }]
}

function periodFor(isLocked: boolean): PeriodRow {
  return {
    id: 'period-1',
    startDate: new Date('2026-03-01'),
    endDate: new Date('2026-03-31'),
    isLocked,
    tenantId: TENANT_A,
    organizationId: ORG_A,
  }
}

/**
 * A minimal fake `EntityManager` covering exactly the surface this command
 * touches: `findOne` (line, entry, covering fiscal period), `find` (the
 * pair's rows), `nativeDelete` + raw `execute` (advisory lock and insert),
 * and the transaction lifecycle `withAtomicFlush` drives. `begin` snapshots
 * the dimension rows and `rollback` restores them, so a rollback test can
 * assert the delete was undone. No `getUnitOfWork`, so `withAtomicFlush`'s
 * commit-boundary guard treats pending changes as "unknown" and no-ops (same
 * as the partial EMs other command unit tests in this codebase use).
 */
function makeFakeEm(opts: {
  lines?: LineRow[]
  entries?: EntryRow[]
  periods?: PeriodRow[]
  dimensionRows?: DimensionRow[]
  failInsert?: boolean
}) {
  const lines = opts.lines ?? defaultLines()
  const entries = opts.entries ?? defaultEntries()
  const periods = opts.periods ?? [periodFor(false)]
  const dimensionRows = opts.dimensionRows ?? []
  const calls: string[] = []
  let snapshot: DimensionRow[] | null = null

  const sameScope = (row: { tenantId: string; organizationId: string }, where: Record<string, unknown>) =>
    row.tenantId === where.tenantId && row.organizationId === where.organizationId

  const em: any = {
    fork: jest.fn(),
    isInTransaction: jest.fn(() => snapshot !== null),
    begin: jest.fn(async () => {
      snapshot = dimensionRows.map((row) => ({ ...row }))
    }),
    commit: jest.fn(async () => {
      snapshot = null
    }),
    rollback: jest.fn(async () => {
      if (snapshot) {
        dimensionRows.length = 0
        dimensionRows.push(...snapshot)
      }
      snapshot = null
    }),
    flush: jest.fn(async () => undefined),
    findOne: jest.fn(async (ctor: unknown, where: Record<string, any>) => {
      if (ctor === JournalEntryLine) {
        return lines.find((l) => l.id === where.id && sameScope(l, where)) ?? null
      }
      if (ctor === JournalEntry) {
        return entries.find((e) => e.id === where.id && sameScope(e, where)) ?? null
      }
      if (ctor === FiscalPeriod) {
        calls.push('period')
        return (
          periods.find(
            (p) =>
              sameScope(p, where) &&
              p.startDate <= where.startDate.$lte &&
              p.endDate >= where.endDate.$gte,
          ) ?? null
        )
      }
      return null
    }),
    find: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor !== JournalEntryLineDimension) return []
      return dimensionRows.filter(
        (row) =>
          row.journalEntryLineId === where.journalEntryLineId &&
          row.dimensionType === where.dimensionType &&
          sameScope(row, where),
      )
    }),
    nativeDelete: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor !== JournalEntryLineDimension) return 0
      calls.push('delete')
      const before = dimensionRows.length
      const kept = dimensionRows.filter(
        (row) =>
          !(
            row.journalEntryLineId === where.journalEntryLineId &&
            row.dimensionType === where.dimensionType &&
            sameScope(row, where)
          ),
      )
      dimensionRows.length = 0
      dimensionRows.push(...kept)
      return before - dimensionRows.length
    }),
    execute: jest.fn(async (sql: string, params: unknown[]) => {
      if (/pg_advisory_xact_lock/i.test(sql)) {
        calls.push('lock')
        return []
      }
      if (!/insert into journal_entry_line_dimensions/i.test(sql)) return []
      if (opts.failInsert) throw new Error('insert failed')
      calls.push('insert')
      const [journalEntryLineId, dimensionType, dimensionId, writer, tenantId, organizationId] = params as string[]
      const conflict = dimensionRows.some(
        (row) =>
          row.journalEntryLineId === journalEntryLineId &&
          row.dimensionType === dimensionType &&
          row.dimensionId === dimensionId &&
          row.tenantId === tenantId &&
          row.organizationId === organizationId,
      )
      if (!conflict) {
        dimensionRows.push({
          id: freshId(),
          journalEntryLineId,
          dimensionType,
          dimensionId,
          writer,
          tenantId,
          organizationId,
          createdAt: new Date(),
        })
      }
      return []
    }),
  }
  em.fork.mockReturnValue(em)
  return { em, dimensionRows, calls }
}

function makeCtx(em: any, tenantId: string, organizationId: string): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return em
        throw new Error(`Unexpected DI token: ${token}`)
      },
    } as any,
    auth: { sub: 'user-1', tenantId, orgId: organizationId } as any,
    selectedOrganizationId: organizationId,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

async function withStrictOrganizationScope<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.OM_ENFORCE_ORG_SCOPE_STRICT
  process.env.OM_ENFORCE_ORG_SCOPE_STRICT = 'true'
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.OM_ENFORCE_ORG_SCOPE_STRICT
    else process.env.OM_ENFORCE_ORG_SCOPE_STRICT = previous
  }
}

function getHandler(): CommandHandler {
  const handler = commandRegistry.get('journal_entry_line_dimensions.dimensions.set')
  if (!handler) throw new Error('command not registered')
  return handler
}

const baseInput = {
  journalEntryLineId: LINE_1,
  dimensionType: 'CostCenter',
  writer: 'posting_rules',
  dimensionIds: ['cc-new'],
}

describe('journal_entry_line_dimensions.dimensions.set', () => {
  it('replaces only the rows for the given (journalEntryLineId, dimensionType) pair, leaving another type on the same line untouched', async () => {
    const { em, dimensionRows } = makeFakeEm({
      dimensionRows: [dimRow('BankAccount', 'bank-1', 'posting_rules'), dimRow('CostCenter', 'cc-old', 'posting_rules')],
    })

    await getHandler().execute(baseInput, makeCtx(em, TENANT_A, ORG_A))

    expect(dimensionRows.filter((r) => r.dimensionType === 'BankAccount').map((r) => r.dimensionId)).toEqual(['bank-1'])
    expect(dimensionRows.filter((r) => r.dimensionType === 'CostCenter').map((r) => r.dimensionId)).toEqual(['cc-new'])
  })

  it('is content-idempotent: calling it twice with the same dimensionIds leaves one row per id, not two', async () => {
    const { em, dimensionRows } = makeFakeEm({})
    const handler = getHandler()
    const ctx = makeCtx(em, TENANT_A, ORG_A)

    await handler.execute(baseInput, ctx)
    await handler.execute(baseInput, ctx)

    expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-new'])
  })

  it('stores the input writer on every inserted row', async () => {
    const { em, dimensionRows } = makeFakeEm({})

    await getHandler().execute({ ...baseInput, writer: 'fixed_assets', dimensionIds: ['cc-1', 'cc-2'] }, makeCtx(em, TENANT_A, ORG_A))

    expect(dimensionRows.map((r) => r.writer)).toEqual(['fixed_assets', 'fixed_assets'])
  })

  it('undo restores exactly the pre-replace rows for that pair', async () => {
    const { em, dimensionRows } = makeFakeEm({ dimensionRows: [dimRow('CostCenter', 'cc-old', 'posting_rules')] })
    const handler = getHandler()
    const ctx = makeCtx(em, TENANT_A, ORG_A)

    const prepared = await handler.prepare!(baseInput, ctx)
    const result = await handler.execute(baseInput, ctx)
    const log = await handler.buildLog!({ input: baseInput, result, snapshots: { before: prepared?.before }, ctx })
    expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-new'])

    await handler.undo!({ input: baseInput, ctx, logEntry: { payload: log!.payload } as unknown as CommandUndoLogEntry })

    expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-old'])
    expect(dimensionRows.map((r) => r.writer)).toEqual(['posting_rules'])
  })

  it('a direct consumer-style read scopes rows to the correct tenantId/organizationId — a row from another tenant never leaks', async () => {
    const { em } = makeFakeEm({
      lines: [...defaultLines(), { id: LINE_1, journalEntryId: ENTRY_1, tenantId: TENANT_B, organizationId: ORG_B }],
      dimensionRows: [
        dimRow('CostCenter', 'cc-tenant-a', 'posting_rules'),
        dimRow('CostCenter', 'cc-tenant-b', 'posting_rules', TENANT_B, ORG_B),
      ],
    })

    const prepared = await getHandler().prepare!(baseInput, makeCtx(em, TENANT_A, ORG_A))

    expect(prepared?.before).toEqual(['cc-tenant-a'])
  })

  describe('line existence', () => {
    it('rejects a journal entry line that does not exist or belongs to another tenant, writing nothing', async () => {
      const { em, dimensionRows } = makeFakeEm({
        lines: [{ id: LINE_1, journalEntryId: ENTRY_1, tenantId: TENANT_B, organizationId: ORG_B }],
      })

      await expect(getHandler().execute(baseInput, makeCtx(em, TENANT_A, ORG_A))).rejects.toMatchObject({ status: 404 })
      expect(dimensionRows).toEqual([])
    })
  })

  describe('frozen fiscal period', () => {
    it('accepts a write when the covering period is unlocked', async () => {
      const { em, dimensionRows } = makeFakeEm({ periods: [periodFor(false)] })

      await getHandler().execute(baseInput, makeCtx(em, TENANT_A, ORG_A))

      expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-new'])
    })

    it('rejects a write when the covering period is locked, leaving the rows untouched', async () => {
      const { em, dimensionRows } = makeFakeEm({
        periods: [periodFor(true)],
        dimensionRows: [dimRow('CostCenter', 'cc-old', 'posting_rules')],
      })

      await expect(getHandler().execute(baseInput, makeCtx(em, TENANT_A, ORG_A))).rejects.toMatchObject({ status: 422 })
      expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-old'])
    })

    it('rejects a write when no fiscal period covers the entry operationDate', async () => {
      const { em, dimensionRows } = makeFakeEm({ periods: [] })

      await expect(getHandler().execute(baseInput, makeCtx(em, TENANT_A, ORG_A))).rejects.toMatchObject({ status: 422 })
      expect(dimensionRows).toEqual([])
    })

    it('rejects an undo once the period has been locked', async () => {
      const periods = [periodFor(false)]
      const { em, dimensionRows } = makeFakeEm({ periods, dimensionRows: [dimRow('CostCenter', 'cc-old', 'posting_rules')] })
      const handler = getHandler()
      const ctx = makeCtx(em, TENANT_A, ORG_A)

      const prepared = await handler.prepare!(baseInput, ctx)
      const result = await handler.execute(baseInput, ctx)
      const log = await handler.buildLog!({ input: baseInput, result, snapshots: { before: prepared?.before }, ctx })
      periods[0].isLocked = true

      await expect(
        handler.undo!({ input: baseInput, ctx, logEntry: { payload: log!.payload } as unknown as CommandUndoLogEntry }),
      ).rejects.toMatchObject({ status: 422 })
      expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-new'])
    })

    it('reads the covering period with a PESSIMISTIC_READ (for share) lock, inside the write transaction', async () => {
      const { em } = makeFakeEm({})

      await getHandler().execute(baseInput, makeCtx(em, TENANT_A, ORG_A))

      const periodCall = em.findOne.mock.calls.find(([ctor]: [unknown]) => ctor === FiscalPeriod)
      expect(periodCall?.[2]).toEqual({ lockMode: LockMode.PESSIMISTIC_READ })
      expect(em.begin.mock.invocationCallOrder[0]).toBeLessThan(
        em.findOne.mock.invocationCallOrder[em.findOne.mock.calls.findIndex(([ctor]: [unknown]) => ctor === FiscalPeriod)],
      )
    })
  })

  describe('writer ownership', () => {
    it('rejects a write by a different writer to an already-tagged pair, leaving the rows untouched', async () => {
      const { em, dimensionRows } = makeFakeEm({ dimensionRows: [dimRow('CostCenter', 'cc-pr', 'posting_rules')] })

      await expect(
        getHandler().execute({ ...baseInput, writer: 'fixed_assets', dimensionIds: ['cc-fa'] }, makeCtx(em, TENANT_A, ORG_A)),
      ).rejects.toMatchObject({ status: 409 })
      expect(dimensionRows.map((r) => [r.dimensionId, r.writer])).toEqual([['cc-pr', 'posting_rules']])
    })

    it('lets the same writer replace its own rows', async () => {
      const { em, dimensionRows } = makeFakeEm({ dimensionRows: [dimRow('CostCenter', 'cc-pr', 'posting_rules')] })

      await getHandler().execute({ ...baseInput, dimensionIds: ['cc-pr-2'] }, makeCtx(em, TENANT_A, ORG_A))

      expect(dimensionRows.map((r) => [r.dimensionId, r.writer])).toEqual([['cc-pr-2', 'posting_rules']])
    })

    it('lets a writer claim an untagged pair', async () => {
      const { em, dimensionRows } = makeFakeEm({})

      await getHandler().execute({ ...baseInput, writer: 'fixed_assets' }, makeCtx(em, TENANT_A, ORG_A))

      expect(dimensionRows.map((r) => r.writer)).toEqual(['fixed_assets'])
    })

    it('rejects an undo over rows another writer has since claimed', async () => {
      const { em, dimensionRows } = makeFakeEm({ dimensionRows: [dimRow('CostCenter', 'cc-old', 'posting_rules')] })
      const handler = getHandler()
      const ctx = makeCtx(em, TENANT_A, ORG_A)
      const prepared = await handler.prepare!(baseInput, ctx)
      const result = await handler.execute(baseInput, ctx)
      const log = await handler.buildLog!({ input: baseInput, result, snapshots: { before: prepared?.before }, ctx })
      dimensionRows.length = 0
      dimensionRows.push(dimRow('CostCenter', 'cc-fa', 'fixed_assets'))

      await expect(
        handler.undo!({ input: baseInput, ctx, logEntry: { payload: log!.payload } as unknown as CommandUndoLogEntry }),
      ).rejects.toMatchObject({ status: 409 })
      expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-fa'])
    })
  })

  describe('system actor scope (ctx.auth: null)', () => {
    const systemCtx = (em: any): CommandRuntimeContext => ({
      ...makeCtx(em, TENANT_A, ORG_A),
      auth: null,
      selectedOrganizationId: null,
    })

    it('falls back to the input tenantId/organizationId when ctx carries no auth', async () => {
      const { em, dimensionRows } = makeFakeEm({})

      await getHandler().execute({ ...baseInput, tenantId: TENANT_A, organizationId: ORG_A }, systemCtx(em))

      expect(dimensionRows.map((r) => [r.dimensionId, r.tenantId, r.organizationId])).toEqual([['cc-new', TENANT_A, ORG_A]])
    })

    it('rejects a call that has neither ctx auth nor an input scope', async () => {
      const { em, dimensionRows } = makeFakeEm({})

      await expect(getHandler().execute(baseInput, systemCtx(em))).rejects.toMatchObject({ status: 404 })
      expect(dimensionRows).toEqual([])
    })

    it('lets a system actor whose ctx selects the same organization pass OM_ENFORCE_ORG_SCOPE_STRICT', async () => {
      const { em, dimensionRows } = makeFakeEm({})
      const ctx: CommandRuntimeContext = { ...systemCtx(em), selectedOrganizationId: ORG_A }

      await withStrictOrganizationScope(() =>
        getHandler().execute({ ...baseInput, tenantId: TENANT_A, organizationId: ORG_A }, ctx),
      )

      expect(dimensionRows.map((r) => [r.tenantId, r.organizationId])).toEqual([[TENANT_A, ORG_A]])
    })

    it('rejects a system actor whose input organization differs from the ctx-selected one, writing nothing', async () => {
      const { em, dimensionRows } = makeFakeEm({})
      const ctx: CommandRuntimeContext = { ...systemCtx(em), selectedOrganizationId: ORG_B }

      await expect(
        getHandler().execute({ ...baseInput, tenantId: TENANT_A, organizationId: ORG_A }, ctx),
      ).rejects.toMatchObject({ status: 403 })
      expect(dimensionRows).toEqual([])
    })

    it('under OM_ENFORCE_ORG_SCOPE_STRICT rejects a system actor that selects no organization in ctx', async () => {
      const { em, dimensionRows } = makeFakeEm({})

      await expect(
        withStrictOrganizationScope(() =>
          getHandler().execute({ ...baseInput, tenantId: TENANT_A, organizationId: ORG_A }, systemCtx(em)),
        ),
      ).rejects.toMatchObject({ status: 403 })
      expect(dimensionRows).toEqual([])
    })
  })

  describe('authenticated scope (ctx.auth present)', () => {
    it('accepts an input scope equal to the ctx scope', async () => {
      const { em, dimensionRows } = makeFakeEm({})

      await getHandler().execute({ ...baseInput, tenantId: TENANT_A, organizationId: ORG_A }, makeCtx(em, TENANT_A, ORG_A))

      expect(dimensionRows.map((r) => [r.tenantId, r.organizationId])).toEqual([[TENANT_A, ORG_A]])
    })

    it('rejects an input organizationId other than the ctx organization, writing nothing', async () => {
      const { em, dimensionRows } = makeFakeEm({})

      await expect(
        getHandler().execute({ ...baseInput, organizationId: ORG_B }, makeCtx(em, TENANT_A, ORG_A)),
      ).rejects.toMatchObject({ status: 403 })
      expect(dimensionRows).toEqual([])
    })

    it('rejects an input tenantId other than the ctx tenant, writing nothing', async () => {
      const { em, dimensionRows } = makeFakeEm({})

      await expect(
        getHandler().execute({ ...baseInput, tenantId: TENANT_B }, makeCtx(em, TENANT_A, ORG_A)),
      ).rejects.toMatchObject({ status: 403 })
      expect(dimensionRows).toEqual([])
    })

    it('does not complete a ctx without an organization from the input organizationId', async () => {
      const { em, dimensionRows } = makeFakeEm({})
      const ctx: CommandRuntimeContext = {
        ...makeCtx(em, TENANT_A, ORG_A),
        auth: { sub: 'user-1', tenantId: TENANT_A, orgId: null },
        selectedOrganizationId: null,
      }

      await expect(
        getHandler().execute({ ...baseInput, tenantId: TENANT_A, organizationId: ORG_A }, ctx),
      ).rejects.toMatchObject({ status: 404 })
      expect(dimensionRows).toEqual([])
    })

    it('does not complete a ctx without a tenant from the input tenantId', async () => {
      const { em, dimensionRows } = makeFakeEm({})
      const ctx: CommandRuntimeContext = {
        ...makeCtx(em, TENANT_A, ORG_A),
        auth: { sub: 'user-1', tenantId: null, orgId: ORG_A },
      }

      await expect(
        getHandler().execute({ ...baseInput, tenantId: TENANT_A, organizationId: ORG_A }, ctx),
      ).rejects.toMatchObject({ status: 404 })
      expect(dimensionRows).toEqual([])
    })

    it('passes OM_ENFORCE_ORG_SCOPE_STRICT for a caller writing into its own organization', async () => {
      const { em, dimensionRows } = makeFakeEm({})

      await withStrictOrganizationScope(() => getHandler().execute(baseInput, makeCtx(em, TENANT_A, ORG_A)))

      expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-new'])
    })
  })

  describe('undo state captured under the pair lock', () => {
    it('restores the rows a concurrent write left between the bus prepare step and the pair lock, not the earlier ones', async () => {
      const { em, dimensionRows } = makeFakeEm({ dimensionRows: [dimRow('CostCenter', 'cc-old', 'posting_rules')] })
      const findOne = em.findOne.getMockImplementation()
      let concurrentWriteLanded = false
      em.findOne.mockImplementation(async (ctor: unknown, where: unknown, options: unknown) => {
        if (ctor === JournalEntryLine && !concurrentWriteLanded) {
          concurrentWriteLanded = true
          dimensionRows.length = 0
          dimensionRows.push(dimRow('CostCenter', 'cc-concurrent', 'posting_rules'))
        }
        return findOne(ctor, where, options)
      })
      const log = jest.fn(async (entry: Record<string, unknown>) => ({ id: 'log-1', ...entry }))
      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      container.register({ em: asValue(em), actionLogService: asValue({ log }) })
      const ctx: CommandRuntimeContext = { ...makeCtx(em, TENANT_A, ORG_A), container }

      await new CommandBus().execute('journal_entry_line_dimensions.dimensions.set', { input: baseInput, ctx })
      expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-new'])

      const logEntry = log.mock.calls[0][0] as unknown as CommandUndoLogEntry
      await getHandler().undo!({ input: baseInput, ctx, logEntry })

      expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-concurrent'])
    })
  })

  describe('transaction and concurrency', () => {
    it('takes the pair advisory lock before it reads ownership and deletes', async () => {
      const { em, calls } = makeFakeEm({ dimensionRows: [dimRow('CostCenter', 'cc-old', 'posting_rules')] })

      await getHandler().execute(baseInput, makeCtx(em, TENANT_A, ORG_A))

      expect(calls).toEqual(['period', 'lock', 'delete', 'insert'])
    })

    it('rolls the delete back when the insert phase throws, so the previous rows are still present', async () => {
      const { em, dimensionRows } = makeFakeEm({
        dimensionRows: [dimRow('CostCenter', 'cc-old', 'posting_rules')],
        failInsert: true,
      })

      await expect(getHandler().execute(baseInput, makeCtx(em, TENANT_A, ORG_A))).rejects.toThrow('insert failed')

      expect(em.rollback).toHaveBeenCalled()
      expect(em.commit).not.toHaveBeenCalled()
      expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-old'])
    })
  })
})

describe('setJournalEntryLineDimensionSchema', () => {
  const base = { journalEntryLineId: LINE_1, dimensionType: 'CostCenter', writer: 'posting_rules', dimensionIds: ['cc-1'] }

  it('accepts a valid CostCenter write', () => {
    expect(setJournalEntryLineDimensionSchema.safeParse(base).success).toBe(true)
  })

  it('rejects a non-UUID journalEntryLineId', () => {
    expect(setJournalEntryLineDimensionSchema.safeParse({ ...base, journalEntryLineId: 'not-a-uuid' }).success).toBe(false)
  })

  it.each(['costcenter', 'Currency', 'BankAccount', ''])('rejects a dimensionType outside the closed DIMENSION_TYPES set: %p', (dimensionType) => {
    expect(setJournalEntryLineDimensionSchema.safeParse({ ...base, dimensionType }).success).toBe(false)
  })

  it.each(['accounts_payable', 'made_up', ''])('rejects a writer outside DIMENSION_WRITERS: %p', (writer) => {
    expect(setJournalEntryLineDimensionSchema.safeParse({ ...base, writer }).success).toBe(false)
  })

  it('rejects an input without a writer', () => {
    const { writer: _writer, ...withoutWriter } = base
    expect(setJournalEntryLineDimensionSchema.safeParse(withoutWriter).success).toBe(false)
  })

  it('rejects an empty dimensionIds array', () => {
    expect(setJournalEntryLineDimensionSchema.safeParse({ ...base, dimensionIds: [] }).success).toBe(false)
  })

  it('rejects duplicate dimensionIds within the same call', () => {
    expect(setJournalEntryLineDimensionSchema.safeParse({ ...base, dimensionIds: ['cc-1', 'cc-1'] }).success).toBe(false)
  })

  it('accepts a non-UUID dimensionId (dimension_id is an opaque reference)', () => {
    expect(setJournalEntryLineDimensionSchema.safeParse({ ...base, dimensionIds: ['opaque-ref'] }).success).toBe(true)
  })
})
