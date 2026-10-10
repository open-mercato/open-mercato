import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { z } from 'zod'
import { GlAccount, GlJournalEntry, GlJournalLine, GlPeriod } from '../data/entities'
import {
  createAccountSchema,
  createJournalEntrySchema,
  createPeriodSchema,
  updateAccountSchema,
  updateJournalEntrySchema,
  updatePeriodSchema,
  type CreateJournalEntryInput,
} from '../data/validators'
import { registerCrudCommands } from './crud'
import {
  assertEntryEditable,
  assertEntryPostable,
  assertJournalEntryRules,
  assertPeriodReopenable,
  buildReversalLines,
  evaluatePeriodPosting,
  type JournalLineDraft,
} from '../lib/glService'
import { raiseFinancialError } from '../lib/errors'
import eventsConfig from '../events'

const emitFinancialEvent = eventsConfig.emit

export const FINANCIAL_ACCOUNT_ENTITY_ID = 'financial:gl_account' as const
export const FINANCIAL_PERIOD_ENTITY_ID = 'financial:gl_period' as const
export const FINANCIAL_ENTRY_ENTITY_ID = 'financial:gl_journal_entry' as const

export function makeEvents<TEntity extends object>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'financial',
    entity,
    persistent: true,
    buildPayload: ({ identifiers }) => ({
      id: identifiers.id,
      organizationId: identifiers.organizationId,
      tenantId: identifiers.tenantId,
    }),
  }
}

export function makeIndexer<TEntity extends object>(entityType: string): CrudIndexerConfig<TEntity> {
  return { entityType }
}

export const financialAccountEvents = makeEvents<GlAccount>('account')
export const financialAccountIndexer = makeIndexer<GlAccount>(FINANCIAL_ACCOUNT_ENTITY_ID)
export const financialPeriodEvents = makeEvents<GlPeriod>('period')
export const financialPeriodIndexer = makeIndexer<GlPeriod>(FINANCIAL_PERIOD_ENTITY_ID)
export const financialEntryEvents = makeEvents<GlJournalEntry>('journal_entry')
export const financialEntryIndexer = makeIndexer<GlJournalEntry>(FINANCIAL_ENTRY_ENTITY_ID)

registerCrudCommands({
  entity: GlAccount,
  entityId: FINANCIAL_ACCOUNT_ENTITY_ID,
  resource: 'accounts',
  createSchema: createAccountSchema,
  updateSchema: updateAccountSchema,
  toCreateData: (input) => input,
  toUpdateData: (input) => Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id')),
  events: financialAccountEvents,
  indexer: financialAccountIndexer,
})

registerCrudCommands({
  entity: GlPeriod,
  entityId: FINANCIAL_PERIOD_ENTITY_ID,
  resource: 'periods',
  createSchema: createPeriodSchema,
  updateSchema: updatePeriodSchema,
  toCreateData: (input) => ({
    ...input,
    startDate: new Date(String(input.startDate)),
    endDate: new Date(String(input.endDate)),
  }),
  toUpdateData: (input) => {
    const { id: _id, startDate, endDate, ...patch } = input
    return {
      ...patch,
      ...(startDate === undefined ? {} : { startDate: new Date(String(startDate)) }),
      ...(endDate === undefined ? {} : { endDate: new Date(String(endDate)) }),
    }
  },
  events: financialPeriodEvents,
  indexer: financialPeriodIndexer,
  softDelete: false,
})

type Scope = { tenantId: string; organizationId: string }

function resolveScope(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: '[internal] Tenant and organization context are required.' })
  }
  return { tenantId, organizationId }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

function toDrafts(lines: readonly { accountId: string; debitAmount?: string | number; creditAmount?: string | number; description?: string | null; taxCode?: string | null }[]): JournalLineDraft[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    debitAmount: line.debitAmount ?? '0',
    creditAmount: line.creditAmount ?? '0',
    description: line.description ?? null,
    taxCode: line.taxCode ?? null,
  }))
}

async function loadPeriod(em: EntityManager, scope: Scope, periodId: string, lock = false): Promise<GlPeriod> {
  const period = await em.findOne(
    GlPeriod,
    { id: periodId, ...scope },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
  )
  if (!period) return raiseFinancialError(400, 'invalid_period')
  return period
}

/** Every line's account must exist in scope and share the entry currency. */
async function loadAccounts(
  em: EntityManager,
  scope: Scope,
  drafts: readonly JournalLineDraft[],
  currencyCode: string,
): Promise<Map<string, GlAccount>> {
  const ids = [...new Set(drafts.map((draft) => draft.accountId))]
  const accounts = await em.find(GlAccount, { id: { $in: ids }, ...scope, deletedAt: null })
  const byId = new Map(accounts.map((account) => [account.id, account]))
  for (const id of ids) {
    const account = byId.get(id)
    if (!account) return raiseFinancialError(400, 'account_not_found')
    if (account.currencyCode !== currencyCode) return raiseFinancialError(400, 'currency_mismatch')
  }
  return byId
}

function persistLines(em: EntityManager, entry: GlJournalEntry, drafts: readonly JournalLineDraft[]): void {
  drafts.forEach((draft, index) => {
    em.persist(
      em.create(GlJournalLine, {
        entry,
        lineNumber: index + 1,
        account: em.getReference(GlAccount, draft.accountId),
        description: draft.description ?? null,
        debitAmount: String(draft.debitAmount),
        creditAmount: String(draft.creditAmount),
        baseDebitAmount: String(draft.debitAmount),
        baseCreditAmount: String(draft.creditAmount),
        taxCode: draft.taxCode ?? null,
      }),
    )
  })
}

const createJournalEntryCommand: CommandHandler<CreateJournalEntryInput, GlJournalEntry> = {
  id: 'financial.journal_entries.create',
  async execute(raw, ctx) {
    const input = createJournalEntrySchema.parse(raw)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entry = await em.transactional(async (trx) => {
      const period = await loadPeriod(trx, scope, input.periodId)
      const drafts = toDrafts(input.lines)
      assertJournalEntryRules(drafts)
      await loadAccounts(trx, scope, drafts, input.currencyCode)
      const created = trx.create(GlJournalEntry, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        entryNumber: input.entryNumber,
        entryDate: toDate(input.entryDate),
        postingDate: toDate(input.postingDate),
        period,
        entryType: input.entryType ?? 'standard',
        description: input.description,
        reference: input.reference ?? null,
        currencyCode: input.currencyCode,
        exchangeRate: input.exchangeRate === undefined ? '1' : String(input.exchangeRate),
        status: 'draft',
        createdBy: ctx.auth?.sub ?? null,
        updatedBy: ctx.auth?.sub ?? null,
      })
      persistLines(trx, created, drafts)
      await trx.flush()
      return created
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: entry,
      identifiers: { id: entry.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: financialEntryEvents,
      indexer: financialEntryIndexer,
    })
    return entry
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Create journal entry',
      resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
      resourceId: result.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(createJournalEntryCommand)

const updateJournalEntryCommand: CommandHandler<Record<string, unknown>, GlJournalEntry> = {
  id: 'financial.journal_entries.update',
  async execute(raw, ctx) {
    const input = updateJournalEntrySchema.parse(raw)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entry = await em.transactional(async (trx) => {
      const current = await trx.findOne(
        GlJournalEntry,
        { id: input.id, ...scope },
        { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['lines'] },
      )
      if (!current) throw new CrudHttpError(404, { error: '[internal] Journal entry not found.' })
      assertEntryEditable(current.status)
      if (input.periodId) current.period = await loadPeriod(trx, scope, input.periodId)
      if (input.entryDate) current.entryDate = toDate(input.entryDate)
      if (input.postingDate) current.postingDate = toDate(input.postingDate)
      if (input.entryType) current.entryType = input.entryType
      if (input.description) current.description = input.description
      if (input.reference !== undefined) current.reference = input.reference ?? null
      const currencyCode = input.currencyCode ?? current.currencyCode
      if (input.currencyCode) current.currencyCode = input.currencyCode
      if (input.exchangeRate !== undefined) current.exchangeRate = String(input.exchangeRate)
      if (input.lines) {
        const drafts = toDrafts(input.lines)
        assertJournalEntryRules(drafts)
        await loadAccounts(trx, scope, drafts, currencyCode)
        for (const line of current.lines.getItems()) trx.remove(line)
        current.lines.removeAll()
        persistLines(trx, current, drafts)
      }
      current.updatedAt = new Date()
      current.updatedBy = ctx.auth?.sub ?? null
      await trx.flush()
      return current
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: entry,
      identifiers: { id: entry.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: financialEntryEvents,
      indexer: financialEntryIndexer,
    })
    return entry
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Update journal entry',
      resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
      resourceId: String(input.id ?? ''),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const deleteJournalEntryCommand: CommandHandler<{ id: string }, { id: string }> = {
  id: 'financial.journal_entries.delete',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const removed = await em.transactional(async (trx) => {
      const current = await trx.findOne(
        GlJournalEntry,
        { id: input.id, ...scope },
        { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['lines'] },
      )
      if (!current) throw new CrudHttpError(404, { error: '[internal] Journal entry not found.' })
      assertEntryEditable(current.status)
      for (const line of current.lines.getItems()) trx.remove(line)
      trx.remove(current)
      await trx.flush()
      return { id: current.id }
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: removed as unknown as GlJournalEntry,
      identifiers: { id: removed.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: financialEntryEvents,
      indexer: financialEntryIndexer,
    })
    return removed
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Delete journal entry',
      resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(updateJournalEntryCommand)
registerCommand(deleteJournalEntryCommand)

export const postJournalEntrySchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().optional(),
})
export const reverseJournalEntrySchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().optional(),
  postingDate: z.string().optional(),
})
export const closePeriodSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().optional(),
  target: z.enum(['soft_closed', 'hard_closed']),
})
export const reopenPeriodSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().optional(),
})

export type PostJournalEntryInput = z.infer<typeof postJournalEntrySchema>
export type ReverseJournalEntryInput = z.infer<typeof reverseJournalEntrySchema>
export type ClosePeriodInput = z.infer<typeof closePeriodSchema>
export type ReopenPeriodInput = z.infer<typeof reopenPeriodSchema>

/** Defensive feature read: absence of the claim means no elevated permission. */
function hasFeature(ctx: CommandRuntimeContext, featureId: string): boolean {
  const features = (ctx.auth as { features?: unknown } | undefined)?.features
  if (!Array.isArray(features)) return false
  return features.some((value) => {
    if (typeof value !== 'string') return false
    if (value === featureId) return true
    return value.endsWith('*') && featureId.startsWith(value.slice(0, -1))
  })
}

function lineDrafts(entry: GlJournalEntry): JournalLineDraft[] {
  return entry.lines.getItems().map((line) => ({
    accountId: line.account.id,
    debitAmount: line.debitAmount,
    creditAmount: line.creditAmount,
    description: line.description ?? null,
    taxCode: line.taxCode ?? null,
  }))
}

async function findPeriodForDate(em: EntityManager, scope: Scope, date: Date): Promise<GlPeriod | null> {
  return em.findOne(GlPeriod, { ...scope, startDate: { $lte: date }, endDate: { $gte: date } })
}

const postJournalEntryCommand: CommandHandler<PostJournalEntryInput, { id: string; status: string; updatedAt: string }> = {
  id: 'financial.journal_entries.post',
  async execute(raw, ctx) {
    const input = postJournalEntrySchema.parse(raw)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const posted = await em.transactional(async (trx) => {
      const entry = await trx.findOne(
        GlJournalEntry,
        { id: input.id, ...scope },
        { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['lines'] },
      )
      if (!entry) throw new CrudHttpError(404, { error: '[internal] Journal entry not found.' })
      assertEntryPostable(entry.status)
      const period = await trx.findOne(
        GlPeriod,
        { id: entry.period.id, ...scope },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!period) return raiseFinancialError(400, 'invalid_period')
      const gate = evaluatePeriodPosting(period.status, hasFeature(ctx, 'financial.close'))
      if (!gate.allowed) return raiseFinancialError(409, gate.code)
      assertJournalEntryRules(lineDrafts(entry))
      const now = new Date()
      entry.status = 'posted'
      entry.postedAt = now
      entry.postedBy = ctx.auth?.sub ?? null
      entry.updatedAt = now
      entry.updatedBy = ctx.auth?.sub ?? null
      await trx.flush()
      return entry
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: posted,
      identifiers: { id: posted.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: financialEntryEvents,
      indexer: financialEntryIndexer,
    })
    // The moment the ledger's contents changed. A draft edit also emits
    // `journal_entry.updated`, so a consumer that must react to *postings* —
    // a tax return, an AR/AP posting — follows this one.
    await emitFinancialEvent('financial.journal_entry.posted', {
      id: posted.id,
      entryNumber: posted.entryNumber,
      periodId: posted.period.id,
      postingDate: posted.postingDate.toISOString().slice(0, 10),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { id: posted.id, status: posted.status, updatedAt: posted.updatedAt.toISOString() }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Post journal entry',
      resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const reverseJournalEntryCommand: CommandHandler<
  ReverseJournalEntryInput,
  { id: string; originalId: string; updatedAt: string }
> = {
  id: 'financial.journal_entries.reverse',
  async execute(raw, ctx) {
    const input = reverseJournalEntrySchema.parse(raw)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional(async (trx) => {
      const original = await trx.findOne(
        GlJournalEntry,
        { id: input.id, ...scope },
        { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['lines'] },
      )
      if (!original) throw new CrudHttpError(404, { error: '[internal] Journal entry not found.' })
      if (original.status !== 'posted') return raiseFinancialError(409, 'entry_not_posted')
      const postingDate = input.postingDate ? toDate(input.postingDate) : new Date()
      const period = await findPeriodForDate(trx, scope, postingDate)
      if (!period) return raiseFinancialError(400, 'invalid_period')
      const gate = evaluatePeriodPosting(period.status, hasFeature(ctx, 'financial.close'))
      if (!gate.allowed) return raiseFinancialError(409, gate.code)
      const drafts = buildReversalLines(lineDrafts(original))
      assertJournalEntryRules(drafts)
      const now = new Date()
      const reversal = trx.create(GlJournalEntry, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        entryNumber: `${original.entryNumber}-R`,
        entryDate: postingDate,
        postingDate,
        period,
        entryType: 'reversing',
        description: `Reversal of ${original.entryNumber}`,
        reference: original.reference ?? null,
        currencyCode: original.currencyCode,
        exchangeRate: original.exchangeRate,
        status: 'posted',
        reversesEntry: original,
        postedAt: now,
        postedBy: ctx.auth?.sub ?? null,
        createdBy: ctx.auth?.sub ?? null,
        updatedBy: ctx.auth?.sub ?? null,
      })
      persistLines(trx, reversal, drafts)
      original.status = 'reversed'
      original.reversedByEntry = reversal
      original.updatedAt = now
      original.updatedBy = ctx.auth?.sub ?? null
      await trx.flush()
      return { original, reversal }
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: result.original,
      identifiers: { id: result.original.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: financialEntryEvents,
      indexer: financialEntryIndexer,
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: result.reversal,
      identifiers: { id: result.reversal.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: financialEntryEvents,
      indexer: financialEntryIndexer,
    })
    // Carries both ids: a consumer tracking what a posting did to the ledger has
    // to see the correction net the original out, not just the new row.
    await emitFinancialEvent('financial.journal_entry.reversed', {
      id: result.reversal.id,
      reversedEntryId: result.original.id,
      entryNumber: result.reversal.entryNumber,
      periodId: result.reversal.period.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return {
      id: result.reversal.id,
      originalId: result.original.id,
      updatedAt: result.reversal.updatedAt.toISOString(),
    }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Reverse journal entry',
      resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const closePeriodCommand: CommandHandler<ClosePeriodInput, { id: string; status: string; updatedAt: string }> = {
  id: 'financial.periods.close',
  async execute(raw, ctx) {
    const input = closePeriodSchema.parse(raw)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const period = await em.transactional(async (trx) => {
      const current = await trx.findOne(GlPeriod, { id: input.id, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!current) throw new CrudHttpError(404, { error: '[internal] Accounting period not found.' })
      if (current.status === 'hard_closed') return raiseFinancialError(409, 'period_hard_closed')
      const expected = input.target === 'soft_closed' ? 'open' : 'soft_closed'
      if (current.status !== expected) return raiseFinancialError(409, 'period_closed')
      const now = new Date()
      current.status = input.target
      current.closedAt = now
      current.closedBy = ctx.auth?.sub ?? null
      current.updatedAt = now
      await trx.flush()
      return current
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: period,
      identifiers: { id: period.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: financialPeriodEvents,
      indexer: financialPeriodIndexer,
    })
    await emitFinancialEvent('financial.period.closed', {
      id: period.id,
      status: period.status,
      fiscalYear: period.fiscalYear,
      periodNumber: period.periodNumber,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { id: period.id, status: period.status, updatedAt: period.updatedAt.toISOString() }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: `Close accounting period (${input.target})`,
      resourceKind: FINANCIAL_PERIOD_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const reopenPeriodCommand: CommandHandler<ReopenPeriodInput, { id: string; status: string; updatedAt: string }> = {
  id: 'financial.periods.reopen',
  async execute(raw, ctx) {
    const input = reopenPeriodSchema.parse(raw)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const period = await em.transactional(async (trx) => {
      const current = await trx.findOne(GlPeriod, { id: input.id, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!current) throw new CrudHttpError(404, { error: '[internal] Accounting period not found.' })
      assertPeriodReopenable(current.status)
      const now = new Date()
      current.status = 'open'
      current.closedAt = null
      current.closedBy = null
      current.updatedAt = now
      await trx.flush()
      return current
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: period,
      identifiers: { id: period.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: financialPeriodEvents,
      indexer: financialPeriodIndexer,
    })
    await emitFinancialEvent('financial.period.reopened', {
      id: period.id,
      status: period.status,
      fiscalYear: period.fiscalYear,
      periodNumber: period.periodNumber,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { id: period.id, status: period.status, updatedAt: period.updatedAt.toISOString() }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Reopen accounting period',
      resourceKind: FINANCIAL_PERIOD_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(postJournalEntryCommand)
registerCommand(reverseJournalEntryCommand)
registerCommand(closePeriodCommand)
registerCommand(reopenPeriodCommand)





