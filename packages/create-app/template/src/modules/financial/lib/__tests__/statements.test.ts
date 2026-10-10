import type { AccountClass, NormalBalance } from '../../data/entities'
import { FinancialRuleError } from '../errors'
import { buildBalanceSheet, buildIncomeStatement, type AccountMovement } from '../statements'

type MovementInput = {
  accountId: string
  code: string
  name?: string
  accountClass: AccountClass
  normalBalance: NormalBalance
  debit?: string
  credit?: string
}

function movement(input: MovementInput): AccountMovement {
  return {
    accountId: input.accountId,
    code: input.code,
    name: input.name ?? `Account ${input.code}`,
    accountClass: input.accountClass,
    normalBalance: input.normalBalance,
    debit: input.debit ?? '0.0000',
    credit: input.credit ?? '0.0000',
  }
}

const cash = movement({ accountId: 'a-cash', code: '1010', accountClass: 'asset', normalBalance: 'debit', debit: '5000.0000' })
const payables = movement({ accountId: 'a-ap', code: '2010', accountClass: 'liability', normalBalance: 'credit', credit: '2000.0000' })
const capital = movement({ accountId: 'a-capital', code: '3010', accountClass: 'equity', normalBalance: 'credit', credit: '2000.0000' })
const sales = movement({ accountId: 'a-sales', code: '4010', accountClass: 'revenue', normalBalance: 'credit', credit: '1500.0000' })
const rent = movement({ accountId: 'a-rent', code: '5010', accountClass: 'expense', normalBalance: 'debit', debit: '500.0000' })

describe('balance sheet', () => {
  it('balances when the ledger does', () => {
    const sheet = buildBalanceSheet([cash, payables, capital, sales, rent], {
      asOf: '2026-03-31',
      currencyCode: 'SAR',
    })

    expect(sheet.asOf).toBe('2026-03-31')
    expect(sheet.currencyCode).toBe('SAR')
    expect(sheet.totalAssets).toBe('5000.0000')
    expect(sheet.totalLiabilitiesAndEquity).toBe('5000.0000')
    expect(sheet.balanced).toBe(true)
    expect(sheet.assets.rows.map((row) => row.code)).toEqual(['1010'])
    expect(sheet.equity.rows.map((row) => row.code)).toEqual(['3010'])
  })

  it('bridges the period result into equity so a trading ledger still balances', () => {
    const trading = buildBalanceSheet(
      [
        movement({ accountId: 'a-cash', code: '1010', accountClass: 'asset', normalBalance: 'debit', debit: '800.0000' }),
        movement({ accountId: 'a-ap', code: '2010', accountClass: 'liability', normalBalance: 'credit', credit: '300.0000' }),
        movement({ accountId: 'a-sales', code: '4010', accountClass: 'revenue', normalBalance: 'credit', credit: '1000.0000' }),
        movement({ accountId: 'a-rent', code: '5010', accountClass: 'expense', normalBalance: 'debit', debit: '500.0000' }),
      ],
      { asOf: '2026-06-30', currencyCode: 'SAR' },
    )

    // No closing entry has been run: the equity section holds no rows and the
    // result is what makes the two totals agree.
    expect(trading.equity.rows).toEqual([])
    expect(trading.equity.total).toBe('0.0000')
    expect(trading.netIncome).toBe('500.0000')
    expect(trading.totalAssets).toBe('800.0000')
    expect(trading.totalLiabilitiesAndEquity).toBe('800.0000')
    expect(trading.balanced).toBe(true)
  })

  it('omits accounts with no balance and sorts the rest by code', () => {
    const sheet = buildBalanceSheet(
      [
        movement({ accountId: 'a-cash', code: '1020', accountClass: 'asset', normalBalance: 'debit', debit: '400.0000' }),
        movement({ accountId: 'a-clearing', code: '1010', accountClass: 'asset', normalBalance: 'debit', debit: '250.0000' }),
        movement({ accountId: 'a-empty', code: '1030', accountClass: 'asset', normalBalance: 'debit', debit: '100.0000', credit: '100.0000' }),
      ],
      { asOf: '2026-01-31', currencyCode: 'SAR' },
    )

    expect(sheet.assets.rows.map((row) => row.code)).toEqual(['1010', '1020'])
    expect(sheet.assets.total).toBe('650.0000')
    expect(sheet.balanced).toBe(false)
    expect(sheet.totalAssets).toBe('650.0000')
    expect(sheet.totalLiabilitiesAndEquity).toBe('0.0000')
  })

  it('shows a contra account on the side its stored normal balance falls on', () => {
    const sheet = buildBalanceSheet(
      [
        movement({ accountId: 'a-cash', code: '1010', accountClass: 'asset', normalBalance: 'debit', debit: '1000.0000' }),
        movement({
          accountId: 'a-depreciation',
          code: '1090',
          accountClass: 'asset',
          normalBalance: 'credit',
          credit: '250.0000',
        }),
      ],
      { asOf: '2026-01-31', currencyCode: 'SAR' },
    )

    // Accumulated depreciation is an asset account that is credit-normal, and it
    // is presented as a credit — not as a negative debit.
    const contra = sheet.assets.rows.find((row) => row.code === '1090')
    expect(contra?.debit).toBe('0.0000')
    expect(contra?.credit).toBe('250.0000')
    // The section totals on its own natural side (assets are debit-natured), so
    // the contra row subtracts: 1 000 of cash less 250 of accumulated
    // depreciation is 750 of net assets. Summing each account's own-normal-side
    // balance instead reported 1 250 and called a correct ledger unbalanced.
    expect(sheet.assets.total).toBe('750.0000')
    expect(sheet.totalAssets).toBe('750.0000')
  })

  it('stays balanced when a contra account offsets its section', () => {
    // Assets 1 000 − 250 depreciation, funded by 750 of capital: a correct ledger
    // whose only interesting feature is the contra account.
    const sheet = buildBalanceSheet(
      [
        movement({ accountId: 'a-cash', code: '1010', accountClass: 'asset', normalBalance: 'debit', debit: '1000.0000' }),
        movement({
          accountId: 'a-depreciation',
          code: '1090',
          accountClass: 'asset',
          normalBalance: 'credit',
          credit: '250.0000',
        }),
        movement({
          accountId: 'a-capital',
          code: '3000',
          accountClass: 'equity',
          normalBalance: 'credit',
          credit: '750.0000',
        }),
      ],
      { asOf: '2026-01-31', currencyCode: 'SAR' },
    )

    expect(sheet.totalAssets).toBe('750.0000')
    expect(sheet.totalLiabilitiesAndEquity).toBe('750.0000')
    expect(sheet.balanced).toBe(true)
  })

  it('nets a contra-revenue account out of the revenue section', () => {
    // Sales returns is revenue that is debit-normal; it reduces revenue rather
    // than adding to it.
    const sheet = buildBalanceSheet(
      [
        movement({ accountId: 'a-sales', code: '4010', accountClass: 'revenue', normalBalance: 'credit', credit: '1500.0000' }),
        movement({ accountId: 'a-returns', code: '4020', accountClass: 'revenue', normalBalance: 'debit', debit: '200.0000' }),
      ],
      { asOf: '2026-01-31', currencyCode: 'SAR' },
    )

    expect(sheet.netIncome).toBe('1300.0000')
    expect(sheet.balanced).toBe(false)
  })

  it('reports an empty ledger as balanced at zero', () => {
    const sheet = buildBalanceSheet([], { asOf: '2026-01-01', currencyCode: 'SAR' })

    expect(sheet.assets.rows).toEqual([])
    expect(sheet.liabilities.rows).toEqual([])
    expect(sheet.equity.rows).toEqual([])
    expect(sheet.totalAssets).toBe('0.0000')
    expect(sheet.totalLiabilitiesAndEquity).toBe('0.0000')
    expect(sheet.netIncome).toBe('0.0000')
    expect(sheet.balanced).toBe(true)
  })
})

describe('income statement', () => {
  const revenue = movement({ accountId: 'a-sales', code: '4010', accountClass: 'revenue', normalBalance: 'credit', credit: '1500.0000' })
  const expenses = movement({ accountId: 'a-rent', code: '5010', accountClass: 'expense', normalBalance: 'debit', debit: '500.0000' })

  it('reports the result for the range and names it', () => {
    const statement = buildIncomeStatement([revenue, expenses], {
      from: '2026-01-01',
      to: '2026-12-31',
      currencyCode: 'SAR',
    })

    expect(statement.from).toBe('2026-01-01')
    expect(statement.to).toBe('2026-12-31')
    expect(statement.totalRevenue).toBe('1500.0000')
    expect(statement.totalExpenses).toBe('500.0000')
    expect(statement.netIncome).toBe('1000.0000')
    expect(statement.revenue.rows.map((row) => row.code)).toEqual(['4010'])
  })

  it('reports a loss as a negative net income', () => {
    const statement = buildIncomeStatement(
      [
        movement({ accountId: 'a-sales', code: '4010', accountClass: 'revenue', normalBalance: 'credit', credit: '1000.0000' }),
        movement({ accountId: 'a-rent', code: '5010', accountClass: 'expense', normalBalance: 'debit', debit: '1500.0000' }),
      ],
      { from: '2026-01-01', to: '2026-12-31', currencyCode: 'SAR' },
    )

    expect(statement.totalRevenue).toBe('1000.0000')
    expect(statement.totalExpenses).toBe('1500.0000')
    expect(statement.netIncome).toBe('-500.0000')
  })

  it('refuses a range that ends before it starts', () => {
    expect(() =>
      buildIncomeStatement([], { from: '2026-12-31', to: '2026-01-01', currencyCode: 'SAR' }),
    ).toThrow(FinancialRuleError)
    try {
      buildIncomeStatement([], { from: '2026-12-31', to: '2026-01-01', currencyCode: 'SAR' })
    } catch (err) {
      expect((err as FinancialRuleError).code).toBe('statement_range_invalid')
    }
  })

  it('refuses a date that does not exist rather than rolling it into the next month', () => {
    expect(() =>
      buildIncomeStatement([], { from: '2026-02-31', to: '2026-03-31', currencyCode: 'SAR' }),
    ).toThrow(FinancialRuleError)
  })
})
