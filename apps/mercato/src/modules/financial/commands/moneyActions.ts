import { randomUUID } from 'node:crypto'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { hasFeature as grantHasFeature } from '@open-mercato/shared/security/features'
import type { EntityManager } from '@mikro-orm/postgresql'
import { GlAccount, GlCashAccount, GlJournalEntry, GlJournalLine, GlPaymentMethod, GlPeriod } from '../data/entities'
import {
  postOpeningBalancesSchema,
  recordPaymentSchema,
  type PostOpeningBalancesInput,
  type RecordPaymentInput,
} from '../data/validators'
import {
  assertPaymentReference,
  buildOpeningBalanceLines,
  buildPaymentLines,
  openingBalanceTotal,
} from '../lib/financeService'
import { evaluatePeriodPosting, fromMinorUnits, toMinorUnits, type JournalLineDraft } from '../lib/glService'
import { raiseFinancialError } from '../lib/errors'
import { FINANCIAL_ENTRY_ENTITY_ID, financialEntryEvents, financialEntryIndexer } from './ledger'
import eventsConfig from '../events'

const emitFinancialEvent = eventsConfig.emit

export const OPENING_BALANCES_POST_COMMAND_ID = 'financial.opening_balances.post' as const
export const PAYMENT_RECORD_COMMAND_ID = 'financial.payments.record' as const

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

/**
 * Defensive feature read: absence of the claim means no elevated permission. The
 * wildcard match itself is the shared policy helper, so a `financial.*` grant
 * behaves here exactly as it does in a route guard.
 */
function hasFinancialFeature(ctx: CommandRuntimeContext, featureId: string): boolean {
  const features = (ctx.auth as { features?: unknown } | undefined)?.features
  if (!Array.isArray(features)) return false
  const granted = features.filter((value): value is string => typeof value === 'string')
  return grantHasFeature(granted, featureId)
}

/**
 * The period whose window contains the date. This mirrors the private
 * `findPeriodForDate` in `./ledger` condition for condition, including its lack
 * of an explicit order — two paths that resolve a period for a date must not
 * disagree about which period that is.
 */
async function findPeriodForDate(em: EntityManager, scope: Scope, date: Date): Promise<GlPeriod | null> {
  return em.findOne(GlPeriod, { ...scope, startDate: { $lte: date }, endDate: { $gte: date } })
}

/**
 * The same rule the ledger's create path applies: every line's account exists in
 * scope and shares the entry currency. Without it a caller's typo reaches the
 * flush as a foreign-key violation (a 500) and a foreign-currency account would
 * silently post a mixed-currency entry.
 */
async function assertLineAccounts(
  em: EntityManager,
  scope: Scope,
  drafts: readonly JournalLineDraft[],
  currencyCode: string,
): Promise<void> {
  const ids = [...new Set(drafts.map((draft) => draft.accountId))]
  const accounts = await em.find(GlAccount, { id: { $in: ids }, ...scope, deletedAt: null })
  const byId = new Map(accounts.map((account) => [account.id, account]))
  for (const id of ids) {
    const account = byId.get(id)
    if (!account) return raiseFinancialError(400, 'account_not_found')
    if (account.currencyCode !== currencyCode) return raiseFinancialError(400, 'currency_mismatch')
  }
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

/**
 * The number a system-posted entry carries. The suffix is the entry's own
 * primary key, so the unique index on (organization, tenant, entry_number)
 * cannot be violated by two entries this module numbers itself — the entry id is
 * generated before the insert and the number therefore needs no sequence, no
 * lookup and no retry. A balance/single-sided rule is never weakened by it either,
 * because nothing is derived from the number.
 */
export function openingBalancesEntryNumber(entryId: string): string {
  return `OPENING-${entryId}`
}

export function paymentEntryNumber(entryId: string): string {
  return `PAYMENT-${entryId}`
}

export type PostOpeningBalancesResult = {
  id: string
  entryNumber: string
  postingDate: string
  updatedAt: string
  total: string
}

const postOpeningBalancesCommand: CommandHandler<PostOpeningBalancesInput, PostOpeningBalancesResult> = {
  id: OPENING_BALANCES_POST_COMMAND_ID,
  async execute(raw, ctx) {
    const input = postOpeningBalancesSchema.parse(raw)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const posted = await em.transactional(async (trx) => {
      // The refusal is read inside the transaction: two concurrent posts would
      // both see an empty ledger outside it and double the carried-in position.
      const alreadyPosted = await trx.findOne(GlJournalEntry, { ...scope, status: 'posted', entryType: 'opening' })
      if (alreadyPosted) return raiseFinancialError(409, 'opening_balances_already_posted')
      const drafts = buildOpeningBalanceLines(
        input.lines.map((line) => ({
          accountId: line.accountId,
          debitAmount: line.debitAmount ?? '0',
          creditAmount: line.creditAmount ?? '0',
          description: line.description ?? null,
        })),
      )
      const openingDate = toDate(input.openingDate)
      const period = await findPeriodForDate(trx, scope, openingDate)
      if (!period) return raiseFinancialError(400, 'invalid_period')
      const gate = evaluatePeriodPosting(period.status, hasFinancialFeature(ctx, 'financial.post'))
      if (!gate.allowed) return raiseFinancialError(409, gate.code)
      await assertLineAccounts(trx, scope, drafts, input.currencyCode)
      const entryId = randomUUID()
      const now = new Date()
      const entry = trx.create(GlJournalEntry, {
        id: entryId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        entryNumber: openingBalancesEntryNumber(entryId),
        entryDate: openingDate,
        postingDate: openingDate,
        period,
        entryType: 'opening',
        description: input.description,
        reference: null,
        currencyCode: input.currencyCode,
        exchangeRate: '1',
        status: 'posted',
        postedAt: now,
        postedBy: ctx.auth?.sub ?? null,
        createdBy: ctx.auth?.sub ?? null,
        updatedBy: ctx.auth?.sub ?? null,
      })
      persistLines(trx, entry, drafts)
      await trx.flush()
      return { entry, total: openingBalanceTotal(drafts) }
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: posted.entry,
      identifiers: { id: posted.entry.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: financialEntryEvents,
      indexer: financialEntryIndexer,
    })
    await emitFinancialEvent('financial.opening_balances.posted', {
      id: posted.entry.id,
      total: posted.total,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return {
      id: posted.entry.id,
      entryNumber: posted.entry.entryNumber,
      postingDate: posted.entry.postingDate.toISOString().slice(0, 10),
      updatedAt: posted.entry.updatedAt.toISOString(),
      total: posted.total,
    }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Post opening balances',
      resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
      resourceId: result.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

export type RecordPaymentResult = {
  entryId: string
  entryNumber: string
  postingDate: string
  direction: 'in' | 'out'
  amount: string
  methodCode: string
  updatedAt: string
}

const recordPaymentCommand: CommandHandler<RecordPaymentInput, RecordPaymentResult> = {
  id: PAYMENT_RECORD_COMMAND_ID,
  async execute(raw, ctx) {
    const input = recordPaymentSchema.parse(raw)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const recorded = await em.transactional(async (trx) => {
      const method = await trx.findOne(GlPaymentMethod, { id: input.paymentMethodId, ...scope, deletedAt: null })
      if (!method) return raiseFinancialError(404, 'payment_method_not_found')
      assertPaymentReference(method, input.reference)
      // A cash account wins over the method's own GL account: the till is the
      // operational truth for where the money was counted, the method only
      // declares the account a payment of that kind lands in by default.
      let moneyAccountId = method.accountId
      if (input.cashAccountId) {
        const cashAccount = await trx.findOne(GlCashAccount, { id: input.cashAccountId, ...scope, deletedAt: null })
        if (!cashAccount) return raiseFinancialError(404, 'cash_account_not_found')
        if (cashAccount.currencyCode !== input.currencyCode) return raiseFinancialError(400, 'currency_mismatch')
        moneyAccountId = cashAccount.accountId
      }
      const drafts = buildPaymentLines({
        direction: input.direction,
        moneyAccountId,
        counterpartyAccountId: input.counterpartyAccountId,
        amount: input.amount,
        description: input.description,
        taxCode: input.taxCode ?? null,
      })
      const paymentDate = toDate(input.paymentDate)
      const period = await findPeriodForDate(trx, scope, paymentDate)
      if (!period) return raiseFinancialError(400, 'invalid_period')
      const gate = evaluatePeriodPosting(period.status, hasFinancialFeature(ctx, 'financial.post'))
      if (!gate.allowed) return raiseFinancialError(409, gate.code)
      await assertLineAccounts(trx, scope, drafts, input.currencyCode)
      const entryId = randomUUID()
      const now = new Date()
      const entry = trx.create(GlJournalEntry, {
        id: entryId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        entryNumber: paymentEntryNumber(entryId),
        entryDate: paymentDate,
        postingDate: paymentDate,
        period,
        entryType: 'standard',
        description: input.description,
        reference: input.reference ?? null,
        currencyCode: input.currencyCode,
        exchangeRate: '1',
        status: 'posted',
        postedAt: now,
        postedBy: ctx.auth?.sub ?? null,
        createdBy: ctx.auth?.sub ?? null,
        updatedBy: ctx.auth?.sub ?? null,
      })
      persistLines(trx, entry, drafts)
      await trx.flush()
      return { entry, method }
    })
    const amount = fromMinorUnits(toMinorUnits(input.amount))
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: recorded.entry,
      identifiers: { id: recorded.entry.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: financialEntryEvents,
      indexer: financialEntryIndexer,
    })
    // A payment has no row of its own — the entry carries it — so `id` repeats
    // the entry for a consumer that reads only the payload's identifier, and
    // `entryId` names it for one that follows the ledger.
    await emitFinancialEvent('financial.payment.recorded', {
      id: recorded.entry.id,
      entryId: recorded.entry.id,
      direction: input.direction,
      amount,
      methodCode: recorded.method.code,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return {
      entryId: recorded.entry.id,
      entryNumber: recorded.entry.entryNumber,
      postingDate: recorded.entry.postingDate.toISOString().slice(0, 10),
      direction: input.direction,
      amount,
      methodCode: recorded.method.code,
      updatedAt: recorded.entry.updatedAt.toISOString(),
    }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: `Record payment (${result.direction})`,
      resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
      resourceId: result.entryId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(postOpeningBalancesCommand)
registerCommand(recordPaymentCommand)
