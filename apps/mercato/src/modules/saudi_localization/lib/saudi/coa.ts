/**
 * The Saudi chart-of-accounts template a new organization starts from.
 *
 * It is **data, not code paths**: `financial` seeds it by `code` and re-running
 * the seed creates nothing twice. The template's real job is to make the tax
 * codes mechanical — every account the VAT and withholding codes reference
 * (`lib/saudi/tax-codes.ts`) is defined here, so posting a Saudi tax line can
 * never fail because an account was never created. A unit test asserts that
 * containment in both directions.
 *
 * The layout is the numbering a Saudi practice expects: 1xxx assets, 2xxx
 * liabilities, 3xxx equity, 4xxx revenue, 5xxx expenses, with the VAT accounts
 * where an auditor looks for them — input VAT receivable among the assets and
 * output VAT payable among the liabilities, never netted into one account. A
 * single net VAT account cannot produce a return, because the return reports the
 * two sides separately.
 */
import type { ChartOfAccountsEntry, ChartOfAccountsTemplateContract } from '@/modules/financial/lib/contracts'
import {
  SAUDI_INPUT_VAT_ACCOUNT,
  SAUDI_OUTPUT_VAT_ACCOUNT,
  SAUDI_WHT_PAYABLE_ACCOUNT,
  saudiAccountForTaxCode,
} from './tax-codes'

export const SAUDI_COUNTRY_CODE = 'SA'

/** Parent accounts group the statements; children carry the postings. */
export const SAUDI_CHART_OF_ACCOUNTS: readonly ChartOfAccountsEntry[] = [
  { code: '1000', name: 'Cash on hand', accountClass: 'asset', normalBalance: 'debit', accountType: 'cash' },
  { code: '1010', name: 'Bank — current account', accountClass: 'asset', normalBalance: 'debit', accountType: 'bank' },
  { code: '1100', name: 'Accounts receivable', accountClass: 'asset', normalBalance: 'debit', accountType: 'receivable' },
  {
    code: SAUDI_INPUT_VAT_ACCOUNT,
    name: 'Input VAT receivable',
    accountClass: 'asset',
    normalBalance: 'debit',
    accountType: 'tax_receivable',
  },
  { code: '1200', name: 'Inventory', accountClass: 'asset', normalBalance: 'debit', accountType: 'inventory' },
  { code: '1500', name: 'Property and equipment', accountClass: 'asset', normalBalance: 'debit', accountType: 'fixed_asset' },

  { code: '2000', name: 'Accounts payable', accountClass: 'liability', normalBalance: 'credit', accountType: 'payable' },
  {
    code: SAUDI_OUTPUT_VAT_ACCOUNT,
    name: 'Output VAT payable',
    accountClass: 'liability',
    normalBalance: 'credit',
    accountType: 'tax_payable',
  },
  {
    code: SAUDI_WHT_PAYABLE_ACCOUNT,
    name: 'Withholding tax payable',
    accountClass: 'liability',
    normalBalance: 'credit',
    accountType: 'tax_payable',
  },
  { code: '2200', name: 'Accruals and provisions', accountClass: 'liability', normalBalance: 'credit', accountType: 'accrual' },
  {
    code: '2300',
    name: 'Zakat and income tax provision',
    accountClass: 'liability',
    normalBalance: 'credit',
    accountType: 'tax_payable',
  },

  { code: '3000', name: 'Share capital', accountClass: 'equity', normalBalance: 'credit', accountType: 'capital' },
  { code: '3100', name: 'Statutory reserve', accountClass: 'equity', normalBalance: 'credit', accountType: 'reserve' },
  { code: '3200', name: 'Retained earnings', accountClass: 'equity', normalBalance: 'credit', accountType: 'retained_earnings' },

  { code: '4000', name: 'Domestic sales', accountClass: 'revenue', normalBalance: 'credit', accountType: 'sales' },
  { code: '4100', name: 'Zero-rated exports', accountClass: 'revenue', normalBalance: 'credit', accountType: 'sales' },
  { code: '4200', name: 'Exempt sales', accountClass: 'revenue', normalBalance: 'credit', accountType: 'sales' },
  { code: '4300', name: 'Other income', accountClass: 'revenue', normalBalance: 'credit', accountType: 'other_income' },

  { code: '5000', name: 'Cost of goods sold', accountClass: 'expense', normalBalance: 'debit', accountType: 'cost_of_sales' },
  { code: '5100', name: 'Salaries and wages', accountClass: 'expense', normalBalance: 'debit', accountType: 'payroll' },
  { code: '5200', name: 'Rent expense', accountClass: 'expense', normalBalance: 'debit', accountType: 'operating_expense' },
  {
    code: '5300',
    name: 'Professional and technical services',
    accountClass: 'expense',
    normalBalance: 'debit',
    accountType: 'operating_expense',
  },
  { code: '5400', name: 'Utilities', accountClass: 'expense', normalBalance: 'debit', accountType: 'operating_expense' },
  {
    code: '5500',
    name: 'General and administrative expenses',
    accountClass: 'expense',
    normalBalance: 'debit',
    accountType: 'operating_expense',
  },
]

export function buildSaudiChartOfAccounts(): ChartOfAccountsTemplateContract {
  return {
    countryCode: SAUDI_COUNTRY_CODE,
    listAccounts: () => SAUDI_CHART_OF_ACCOUNTS,
    accountCodeForTaxCode: (taxCode, side) => saudiAccountForTaxCode(taxCode, side),
  }
}
