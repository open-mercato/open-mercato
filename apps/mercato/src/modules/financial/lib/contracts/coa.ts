/**
 * The chart of accounts a jurisdiction expects an entity to start from. Types
 * only.
 *
 * The template is **data, not code paths**: `financial` seeds it by `code`, so
 * seeding twice creates nothing twice. Every tax code the plugin declares points
 * at an account code this template defines, which is what makes posting
 * mechanical instead of a lookup that can miss.
 */
import type { AccountClass, NormalBalance } from '../../data/entities'

export type ChartOfAccountsEntry = {
  /** Stable within the template; the idempotency key for seeding. */
  code: string
  name: string
  accountClass: AccountClass
  normalBalance: NormalBalance
  accountType?: string | null
  /** Parent account's `code`, resolved during seeding. */
  parentCode?: string | null
}

export type ChartOfAccountsTemplateContract = {
  readonly countryCode: string
  listAccounts(): readonly ChartOfAccountsEntry[]
  /**
   * The account a tax code's output/input side posts to, so a caller can resolve
   * the posting target without duplicating the code table.
   */
  accountCodeForTaxCode(taxCode: string, side: 'sales' | 'purchase'): string | null
}
