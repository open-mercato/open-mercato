/**
 * The rules the money-facing writes obey, as pure functions plus the few lookups
 * a command needs.
 *
 * They live here rather than in the route for the reason the module's other rules
 * do: a rule enforced in a handler is a rule the next handler will forget. Each
 * function below refuses with a **stable code** (see `lib/errors.ts`) so the
 * caller can translate it and a test can assert it, and each is unit-tested
 * without a database.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { GlAccount, GlCashAccount, GlPaymentMethod } from '../data/entities'
import { FinancialRuleError } from './errors'
import {
  assertJournalEntryRules,
  sumJournalLines,
  toMinorUnits,
  type JournalLineDraft,
} from './glService'

export type FinanceScope = { tenantId: string; organizationId: string }

/**
 * The lines a set of opening balances becomes.
 *
 * It is the caller's lines unchanged — this function adds no offsetting line. An
 * opening balance set that does not balance is a question about the tenant's own
 * figures ("what is the missing 4 000?"), and inventing a plug account to absorb
 * it would answer the question with a number nobody entered. The schema and this
 * function both refuse it, so the balance invariant cannot be skipped by calling
 * the service directly.
 */
export function buildOpeningBalanceLines(
  lines: readonly JournalLineDraft[],
): JournalLineDraft[] {
  assertJournalEntryRules(lines)
  return lines.map((line) => ({ ...line }))
}

export type PaymentPostingInput = {
  direction: 'in' | 'out'
  /** The GL account the money moved through (the method's account). */
  moneyAccountId: string
  counterpartyAccountId: string
  amount: string | number
  description: string
  taxCode?: string | null
}

/**
 * The two lines a payment posts.
 *
 * A receipt debits where the money landed and credits what it came from; a
 * payment does the reverse. The amount is validated as a positive single-sided
 * line, so a caller cannot smuggle a refund through as a negative receipt — a
 * refund is a payment, and it should read as one in the ledger.
 */
export function buildPaymentLines(input: PaymentPostingInput): JournalLineDraft[] {
  const amount = toMinorUnits(input.amount)
  if (amount <= 0n) throw new FinancialRuleError('payment_amount_not_positive')
  if (input.moneyAccountId === input.counterpartyAccountId) {
    throw new FinancialRuleError('payment_accounts_identical')
  }
  const debit = input.direction === 'in' ? input.moneyAccountId : input.counterpartyAccountId
  const credit = input.direction === 'in' ? input.counterpartyAccountId : input.moneyAccountId
  const lines: JournalLineDraft[] = [
    { accountId: debit, debitAmount: input.amount, creditAmount: '0', description: input.description, taxCode: input.taxCode ?? null },
    { accountId: credit, debitAmount: '0', creditAmount: input.amount, description: input.description, taxCode: input.taxCode ?? null },
  ]
  assertJournalEntryRules(lines)
  return lines
}

/** The direction a payment's own amount reads as, for a signed report line. */
export function paymentSignedAmount(direction: 'in' | 'out', amount: string | number): string {
  const units = toMinorUnits(amount)
  return direction === 'in' ? formatMinor(units) : formatMinor(-units)
}

function formatMinor(value: bigint): string {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const whole = magnitude / 10_000n
  const fraction = (magnitude % 10_000n).toString().padStart(4, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

/**
 * A payment method has to name a GL account that exists in scope and can hold a
 * balance — posting cash to a revenue account would make the trial balance
 * disagree with the till and nothing downstream could tell.
 */
export async function assertPaymentMethodAccount(
  em: EntityManager,
  scope: FinanceScope,
  accountId: string,
): Promise<GlAccount> {
  const account = await em.findOne(GlAccount, { id: accountId, ...scope, deletedAt: null })
  if (!account) throw new FinancialRuleError('account_not_found')
  if (!account.isActive) throw new FinancialRuleError('account_inactive')
  if (account.accountClass !== 'asset') throw new FinancialRuleError('payment_account_must_be_asset')
  return account
}

/** The same rule for the account a till or bank account reports against. */
export async function assertCashAccountAccount(
  em: EntityManager,
  scope: FinanceScope,
  accountId: string,
): Promise<GlAccount> {
  return assertPaymentMethodAccount(em, scope, accountId)
}

/**
 * Clear the `isDefault` flag on every other method, so "the default" is one row
 * and not a race between two. Called inside the writing command's transaction.
 */
export async function clearOtherPaymentMethodDefaults(
  em: EntityManager,
  scope: FinanceScope,
  keepId: string | null,
): Promise<void> {
  const others = await em.find(GlPaymentMethod, { ...scope, isDefault: true, deletedAt: null })
  for (const method of others) {
    if (keepId && method.id === keepId) continue
    method.isDefault = false
  }
}

export async function clearOtherCashAccountDefaults(
  em: EntityManager,
  scope: FinanceScope,
  keepId: string | null,
): Promise<void> {
  const others = await em.find(GlCashAccount, { ...scope, isDefault: true, deletedAt: null })
  for (const account of others) {
    if (keepId && account.id === keepId) continue
    account.isDefault = false
  }
}

/**
 * A method that says it needs a reference must be given one. The check is here
 * because it is the difference between a cheque that can be traced and a numeric
 * gap in a bank statement.
 */
export function assertPaymentReference(
  method: Pick<GlPaymentMethod, 'requiresReference' | 'name'>,
  reference: string | null | undefined,
): void {
  if (!method.requiresReference) return
  if (typeof reference === 'string' && reference.trim().length > 0) return
  throw new FinancialRuleError('payment_reference_required')
}

/** The amount a set of opening balances carries, for a caller that wants to show it. */
export function openingBalanceTotal(lines: readonly JournalLineDraft[]): string {
  const totals = sumJournalLines(lines)
  return formatMinor(totals.debit)
}
