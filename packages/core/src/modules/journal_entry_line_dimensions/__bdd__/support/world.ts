// Support helpers for the `journal_entry_line_dimensions` BDD scenarios.
//
// Same approach as `ledger/__bdd__/support/world.ts`: the REAL
// `journal_entry_line_dimensions.dimensions.set` handler runs through the
// REAL `CommandBus` against a hand-written in-memory `EntityManager` that
// covers only what this command touches — `findOne` (line, entry, covering
// fiscal period), `find` (the pair's rows), `nativeDelete`, the raw
// `em.execute` advisory lock and `insert ... on conflict do nothing`, and
// the transaction lifecycle `withAtomicFlush` drives.
import { randomUUID } from 'crypto'
import { asValue, createContainer, InjectionMode } from 'awilix'
import { Before } from '@cucumber/cucumber'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { JournalEntryLineDimension } from '../../data/entities'
import { FiscalPeriod, JournalEntry, JournalEntryLine } from '../../../ledger/data/entities'

export const TENANT_ID = '22222222-2222-4222-8222-222222222222'
export const ORGANIZATIONS: Record<string, string> = {
  A: '33333333-3333-4333-8333-333333333333',
  B: '44444444-4444-4444-8444-444444444444',
}

export type DimensionRow = {
  id: string
  journalEntryLineId: string
  dimensionType: string
  dimensionId: string
  writer: string
  tenantId: string
  organizationId: string
  createdAt: Date
}

type ScopedRow = { id: string; tenantId: string; organizationId: string } & Record<string, unknown>
type Where = Record<string, unknown>

function inScope(row: { tenantId: string; organizationId: string }, where: Where): boolean {
  return row.tenantId === where.tenantId && row.organizationId === where.organizationId
}

function rangeCovers(row: ScopedRow, where: Where): boolean {
  const start = (where.startDate as { $lte: Date }).$lte
  const end = (where.endDate as { $gte: Date }).$gte
  return (row.startDate as Date) <= start && (row.endDate as Date) >= end && !row.deletedAt
}

export class DimensionsFakeEntityManager {
  lines: ScopedRow[] = []
  entries: ScopedRow[] = []
  periods: ScopedRow[] = []
  dimensions: DimensionRow[] = []
  private snapshot: DimensionRow[] | null = null

  fork(): DimensionsFakeEntityManager {
    return this
  }

  isInTransaction(): boolean {
    return this.snapshot !== null
  }

  async begin(): Promise<void> {
    this.snapshot = this.dimensions.map((row) => ({ ...row }))
  }

  async commit(): Promise<void> {
    this.snapshot = null
  }

  async rollback(): Promise<void> {
    if (this.snapshot) this.dimensions = this.snapshot
    this.snapshot = null
  }

  async flush(): Promise<void> {}

  async findOne(entity: unknown, where: Where): Promise<ScopedRow | null> {
    if (entity === JournalEntryLine) return this.lines.find((row) => row.id === where.id && inScope(row, where)) ?? null
    if (entity === JournalEntry) return this.entries.find((row) => row.id === where.id && inScope(row, where)) ?? null
    if (entity === FiscalPeriod) return this.periods.find((row) => inScope(row, where) && rangeCovers(row, where)) ?? null
    return null
  }

  async find(entity: unknown, where: Where): Promise<DimensionRow[]> {
    if (entity !== JournalEntryLineDimension) return []
    return this.dimensions.filter(
      (row) =>
        row.journalEntryLineId === where.journalEntryLineId &&
        row.dimensionType === where.dimensionType &&
        inScope(row, where),
    )
  }

  async nativeDelete(entity: unknown, where: Where): Promise<number> {
    if (entity !== JournalEntryLineDimension) return 0
    const before = this.dimensions.length
    this.dimensions = this.dimensions.filter(
      (row) =>
        !(row.journalEntryLineId === where.journalEntryLineId && row.dimensionType === where.dimensionType && inScope(row, where)),
    )
    return before - this.dimensions.length
  }

  async execute(sql: string, params: unknown[]): Promise<unknown[]> {
    if (/pg_advisory_xact_lock/i.test(sql)) return []
    if (!/insert into journal_entry_line_dimensions/i.test(sql)) {
      throw new Error(`[internal] DimensionsFakeEntityManager.execute(): unhandled raw SQL — ${sql}`)
    }
    const [journalEntryLineId, dimensionType, dimensionId, writer, tenantId, organizationId] = params as string[]
    const duplicate = this.dimensions.some(
      (row) =>
        row.journalEntryLineId === journalEntryLineId &&
        row.dimensionType === dimensionType &&
        row.dimensionId === dimensionId &&
        row.tenantId === tenantId &&
        row.organizationId === organizationId,
    )
    if (!duplicate) {
      this.dimensions.push({ id: randomUUID(), journalEntryLineId, dimensionType, dimensionId, writer, tenantId, organizationId, createdAt: new Date() })
    }
    return []
  }
}

export type ActionLogEntry = Record<string, unknown> & { id: string }

export type DimensionsWorld = {
  em: DimensionsFakeEntityManager
  lineId: string
  logs: ActionLogEntry[]
  lastInput: Record<string, unknown> | null
  lastOrganizationKey: string | null
  rejection: unknown
}

let world: DimensionsWorld | null = null

export function startWorld(): DimensionsWorld {
  world = { em: new DimensionsFakeEntityManager(), lineId: randomUUID(), logs: [], lastInput: null, lastOrganizationKey: null, rejection: null }
  return world
}

export function currentWorld(): DimensionsWorld {
  if (!world) throw new Error('[internal] BDD world: the Background step must create the posted line first.')
  return world
}

Before(function () {
  world = null
})

/**
 * An authenticated context acting in `organizationKey`, with a container
 * that carries the fake em and an action log service recording every log
 * entry, as the real command bus needs for `prepare`/`buildLog`.
 */
export function buildAuthenticatedContext(target: DimensionsWorld, organizationKey: string): CommandRuntimeContext {
  const organizationId = ORGANIZATIONS[organizationKey]
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(target.em),
    actionLogService: asValue({
      log: async (entry: Record<string, unknown>) => {
        const logged: ActionLogEntry = { id: randomUUID(), ...entry }
        target.logs.push(logged)
        return logged
      },
    }),
  })
  return {
    container,
    auth: { sub: 'bdd-user', tenantId: TENANT_ID, orgId: organizationId },
    selectedOrganizationId: organizationId,
    organizationScope: null,
    organizationIds: null,
    request: undefined,
  } as unknown as CommandRuntimeContext
}

export async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return null
  } catch (err) {
    return err
  }
}
