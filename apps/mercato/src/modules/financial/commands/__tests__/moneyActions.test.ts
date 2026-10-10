/**
 * The two money actions, covered where they can be covered without a database.
 *
 * `execute` opens a transaction, resolves a period and writes entities, so its
 * paths belong to the integration suite; what is asserted here is everything a
 * request reaches before the entity manager does — the command ids the routes
 * look up, the entry numbers the commands own, the payload schemas the routes
 * forward, and the pure posting rules those schemas and the commands both rely on.
 */
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { postOpeningBalancesSchema, recordPaymentSchema } from '../../data/validators'
import { FinancialRuleError } from '../../lib/errors'
import { assertPaymentReference, buildOpeningBalanceLines, buildPaymentLines } from '../../lib/financeService'
import {
  OPENING_BALANCES_POST_COMMAND_ID,
  PAYMENT_RECORD_COMMAND_ID,
  openingBalancesEntryNumber,
  paymentEntryNumber,
} from '../moneyActions'

const cashAccount = '11111111-1111-4111-8111-111111111111'
const capitalAccount = '22222222-2222-4222-8222-222222222222'
const methodId = '33333333-3333-4333-8333-333333333333'
const customerAccount = '44444444-4444-4444-8444-444444444444'

function errorCode(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (err) {
    return err instanceof FinancialRuleError ? err.code : null
  }
}

describe('financial money action surface', () => {
  it('registers the ids the routes dispatch to', () => {
    expect(OPENING_BALANCES_POST_COMMAND_ID).toBe('financial.opening_balances.post')
    expect(PAYMENT_RECORD_COMMAND_ID).toBe('financial.payments.record')
    expect(commandRegistry.get(OPENING_BALANCES_POST_COMMAND_ID)?.id).toBe(OPENING_BALANCES_POST_COMMAND_ID)
    expect(commandRegistry.get(PAYMENT_RECORD_COMMAND_ID)?.id).toBe(PAYMENT_RECORD_COMMAND_ID)
  })

  it('numbers a system-posted entry after its own id, so two cannot collide', () => {
    const first = '11111111-1111-4111-8111-111111111111'
    const second = '22222222-2222-4222-8222-222222222222'
    const numbers = [
      openingBalancesEntryNumber(first),
      openingBalancesEntryNumber(second),
      paymentEntryNumber(first),
      paymentEntryNumber(second),
    ]

    expect(new Set(numbers).size).toBe(numbers.length)
    expect(openingBalancesEntryNumber(first)).toBe(`OPENING-${first}`)
    expect(paymentEntryNumber(first)).toBe(`PAYMENT-${first}`)
    // The create schema caps `entryNumber` at 50 characters.
    for (const number of numbers) expect(number.length).toBeLessThanOrEqual(50)
  })
})

describe('opening balance payload', () => {
  const balanced = {
    openingDate: '2026-01-01',
    description: 'Opening balances at 2026-01-01',
    currencyCode: 'SAR',
    lines: [
      { accountId: cashAccount, debitAmount: '5000.0000' },
      { accountId: capitalAccount, creditAmount: '5000.0000' },
    ],
  }

  it('parses a balanced set', () => {
    const parsed = postOpeningBalancesSchema.parse(balanced)

    expect(parsed.currencyCode).toBe('SAR')
    expect(parsed.lines).toHaveLength(2)
    expect(parsed.lines[0].debitAmount).toBe('5000.0000')
  })

  it('refuses a set that does not balance rather than inventing an offset', () => {
    const result = postOpeningBalancesSchema.safeParse({
      ...balanced,
      lines: [
        { accountId: cashAccount, debitAmount: '5000.0000' },
        { accountId: capitalAccount, creditAmount: '4000.0000' },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain('entry_unbalanced')
    }
  })

  it('refuses a single line and a line carrying both sides', () => {
    expect(
      postOpeningBalancesSchema.safeParse({ ...balanced, lines: [{ accountId: cashAccount, debitAmount: '1.0000' }] }).success,
    ).toBe(false)
    expect(
      postOpeningBalancesSchema.safeParse({
        ...balanced,
        lines: [
          { accountId: cashAccount, debitAmount: '5.0000', creditAmount: '5.0000' },
          { accountId: capitalAccount, creditAmount: '5.0000' },
        ],
      }).success,
    ).toBe(false)
  })

  it('refuses a malformed line account and a currency that is not a code', () => {
    expect(
      postOpeningBalancesSchema.safeParse({
        ...balanced,
        lines: [
          { accountId: 'not-a-uuid', debitAmount: '5000.0000' },
          { accountId: capitalAccount, creditAmount: '5000.0000' },
        ],
      }).success,
    ).toBe(false)
    expect(postOpeningBalancesSchema.safeParse({ ...balanced, currencyCode: 'RIYAL' }).success).toBe(false)
  })

  it('copies the lines it validates instead of returning the caller’s array', () => {
    const drafts = buildOpeningBalanceLines([
      { accountId: cashAccount, debitAmount: '5.0000', creditAmount: '0' },
      { accountId: capitalAccount, debitAmount: '0', creditAmount: '5.0000' },
    ])

    expect(drafts).toHaveLength(2)
    expect(drafts[0].accountId).toBe(cashAccount)
    expect(errorCode(() => buildOpeningBalanceLines([]))).toBe('entry_requires_two_lines')
  })
})

describe('payment payload', () => {
  const receipt = {
    direction: 'in',
    paymentMethodId: methodId,
    counterpartyAccountId: customerAccount,
    amount: '1500.0000',
    paymentDate: '2026-10-10',
    currencyCode: 'SAR',
    description: 'Cash sale',
  }

  it('parses a receipt without an optional till or reference', () => {
    const parsed = recordPaymentSchema.parse(receipt)

    expect(parsed.direction).toBe('in')
    expect(parsed.cashAccountId).toBeUndefined()
    expect(parsed.reference).toBeUndefined()
    expect(parsed.taxCode).toBeUndefined()
  })

  it('refuses an unknown direction, a non-uuid method and an empty amount', () => {
    expect(recordPaymentSchema.safeParse({ ...receipt, direction: 'sideways' }).success).toBe(false)
    expect(recordPaymentSchema.safeParse({ ...receipt, paymentMethodId: 'nope' }).success).toBe(false)
    expect(recordPaymentSchema.safeParse({ ...receipt, amount: '' }).success).toBe(false)
    expect(recordPaymentSchema.safeParse({ ...receipt, currencyCode: 'R' }).success).toBe(false)
  })

  it('posts a receipt to the money account and a payment away from it', () => {
    const received = buildPaymentLines({
      direction: 'in',
      moneyAccountId: cashAccount,
      counterpartyAccountId: customerAccount,
      amount: '1500.0000',
      description: 'Cash sale',
    })
    const paid = buildPaymentLines({
      direction: 'out',
      moneyAccountId: cashAccount,
      counterpartyAccountId: customerAccount,
      amount: '1500.0000',
      description: 'Cash purchase',
    })

    expect(received.map((line) => line.accountId)).toEqual([cashAccount, customerAccount])
    expect(received[1].creditAmount).toBe('1500.0000')
    expect(paid.map((line) => line.accountId)).toEqual([customerAccount, cashAccount])
    expect(paid[1].creditAmount).toBe('1500.0000')
  })

  it('refuses a non-positive amount and a payment that would post to one account', () => {
    const base = {
      moneyAccountId: cashAccount,
      counterpartyAccountId: customerAccount,
      description: 'Cash sale',
    }

    expect(errorCode(() => buildPaymentLines({ ...base, direction: 'in', amount: '0' }))).toBe('payment_amount_not_positive')
    expect(errorCode(() => buildPaymentLines({ ...base, direction: 'in', amount: '-5.0000' }))).toBe(
      'payment_amount_not_positive',
    )
    expect(
      errorCode(() =>
        buildPaymentLines({ ...base, direction: 'in', amount: '5.0000', counterpartyAccountId: cashAccount }),
      ),
    ).toBe('payment_accounts_identical')
    expect(errorCode(() => buildPaymentLines({ ...base, direction: 'in', amount: 'not money' }))).toBe('invalid_amount')
  })

  it('requires a reference only when the method does', () => {
    expect(errorCode(() => assertPaymentReference({ requiresReference: false, name: 'Cash' }, null))).toBeNull()
    expect(errorCode(() => assertPaymentReference({ requiresReference: true, name: 'Cheque' }, ' '))).toBe(
      'payment_reference_required',
    )
    expect(errorCode(() => assertPaymentReference({ requiresReference: true, name: 'Cheque' }, 'CHQ-1'))).toBeNull()
  })
})
