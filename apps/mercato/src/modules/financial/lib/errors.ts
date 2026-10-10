import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export const FINANCIAL_ERROR_CODES = [
  'invalid_amount',
  'negative_amount',
  'line_account_required',
  'entry_requires_two_lines',
  'entry_line_single_sided',
  'entry_unbalanced',
  'entry_not_draft',
  'entry_immutable',
  'entry_not_posted',
  'account_not_found',
  'period_closed',
  'period_hard_closed',
  'period_not_reopenable',
  'invalid_period',
  'account_has_postings',
  'currency_mismatch',
  'entry_number_required',
  'account_inactive',
  'payment_account_must_be_asset',
  'payment_amount_not_positive',
  'payment_accounts_identical',
  'payment_reference_required',
  'payment_method_not_found',
  'cash_account_not_found',
  'opening_balances_not_balanced',
  'opening_balances_already_posted',
  'statement_range_invalid',
] as const

export type FinancialErrorCode = (typeof FINANCIAL_ERROR_CODES)[number]

const FALLBACK_MESSAGES: Record<FinancialErrorCode, string> = {
  invalid_amount: 'The amount is not a valid decimal number.',
  negative_amount: 'Amounts must be zero or greater.',
  line_account_required: 'Every journal line needs an account.',
  entry_requires_two_lines: 'A journal entry needs at least two lines.',
  entry_line_single_sided: 'A journal line must carry a debit or a credit, never both and never neither.',
  entry_unbalanced: 'Total debits must equal total credits.',
  entry_not_draft: 'Only a draft entry can be changed.',
  entry_immutable: 'A posted entry cannot be changed. Reverse it instead.',
  entry_not_posted: 'Only a posted entry can be reversed.',
  account_not_found: 'One of the selected accounts does not exist.',
  period_closed: 'The accounting period is closed.',
  period_hard_closed: 'The accounting period is permanently closed.',
  period_not_reopenable: 'Only a soft-closed period can be reopened.',
  invalid_period: 'The accounting period does not exist.',
  account_has_postings: 'The account has posted entries and cannot be archived.',
  currency_mismatch: 'The account currency does not match the entry currency.',
  entry_number_required: 'An entry number is required.',
  account_inactive: 'The account is inactive.',
  payment_account_must_be_asset: 'Money is held in an asset account. Choose one to post the payment through.',
  payment_amount_not_positive: 'A payment amount must be greater than zero. Record a refund as a payment in the other direction.',
  payment_accounts_identical: 'The money account and the other side must be different accounts.',
  payment_reference_required: 'This payment method needs a reference, such as a cheque number or a transfer reference.',
  payment_method_not_found: 'The payment method does not exist.',
  cash_account_not_found: 'The cash or bank account does not exist.',
  opening_balances_not_balanced: 'Opening balances must net to zero: total debits must equal total credits.',
  opening_balances_already_posted: 'Opening balances have already been posted for this organization.',
  statement_range_invalid: 'The statement range is not valid: the end date is before the start date.',
}

export function financialFallbackMessage(code: FinancialErrorCode): string {
  return FALLBACK_MESSAGES[code]
}

export class FinancialRuleError extends Error {
  readonly code: FinancialErrorCode

  constructor(code: FinancialErrorCode) {
    super(FALLBACK_MESSAGES[code])
    this.name = 'FinancialRuleError'
    this.code = code
  }
}

export async function raiseFinancialError(status: number, code: FinancialErrorCode): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`financial.errors.${code}`, FALLBACK_MESSAGES[code]) })
}

export async function financialMessage(key: string, fallback: string): Promise<string> {
  const { translate } = await resolveTranslations()
  return translate(`financial.audit.${key}`, fallback)
}
