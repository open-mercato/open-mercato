/**
 * The ledger as a read model for reporting.
 *
 * A country plugin may read the ledger but must not reach into its entities — the
 * Layer-2 boundary is what keeps a plugin replaceable and the engine
 * jurisdiction-neutral. So the engine owns the query and hands back the
 * *contract's* line shape (`TaxReturnLine`), which carries only what a return
 * needs: the tax code, the account, the account's class and the two amounts.
 *
 * Only **posted** entries count. A draft is a proposal; including one would make
 * a VAT return that changes when somebody edits a form.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AccountClass, NormalBalance } from '../data/entities'
import type { TaxReturnLine } from './contracts'
import type { AccountMovement } from './statements'
import { GlJournalEntry, GlPeriod } from '../data/entities'
import { fromMinorUnits, toMinorUnits } from './glService'

export type LedgerScope = {
  tenantId: string
  organizationId: string
}

export type PostedLineRange = {
  /** ISO dates, inclusive on both ends. */
  startDate: string
  endDate: string
}

export type FinancialLedgerService = {
  /** Posted journal lines carrying a tax code, within the range, in line order. */
  loadPostedTaxLines(scope: LedgerScope, range: PostedLineRange): Promise<TaxReturnLine[]>
  /** The accounting periods overlapping the range, oldest first. */
  listPeriods(scope: LedgerScope, range: PostedLineRange): Promise<GlPeriod[]>
  /**
   * Posted movement per account over the range, one row per account that moved,
   * with the account's class and normal balance so a statement can net it.
   */
  loadAccountMovements(scope: LedgerScope, range: PostedLineRange): Promise<AccountMovement[]>
  /**
   * The currency the range was posted in — the most recent posted entry's — or
   * `null` when nothing was posted. A statement has to name a currency and the
   * movement rows deliberately do not carry one; this is the one lookup that
   * answers it without putting a currency on every line.
   */
  resolvePostedCurrency(scope: LedgerScope, range: PostedLineRange): Promise<string | null>
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function createFinancialLedgerService(em: EntityManager): FinancialLedgerService {
  return {
    async loadPostedTaxLines(scope, range) {
      const entries = await em.find(
        GlJournalEntry,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          status: 'posted',
          postingDate: { $gte: new Date(`${range.startDate}T00:00:00.000Z`), $lte: new Date(`${range.endDate}T00:00:00.000Z`) },
        },
        { populate: ['lines', 'lines.account'], orderBy: { postingDate: 'asc', entryNumber: 'asc' } },
      )

      const lines: TaxReturnLine[] = []
      for (const entry of entries) {
        for (const line of entry.lines.getItems()) {
          if (!line.taxCode || line.taxCode.trim().length === 0) continue
          lines.push({
            taxCode: line.taxCode,
            accountCode: line.account.code,
            accountClass: line.account.accountClass as AccountClass,
            debit: line.debitAmount,
            credit: line.creditAmount,
          })
        }
      }
      return lines
    },

    async listPeriods(scope, range) {
      return em.find(
        GlPeriod,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          startDate: { $lte: new Date(`${range.endDate}T00:00:00.000Z`) },
          endDate: { $gte: new Date(`${range.startDate}T00:00:00.000Z`) },
        },
        { orderBy: { startDate: 'asc' } },
      )
    },

    async loadAccountMovements(scope, range) {
      const entries = await em.find(
        GlJournalEntry,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          status: 'posted',
          postingDate: {
            $gte: new Date(`${range.startDate}T00:00:00.000Z`),
            $lte: new Date(`${range.endDate}T00:00:00.000Z`),
          },
        },
        { populate: ['lines', 'lines.account'] },
      )

      // Aggregated in integer minor units, not with `+` on the decimal strings:
      // a statement over a year of postings is exactly the sum that would drift
      // if it were done in floats, and `glService` already owns the arithmetic.
      const totals = new Map<string, { movement: Omit<AccountMovement, 'debit' | 'credit'>; debit: bigint; credit: bigint }>()
      for (const entry of entries) {
        for (const line of entry.lines.getItems()) {
          const account = line.account
          const bucket = totals.get(account.id) ?? {
            movement: {
              accountId: account.id,
              code: account.code,
              name: account.name,
              accountClass: account.accountClass as AccountClass,
              normalBalance: account.normalBalance as NormalBalance,
            },
            debit: 0n,
            credit: 0n,
          }
          bucket.debit += toMinorUnits(line.debitAmount)
          bucket.credit += toMinorUnits(line.creditAmount)
          totals.set(account.id, bucket)
        }
      }

      return [...totals.values()]
        .sort((left, right) => (left.movement.code < right.movement.code ? -1 : left.movement.code > right.movement.code ? 1 : 0))
        .map((bucket) => ({
          ...bucket.movement,
          debit: fromMinorUnits(bucket.debit),
          credit: fromMinorUnits(bucket.credit),
        }))
    },

    async resolvePostedCurrency(scope, range) {
      const latest = await em.findOne(
        GlJournalEntry,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          status: 'posted',
          postingDate: {
            $gte: new Date(`${range.startDate}T00:00:00.000Z`),
            $lte: new Date(`${range.endDate}T00:00:00.000Z`),
          },
        },
        { orderBy: { postingDate: 'desc', entryNumber: 'desc' } },
      )
      return latest?.currencyCode ?? null
    },
  }
}

export { toIsoDate }
