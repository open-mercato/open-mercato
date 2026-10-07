jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import '../setJournalEntryLineDimension'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { JournalEntryLineDimension } from '../../data/entities'
import { JournalEntryLine } from '../../../ledger/data/entities'
import { setJournalEntryLineDimensionSchema } from '../../data/validators'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const ORG_A = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const LINE_1 = '55555555-5555-4555-8555-555555555555'

type DimensionRow = {
  id: string
  journalEntryLineId: string
  dimensionType: string
  dimensionId: string
  tenantId: string
  organizationId: string
  createdAt: Date
}

type LineRow = { id: string; tenantId: string; organizationId: string }

let nextId = 1
function freshId(): string {
  nextId += 1
  return `generated-${nextId}`
}

/**
 * A minimal fake `EntityManager` covering exactly the surface this command
 * touches: `find`/`findOne` (reads), `nativeDelete` + raw `execute` inserts
 * (the delete-then-insert replace), and the transaction lifecycle
 * `withAtomicFlush` drives (`isInTransaction`/`begin`/`commit`/`rollback`/
 * `flush`). No `getUnitOfWork`, so `withAtomicFlush`'s commit-boundary guard
 * treats pending changes as "unknown" and no-ops, matching how the same
 * guard behaves against the partial/mock EMs other command unit tests in
 * this codebase already use (see `personCompanyLinks.undo.test.ts`).
 */
function makeFakeEm(lines: LineRow[], dimensionRows: DimensionRow[] = []) {
  const em: any = {
    fork: jest.fn(),
    isInTransaction: jest.fn(() => false),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor !== JournalEntryLine) return null
      return (
        lines.find(
          (line) => line.id === where.id && line.tenantId === where.tenantId && line.organizationId === where.organizationId,
        ) ?? null
      )
    }),
    find: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor !== JournalEntryLineDimension) return []
      return dimensionRows.filter(
        (row) =>
          row.journalEntryLineId === where.journalEntryLineId &&
          row.dimensionType === where.dimensionType &&
          row.tenantId === where.tenantId &&
          row.organizationId === where.organizationId,
      )
    }),
    nativeDelete: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor !== JournalEntryLineDimension) return 0
      const before = dimensionRows.length
      const kept = dimensionRows.filter(
        (row) =>
          !(
            row.journalEntryLineId === where.journalEntryLineId &&
            row.dimensionType === where.dimensionType &&
            row.tenantId === where.tenantId &&
            row.organizationId === where.organizationId
          ),
      )
      dimensionRows.length = 0
      dimensionRows.push(...kept)
      return before - dimensionRows.length
    }),
    execute: jest.fn(async (sql: string, params: unknown[]) => {
      if (!/insert into journal_entry_line_dimensions/i.test(sql)) return []
      const [journalEntryLineId, dimensionType, dimensionId, tenantId, organizationId] = params as string[]
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
          tenantId,
          organizationId,
          createdAt: new Date(),
        })
      }
      return []
    }),
  }
  em.fork.mockReturnValue(em)
  return { em, dimensionRows }
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

function getHandler(): CommandHandler {
  const handler = commandRegistry.get('journal_entry_line_dimension.setJournalEntryLineDimension')
  if (!handler) throw new Error('command not registered')
  return handler
}

describe('journal_entry_line_dimension.setJournalEntryLineDimension', () => {
  it('replaces only the rows for the given (journalEntryLineId, dimensionType) pair, leaving another type on the same line untouched', async () => {
    const { em, dimensionRows } = makeFakeEm([{ id: LINE_1, tenantId: TENANT_A, organizationId: ORG_A }], [
      { id: 'r1', journalEntryLineId: LINE_1, dimensionType: 'BankAccount', dimensionId: 'bank-1', tenantId: TENANT_A, organizationId: ORG_A, createdAt: new Date() },
      { id: 'r2', journalEntryLineId: LINE_1, dimensionType: 'CostCenter', dimensionId: 'cc-old', tenantId: TENANT_A, organizationId: ORG_A, createdAt: new Date() },
    ])
    const handler = getHandler()
    const ctx = makeCtx(em, TENANT_A, ORG_A)
    const input = { journalEntryLineId: LINE_1, dimensionType: 'CostCenter', dimensionIds: ['cc-new'] }

    await handler.execute(input, ctx)

    const bankRows = dimensionRows.filter((r) => r.dimensionType === 'BankAccount')
    const costCenterRows = dimensionRows.filter((r) => r.dimensionType === 'CostCenter')
    expect(bankRows.map((r) => r.dimensionId)).toEqual(['bank-1'])
    expect(costCenterRows.map((r) => r.dimensionId)).toEqual(['cc-new'])
  })

  it('is content-idempotent: calling it twice with the same dimensionIds leaves the same content in place', async () => {
    const { em, dimensionRows } = makeFakeEm([{ id: LINE_1, tenantId: TENANT_A, organizationId: ORG_A }])
    const handler = getHandler()
    const ctx = makeCtx(em, TENANT_A, ORG_A)
    const input = { journalEntryLineId: LINE_1, dimensionType: 'FixedAsset', dimensionIds: ['asset-1'] }

    await handler.execute(input, ctx)
    await handler.execute(input, ctx)

    expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['asset-1'])
  })

  it('undo restores exactly the pre-replace rows for that (journalEntryLineId, dimensionType) pair', async () => {
    const { em, dimensionRows } = makeFakeEm([{ id: LINE_1, tenantId: TENANT_A, organizationId: ORG_A }], [
      { id: 'r1', journalEntryLineId: LINE_1, dimensionType: 'CostCenter', dimensionId: 'cc-old', tenantId: TENANT_A, organizationId: ORG_A, createdAt: new Date() },
    ])
    const handler = getHandler()
    const ctx = makeCtx(em, TENANT_A, ORG_A)
    const input = { journalEntryLineId: LINE_1, dimensionType: 'CostCenter', dimensionIds: ['cc-new'] }

    const prepared = await handler.prepare!(input, ctx)
    const result = await handler.execute(input, ctx)
    const log = await handler.buildLog!({ input, result, snapshots: { before: prepared?.before }, ctx })

    expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-new'])

    await handler.undo!({
      input,
      ctx,
      logEntry: { payload: log!.payload } as unknown as CommandUndoLogEntry,
    })

    expect(dimensionRows.map((r) => r.dimensionId)).toEqual(['cc-old'])
  })

  it('a direct consumer-style read scopes rows to the correct tenantId/organizationId — a row from another tenant never leaks', async () => {
    const { em } = makeFakeEm(
      [
        { id: LINE_1, tenantId: TENANT_A, organizationId: ORG_A },
        { id: LINE_1, tenantId: TENANT_B, organizationId: ORG_B },
      ],
      [
        { id: 'r1', journalEntryLineId: LINE_1, dimensionType: 'CostCenter', dimensionId: 'cc-tenant-a', tenantId: TENANT_A, organizationId: ORG_A, createdAt: new Date() },
        { id: 'r2', journalEntryLineId: LINE_1, dimensionType: 'CostCenter', dimensionId: 'cc-tenant-b', tenantId: TENANT_B, organizationId: ORG_B, createdAt: new Date() },
      ],
    )
    const handler = getHandler()
    const ctxA = makeCtx(em, TENANT_A, ORG_A)
    const input = { journalEntryLineId: LINE_1, dimensionType: 'CostCenter', dimensionIds: ['irrelevant'] }

    const prepared = await handler.prepare!(input, ctxA)

    expect(prepared?.before).toEqual(['cc-tenant-a'])
  })

  it('rejects setting a dimension on a journal entry line that does not exist (or belongs to another tenant)', async () => {
    const { em } = makeFakeEm([{ id: LINE_1, tenantId: TENANT_B, organizationId: ORG_B }])
    const handler = getHandler()
    const ctx = makeCtx(em, TENANT_A, ORG_A)
    const input = { journalEntryLineId: LINE_1, dimensionType: 'CostCenter', dimensionIds: ['cc-1'] }

    await expect(handler.execute(input, ctx)).rejects.toMatchObject({ status: 404 })
  })
})

describe('setJournalEntryLineDimensionSchema', () => {
  const base = { journalEntryLineId: LINE_1, dimensionType: 'CostCenter', dimensionIds: ['cc-1'] }

  it('rejects a non-UUID journalEntryLineId', () => {
    expect(setJournalEntryLineDimensionSchema.safeParse({ ...base, journalEntryLineId: 'not-a-uuid' }).success).toBe(false)
  })

  it('rejects a dimensionType outside the closed DIMENSION_TYPES enum', () => {
    expect(setJournalEntryLineDimensionSchema.safeParse({ ...base, dimensionType: 'MadeUpType' }).success).toBe(false)
  })

  it('rejects an empty dimensionIds array', () => {
    expect(setJournalEntryLineDimensionSchema.safeParse({ ...base, dimensionIds: [] }).success).toBe(false)
  })

  it('rejects duplicate dimensionIds within the same call', () => {
    expect(setJournalEntryLineDimensionSchema.safeParse({ ...base, dimensionIds: ['cc-1', 'cc-1'] }).success).toBe(false)
  })

  it('accepts a non-UUID dimensionId (the Currency dimension type is identified by ISO code, not a uuid)', () => {
    expect(
      setJournalEntryLineDimensionSchema.safeParse({ journalEntryLineId: LINE_1, dimensionType: 'Currency', dimensionIds: ['PLN'] }).success,
    ).toBe(true)
  })
})
